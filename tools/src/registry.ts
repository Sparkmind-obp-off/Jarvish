import { z } from "zod";
import {
  RuntimeError,
  type JarvishTool,
  type ToolResult,
} from "../../core/src/index.js";
import { MemoryStore } from "../../memory/src/store.js";
import { memorySchema } from "../../memory/src/policy.js";
export class ToolRegistry {
  private readonly tools = new Map<string, JarvishTool>();
  register(tool: JarvishTool) {
    if (
      this.tools.has(tool.name) ||
      !tool.name ||
      !Number.isInteger(tool.permission) ||
      tool.permission < 0 ||
      tool.permission > 3 ||
      tool.timeout < 1 ||
      tool.timeout > 30000
    )
      throw new RuntimeError(
        "INVALID_TOOL",
        "Invalid or duplicate tool registration",
      );
    this.tools.set(tool.name, tool);
  }
  get(name: string) {
    const tool = this.tools.get(name);
    if (!tool) throw new RuntimeError("UNKNOWN_TOOL", "Tool is unavailable");
    return tool;
  }
  list() {
    return [...this.tools.values()];
  }
}
function tool<T>(
  name: string,
  description: string,
  permission: 0 | 1 | 2 | 3,
  schema: z.ZodType<T>,
  execute: (input: T, signal: AbortSignal) => Promise<ToolResult>,
  verify: (
    input: T,
    result: ToolResult,
    signal: AbortSignal,
  ) => Promise<boolean>,
): JarvishTool {
  return {
    name,
    description,
    permission,
    inputSchema: z.toJSONSchema(schema) as Record<string, unknown>,
    timeout: 15000,
    validate: (input) => schema.parse(input),
    execute: (i, s) => execute(schema.parse(i), s),
    verify: (i, r, s) => verify(schema.parse(i), r, s),
  };
}
export interface ToolEnv {
  DB: D1Database;
  GITHUB_TOKEN?: string;
  GITHUB_REPOSITORIES?: string;
  WEB_ALLOWED_HOSTS?: string;
}
export function createTools(env: ToolEnv, fetcher: typeof fetch = fetch) {
  const registry = new ToolRegistry();
  const memory = new MemoryStore(env.DB);
  registry.register(
    tool(
      "memory.save",
      "Save an explicitly requested structured memory; never credentials",
      1,
      memorySchema,
      async (input) => {
        const output = await memory.save(input);
        return { output, evidence: { id: output.id, kind: output.kind } };
      },
      async (input, result) => {
        const row = await memory.get((result.output as { id: string }).id);
        return (
          row?.content === input.content &&
          row.kind === input.kind &&
          row.importance === input.importance
        );
      },
    ),
  );
  registry.register(
    tool(
      "memory.search",
      "Retrieve saved structured memory",
      0,
      z.object({ query: z.string().max(200).default("") }).strict(),
      async (input) => {
        const output = await memory.list(input.query);
        return { output, evidence: { source: "D1", rows: output.length } };
      },
      async (_input, result) => Array.isArray(result.output),
    ),
  );
  registry.register(
    tool(
      "memory.delete",
      "Permanently delete one memory; requires explicit destructive approval",
      3,
      z.object({ id: z.string().uuid() }).strict(),
      async (input) => {
        await env.DB.prepare("DELETE FROM memories WHERE id=?")
          .bind(input.id)
          .run();
        return {
          output: { id: input.id },
          evidence: { source: "D1", action: "delete" },
        };
      },
      async (input) => (await memory.get(input.id)) === null,
    ),
  );
  const repoSchema = z
    .string()
    .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/)
    .refine(
      (r) =>
        (env.GITHUB_REPOSITORIES ?? "Sparkmind-obp-off/Jarvish")
          .split(",")
          .map((x) => x.trim())
          .includes(r),
      "Repository is outside the configured allowlist",
    );
  const branchSchema = z
    .string()
    .min(1)
    .max(120)
    .regex(/^[A-Za-z0-9][A-Za-z0-9_/-]*$/)
    .refine((v) => !v.includes("//") && !v.endsWith("/"));
  async function github(
    path: string,
    signal: AbortSignal,
    method = "GET",
    body?: unknown,
  ) {
    const response = await fetcher(`https://api.github.com${path}`, {
      method,
      signal,
      redirect: "manual",
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "Jarvish/0.2",
        ...(env.GITHUB_TOKEN
          ? { Authorization: `Bearer ${env.GITHUB_TOKEN}` }
          : {}),
      },
      ...(body
        ? {
            body: JSON.stringify(body),
            headers: {
              Accept: "application/vnd.github+json",
              "Content-Type": "application/json",
              "X-GitHub-Api-Version": "2022-11-28",
              "User-Agent": "Jarvish/0.2",
              Authorization: `Bearer ${env.GITHUB_TOKEN}`,
            },
          }
        : {}),
    });
    if (!response.ok)
      throw new RuntimeError(
        "GITHUB_HTTP",
        `GitHub returned HTTP ${response.status}`,
        response.status >= 500 || response.status === 429,
      );
    return (await response.json()) as Record<string, any>;
  }
  registry.register(
    tool(
      "github.inspect",
      "Inspect an allowlisted GitHub repository",
      0,
      z.object({ repo: repoSchema }).strict(),
      async (input, signal) => {
        const repo = await github(`/repos/${input.repo}`, signal);
        if (typeof repo.full_name !== "string" || !repo.default_branch)
          throw new RuntimeError(
            "MALFORMED_TOOL_RESPONSE",
            "Invalid repository response",
          );
        return {
          output: {
            full_name: repo.full_name,
            default_branch: repo.default_branch,
            description: repo.description,
            url: repo.html_url,
          },
          evidence: {
            source: "GitHub API",
            full_name: repo.full_name,
            id: repo.id,
          },
        };
      },
      async (input, result) =>
        String(
          (result.output as { full_name: string }).full_name,
        ).toLowerCase() === input.repo.toLowerCase(),
    ),
  );
  registry.register(
    tool(
      "github.branch.create",
      "Create a GitHub branch, then GET its exact ref to verify; repository allowlist enforced",
      2,
      z
        .object({
          repo: repoSchema,
          branch: branchSchema,
          from: branchSchema.default("main"),
        })
        .strict(),
      async (input, signal) => {
        if (!env.GITHUB_TOKEN)
          throw new RuntimeError(
            "NOT_CONFIGURED",
            "GITHUB_TOKEN is required for branch creation",
          );
        const source = await github(
          `/repos/${input.repo}/git/ref/heads/${encodeURIComponent(input.from)}`,
          signal,
        );
        if (!/^[a-f0-9]{40}$/.test(source.object?.sha ?? ""))
          throw new RuntimeError(
            "MALFORMED_TOOL_RESPONSE",
            "Invalid source SHA",
          );
        await github(`/repos/${input.repo}/git/refs`, signal, "POST", {
          ref: `refs/heads/${input.branch}`,
          sha: source.object.sha,
        });
        return {
          output: {
            repo: input.repo,
            branch: input.branch,
            sha: source.object.sha,
          },
          evidence: { created_ref: `refs/heads/${input.branch}` },
        };
      },
      async (input, result, signal) => {
        const ref = await github(
          `/repos/${input.repo}/git/ref/heads/${encodeURIComponent(input.branch)}`,
          signal,
        );
        return (
          ref.ref === `refs/heads/${input.branch}` &&
          ref.object?.sha === (result.output as { sha: string }).sha
        );
      },
    ),
  );
  const hosts = (
    env.WEB_ALLOWED_HOSTS ??
    "example.com,developer.mozilla.org,docs.github.com,en.wikipedia.org,console.groq.com"
  )
    .split(",")
    .map((x) => x.trim().toLowerCase());
  const urlSchema = z
    .string()
    .url()
    .max(2048)
    .refine((v) => {
      const u = new URL(v);
      return (
        u.protocol === "https:" &&
        !u.username &&
        !u.password &&
        (!u.port || u.port === "443") &&
        hosts.includes(u.hostname.toLowerCase())
      );
    }, "URL must be HTTPS on an explicitly allowlisted host");
  registry.register(
    tool(
      "web.fetch",
      "Read a public HTTPS page on the configured allowlist; no redirects or browser automation",
      0,
      z.object({ url: urlSchema }).strict(),
      async (input, signal) => {
        const response = await fetcher(input.url, {
          signal,
          redirect: "manual",
          headers: { "User-Agent": "Jarvish/0.2" },
        });
        if (!response.ok)
          throw new RuntimeError(
            "WEB_HTTP",
            `Website returned HTTP ${response.status}`,
            response.status >= 500,
          );
        const type = response.headers.get("content-type") ?? "";
        if (!/text\/|application\/json/.test(type))
          throw new RuntimeError(
            "UNSUPPORTED_CONTENT",
            "Only text/JSON pages are supported",
          );
        const reader = response.body?.getReader();
        if (!reader)
          throw new RuntimeError("EMPTY_RESPONSE", "Empty web response");
        let size = 0;
        let text = "";
        let truncated = false;
        const decoder = new TextDecoder();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const remaining = 50000 - size;
            text += decoder.decode(value.slice(0, remaining), { stream: true });
            size += value.length;
            if (size >= 50000) {
              truncated = true;
              break;
            }
          }
        } finally {
          await reader.cancel();
        }
        text += decoder.decode();
        return {
          output: {
            url: input.url,
            text: text
              .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
              .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
              .replace(/<[^>]+>/g, " ")
              .replace(/\s+/g, " ")
              .slice(0, 16000),
            truncated,
          },
          evidence: {
            url: input.url,
            http_status: response.status,
            content_type: type,
            retrieved_at: new Date().toISOString(),
          },
        };
      },
      async (_input, result) =>
        Boolean((result.output as { text: string }).text?.trim()) &&
        (result.evidence as { http_status: number }).http_status === 200,
    ),
  );
  return registry;
}
