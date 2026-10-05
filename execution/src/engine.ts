import {
  RuntimeError,
  type PlanStep,
  type ExecutionStatus,
  type ToolResult,
} from "../../core/src/index.js";
import { assertPermission } from "../../core/src/policy.js";
import { ToolRegistry } from "../../tools/src/registry.js";
export interface ExecutionRow {
  id: string;
  tool: string;
  permission: 0 | 1 | 2 | 3;
  input_json: string;
  output_json: string | null;
  verified: number;
  created_at: string;
  status: ExecutionStatus;
  plan_json: string;
  checkpoint: number;
  attempts: number;
  updated_at: string;
  error_code: string | null;
  approval_at: string | null;
}
export class ExecutionEngine {
  constructor(
    readonly db: D1Database,
    readonly registry: ToolRegistry,
  ) {}
  async create(steps: PlanStep[]) {
    if (!steps.length || steps.length > 4)
      throw new RuntimeError("INVALID_PLAN", "A plan must have 1–4 steps");
    let permission: 0 | 1 | 2 | 3 = 0;
    const normalized = steps.map((s) => {
      const t = this.registry.get(s.tool);
      permission = Math.max(permission, t.permission) as 0 | 1 | 2 | 3;
      return { tool: t.name, input: t.validate(s.input) };
    });
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    // More conservative than the minimum policy: even safe writes require approval.
    await this.db
      .prepare(
        "INSERT INTO executions(id,tool,permission,input_json,created_at,status,plan_json,updated_at) VALUES(?,?,?,?,?,?,?,?)",
      )
      .bind(
        id,
        normalized.map((s) => s.tool).join(","),
        permission,
        JSON.stringify(normalized),
        now,
        permission > 0 ? "AWAITING_APPROVAL" : "READY",
        JSON.stringify(normalized),
        now,
      )
      .run();
    return (await this.get(id))!;
  }
  async get(id: string) {
    return this.db
      .prepare("SELECT * FROM executions WHERE id=?")
      .bind(id)
      .first<ExecutionRow>();
  }
  async list() {
    return (
      await this.db
        .prepare("SELECT * FROM executions ORDER BY created_at DESC LIMIT 30")
        .all<ExecutionRow>()
    ).results;
  }
  async evidence(id: string) {
    return (
      await this.db
        .prepare(
          "SELECT kind,content,created_at FROM execution_evidence WHERE execution_id=? ORDER BY rowid ASC",
        )
        .bind(id)
        .all()
    ).results;
  }
  async approve(id: string) {
    const row = await this.get(id);
    if (!row) throw new RuntimeError("NOT_FOUND", "Execution not found");
    if (row.status !== "AWAITING_APPROVAL")
      throw new RuntimeError("CONFLICT", "Execution is not awaiting approval");
    await this.db
      .prepare(
        "UPDATE executions SET status='READY',approval_at=?,updated_at=? WHERE id=? AND status='AWAITING_APPROVAL'",
      )
      .bind(new Date().toISOString(), new Date().toISOString(), id)
      .run();
    return this.get(id);
  }
  async run(id: string) {
    const row = await this.get(id);
    if (!row) throw new RuntimeError("NOT_FOUND", "Execution not found");
    assertPermission(row.permission, Boolean(row.approval_at));
    if (row.permission > 0 && !row.approval_at)
      throw new RuntimeError("APPROVAL_REQUIRED", "Explicit approval required");
    if (row.status !== "READY")
      throw new RuntimeError(
        "CONFLICT",
        "Execution is not ready; duplicate runs are refused",
      );
    const claim = await this.db
      .prepare(
        "UPDATE executions SET status='RUNNING',attempts=attempts+1,updated_at=? WHERE id=? AND status='READY'",
      )
      .bind(new Date().toISOString(), id)
      .run();
    if (claim.meta.changes !== 1)
      throw new RuntimeError("CONFLICT", "Execution is already claimed");
    const steps = JSON.parse(row.plan_json) as PlanStep[];
    const outputs: unknown[] = row.output_json
      ? JSON.parse(row.output_json)
      : [];
    try {
      for (let i = row.checkpoint; i < steps.length; i++) {
        const step = steps[i];
        const tool = this.registry.get(step.tool);
        const input = tool.validate(step.input);
        assertPermission(tool.permission, Boolean(row.approval_at));
        const controller = new AbortController();
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new RuntimeError("TOOL_TIMEOUT", "Tool timed out"));
          }, tool.timeout);
        });
        try {
          const work = async () => {
            console.log(
              JSON.stringify({
                event: "tool",
                execution_id: id,
                tool: tool.name,
                step: i,
                status: "execute",
              }),
            );
            const result = await tool.execute(input, controller.signal);
            if (controller.signal.aborted)
              throw new RuntimeError(
                "TOOL_TIMEOUT",
                "Tool timed out; outcome may be uncertain",
              );
            await this.db
              .prepare(
                "INSERT INTO execution_evidence(id,execution_id,kind,content,created_at) VALUES(?,?,?,?,?)",
              )
              .bind(
                crypto.randomUUID(),
                id,
                "attempt",
                JSON.stringify({
                  step: i,
                  tool: tool.name,
                  verified: false,
                  result,
                }),
                new Date().toISOString(),
              )
              .run();
            const verifying = await this.db
              .prepare(
                "UPDATE executions SET status='VERIFYING',updated_at=? WHERE id=? AND status='RUNNING'",
              )
              .bind(new Date().toISOString(), id)
              .run();
            if (verifying.meta.changes !== 1 || controller.signal.aborted)
              throw new RuntimeError(
                "TOOL_TIMEOUT",
                "Execution stopped before verification",
              );
            if (
              !result?.evidence ||
              !(await tool.verify(input, result, controller.signal))
            )
              throw new RuntimeError(
                "VERIFICATION_FAILED",
                "Tool result did not verify",
              );
            if (controller.signal.aborted)
              throw new RuntimeError("TOOL_TIMEOUT", "Verification timed out");
            return result;
          };
          const result: ToolResult = await Promise.race([work(), timeout]);
          outputs.push({
            tool: tool.name,
            output: result.output,
            verified: true,
          });
          const now = new Date().toISOString();
          await this.db.batch([
            this.db
              .prepare(
                "INSERT INTO execution_evidence(id,execution_id,kind,content,created_at) VALUES(?,?,?,?,?)",
              )
              .bind(
                crypto.randomUUID(),
                id,
                "verification",
                JSON.stringify({
                  step: i,
                  tool: tool.name,
                  verified: true,
                  evidence: result.evidence,
                }),
                now,
              ),
            this.db
              .prepare(
                "UPDATE executions SET checkpoint=?,output_json=?,status='RUNNING',updated_at=? WHERE id=?",
              )
              .bind(i + 1, JSON.stringify(outputs), now, id),
          ]);
          console.log(
            JSON.stringify({
              event: "verification",
              execution_id: id,
              tool: tool.name,
              verified: true,
            }),
          );
        } finally {
          if (timer) clearTimeout(timer);
        }
      }
      await this.db
        .prepare(
          "UPDATE executions SET status='COMPLETE',verified=1,error_code=NULL,updated_at=? WHERE id=?",
        )
        .bind(new Date().toISOString(), id)
        .run();
    } catch (error) {
      const code =
        error instanceof RuntimeError
          ? error.code
          : error instanceof TypeError &&
              /illegal invocation/i.test(error.message)
            ? "TOOL_BINDING_ERROR"
            : error instanceof Error &&
                /fetch|network|connect|tls|ssl/i.test(error.message)
              ? "TOOL_NETWORK"
              : "TOOL_FAILED";
      const failedAt = new Date().toISOString();
      await this.db.batch([
        this.db
          .prepare(
            "UPDATE executions SET status='FAILED',verified=0,error_code=?,updated_at=? WHERE id=?",
          )
          .bind(code, failedAt, id),
        this.db
          .prepare(
            "INSERT INTO execution_evidence(id,execution_id,kind,content,created_at) VALUES(?,?,?,?,?)",
          )
          .bind(
            crypto.randomUUID(),
            id,
            "failure",
            JSON.stringify({
              verified: false,
              code,
              external_outcome:
                row.permission >= 2
                  ? "May require manual investigation"
                  : "Not verified",
            }),
            failedAt,
          ),
      ]);
      console.log(
        JSON.stringify({
          event: "failure",
          execution_id: id,
          code,
          error_type: error instanceof Error ? error.name : "unknown",
        }),
      );
    }
    return this.get(id);
  }
  async retry(id: string) {
    const row = await this.get(id);
    if (!row) throw new RuntimeError("NOT_FOUND", "Execution not found");
    if (row.status !== "FAILED" || row.permission !== 0 || row.attempts >= 2)
      throw new RuntimeError(
        "RETRY_FORBIDDEN",
        "Only failed read-only plans may retry once; writes are never replayed automatically",
      );
    const changed = await this.db
      .prepare(
        "UPDATE executions SET status='READY',error_code=NULL WHERE id=? AND status='FAILED' AND attempts<2",
      )
      .bind(id)
      .run();
    if (changed.meta.changes !== 1)
      throw new RuntimeError("CONFLICT", "Retry already claimed");
    return this.run(id);
  }
}
