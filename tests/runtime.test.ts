import { describe, it, expect, vi } from "vitest";
import { testDB } from "./d1.js";
import { GroqProvider } from "../providers/groq/index.js";
import { UnavailableLocalProvider } from "../providers/local/index.js";
import { ProviderRouter } from "../core/src/router.js";
import { JarvishEngine } from "../core/src/engine.js";
import { assertPermission } from "../core/src/policy.js";
import {
  RuntimeError,
  type LLMProvider,
  type JarvishTool,
} from "../core/src/index.js";
import { memorySchema } from "../memory/src/policy.js";
import { MemoryStore } from "../memory/src/store.js";
import { ToolRegistry, createTools } from "../tools/src/registry.js";
import { ExecutionEngine } from "../execution/src/engine.js";
import app from "../cloudflare/worker/index.js";
const provider = (content: string): LLMProvider => ({
  id: "test-only",
  name: "test-only",
  capabilities: ["chat"],
  health: async () => ({ available: true }),
  generate: async () => ({
    content,
    provider: "test-only",
    model: "test-fixture",
  }),
});
const testTool = (
  permission: 0 | 1 | 2 | 3 = 0,
  verify = true,
): JarvishTool => ({
  name: "test",
  description: "test-only",
  permission,
  inputSchema: { type: "object" },
  timeout: 1000,
  validate: (i) => i,
  execute: async () => ({
    output: { ok: true },
    evidence: { source: "test-only" },
  }),
  verify: async () => verify,
});
const key = "unit-test-owner-key-not-production";
function env(db = testDB()) {
  return { DB: db, JARVISH_AUTH_KEY: key, ASSETS: {} as Fetcher };
}
const post = (
  path: string,
  body: unknown,
  auth = true,
  extra: Record<string, string> = {},
) =>
  new Request(`https://jarvish.test${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(auth ? { Authorization: `Bearer ${key}` } : {}),
      ...extra,
    },
    body: JSON.stringify(body),
  });
describe("providers", () => {
  it("falls back from unavailable local to working provider", async () =>
    expect(
      (
        await new ProviderRouter([
          new UnavailableLocalProvider(),
          provider("Hello"),
        ]).generate({ messages: [] })
      ).content,
    ).toBe("Hello"));
  it("normalizes unavailable providers", async () =>
    expect(
      new ProviderRouter([
        new UnavailableLocalProvider(),
        new GroqProvider(),
      ]).generate({ messages: [] }),
    ).rejects.toMatchObject({ code: "NO_PROVIDER" }));
  it("rejects malformed normalized provider response and falls back", async () => {
    const bad = provider("");
    expect(
      (
        await new ProviderRouter([bad, provider("good")]).generate({
          messages: [],
        })
      ).content,
    ).toBe("good");
  });
  it("translates Groq request without leaking key into content", async () => {
    const fake = vi.fn(async (_url: any, init: any) => {
      const b = JSON.parse(init.body);
      expect(b.response_format.type).toBe("json_object");
      expect(init.headers.Authorization).toBe("Bearer test-only");
      expect(init.body).not.toContain("test-only");
      return Response.json({
        model: "actual-model",
        choices: [{ message: { content: "hello" } }],
      });
    });
    const result = await new GroqProvider(
      "test-only",
      "configured-model",
      fake as typeof fetch,
    ).generate({ messages: [{ role: "user", content: "hi" }], json: true });
    expect(result.model).toBe("actual-model");
  });
  it("rejects malformed Groq payload", async () =>
    expect(
      new GroqProvider(
        "test-only",
        "model",
        async () => Response.json({ choices: [] }) as any,
      ).generate({ messages: [] }),
    ).rejects.toMatchObject({ code: "MALFORMED_RESPONSE" }));
  it("normalizes HTTP 429", async () =>
    expect(
      new GroqProvider(
        "test-only",
        "model",
        async () => new Response("", { status: 429 }) as any,
      ).generate({ messages: [] }),
    ).rejects.toMatchObject({ code: "RATE_LIMIT", retryable: true }));
  it("normalizes network errors without leaking raw error", async () =>
    expect(
      new GroqProvider("test-only", "model", async () => {
        throw new Error("sensitive details");
      }).generate({ messages: [] }),
    ).rejects.toMatchObject({
      code: "PROVIDER_NETWORK",
      message: "Groq connection failed",
    }));
});
describe("core and permissions", () => {
  it.each([0, 1])("permits level %i", (level) =>
    expect(() => assertPermission(level as 0 | 1, false)).not.toThrow(),
  );
  it.each([2, 3])("requires explicit confirmation at level %i", (level) => {
    expect(() => assertPermission(level as 2 | 3, false)).toThrow();
    expect(() => assertPermission(level as 2 | 3, true)).not.toThrow();
  });
  it("plans only registered tools", async () => {
    const engine = new JarvishEngine([
      provider(
        '{"reply":"A plan, not done","steps":[{"tool":"test","input":{}}]}',
      ),
    ]);
    engine.registerTool(testTool());
    expect(
      (await engine.plan("hi", { sessionId: "x", memories: [] })).steps[0].tool,
    ).toBe("test");
  });
  it("rejects malformed JSON plan", async () =>
    expect(
      new JarvishEngine([provider("not JSON")]).plan("hi", {
        sessionId: "x",
        memories: [],
      }),
    ).rejects.toMatchObject({ code: "MALFORMED_PLAN" }));
  it("rejects hallucinated tool", async () =>
    expect(
      new JarvishEngine([
        provider('{"reply":"hi","steps":[{"tool":"shell","input":{}}]}'),
      ]).plan("hi", { sessionId: "x", memories: [] }),
    ).rejects.toMatchObject({ code: "UNKNOWN_TOOL" }));
  it("rejects duplicate tool registration", () => {
    const r = new ToolRegistry();
    r.register(testTool());
    expect(() => r.register(testTool())).toThrow();
  });
  it("rejects more than four steps", async () => {
    const engine = new JarvishEngine([
      provider(
        JSON.stringify({
          reply: "hi",
          steps: Array(5).fill({ tool: "test", input: {} }),
        }),
      ),
    ]);
    engine.registerTool(testTool());
    await expect(
      engine.plan("hi", { sessionId: "x", memories: [] }),
    ).rejects.toMatchObject({ code: "MALFORMED_PLAN" });
  });
});
describe("memory and tool validation", () => {
  it("validates kinds, limits, importance and credentials", () => {
    for (const bad of [
      { kind: "anything", content: "x" },
      { kind: "user", content: "" },
      { kind: "user", content: "x", importance: 8 },
      { kind: "user", content: "api_key = secret" },
    ])
      expect(memorySchema.safeParse(bad).success).toBe(false);
  });
  it("persists and reads real SQLite memory", async () => {
    const store = new MemoryStore(testDB());
    const item = await store.save({
      kind: "preference",
      content: "Use Indonesian",
      importance: 3,
    });
    expect(await store.get(item.id)).toMatchObject(item);
    expect((await store.retrieve("Indonesian")).length).toBe(1);
  });
  it("retains bounded chronological history", async () => {
    const store = new MemoryStore(testDB());
    await store.record("session", "hi", "hello");
    expect(await store.history("session")).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ]);
  });
  it("rejects SSRF, credentials, nonallowlisted URLs and redirects", () => {
    const r = createTools({ DB: testDB() });
    for (const url of [
      "http://example.com",
      "https://127.0.0.1",
      "https://example.com.evil.test",
      "https://user:pass@example.com",
      "https://example.com:444",
    ])
      expect(() => r.get("web.fetch").validate({ url })).toThrow();
  });
  it("rejects repositories outside the allowlist", () =>
    expect(() =>
      createTools({ DB: testDB() })
        .get("github.inspect")
        .validate({ repo: "other/private" }),
    ).toThrow());
  it("verifies GitHub branch with second GET, not POST result", async () => {
    const calls: string[] = [];
    const sha = "a".repeat(40);
    const fake = async (url: any, init: any) => {
      calls.push(init.method);
      return Response.json(
        calls.length === 1
          ? { object: { sha } }
          : calls.length === 2
            ? { ref: "created" }
            : { ref: "refs/heads/new-branch", object: { sha } },
      );
    };
    const t = createTools(
      { DB: testDB(), GITHUB_TOKEN: "test-only" },
      fake as any,
    ).get("github.branch.create");
    const input = t.validate({
      repo: "Sparkmind-obp-off/Jarvish",
      branch: "new-branch",
    });
    const result = await t.execute(input, new AbortController().signal);
    expect(await t.verify(input, result, new AbortController().signal)).toBe(
      true,
    );
    expect(calls).toEqual(["GET", "POST", "GET"]);
  });
});
describe("execution and checkpoint", () => {
  it("creates, runs, verifies, stores evidence and blocks replay", async () => {
    const db = testDB();
    const r = new ToolRegistry();
    r.register(testTool());
    const e = new ExecutionEngine(db, r);
    const row = await e.create([{ tool: "test", input: {} }]);
    expect(row.status).toBe("READY");
    const result = await e.run(row.id);
    expect(result).toMatchObject({
      status: "COMPLETE",
      verified: 1,
      checkpoint: 1,
    });
    expect(
      (await e.evidence(row.id)).filter((item) => item.kind === "verification")
        .length,
    ).toBe(1);
    await expect(e.run(row.id)).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it.each([1, 2, 3])("enforces approval for level %i", async (level) => {
    const db = testDB();
    const r = new ToolRegistry();
    r.register(testTool(level as 1 | 2 | 3));
    const e = new ExecutionEngine(db, r);
    const row = await e.create([{ tool: "test", input: {} }]);
    expect(row.status).toBe("AWAITING_APPROVAL");
    await expect(e.run(row.id)).rejects.toThrow();
    await e.approve(row.id);
    expect((await e.run(row.id))?.verified).toBe(1);
  });
  it("never claims success on failed verification", async () => {
    const r = new ToolRegistry();
    r.register(testTool(0, false));
    const e = new ExecutionEngine(testDB(), r);
    const row = await e.create([{ tool: "test", input: {} }]);
    expect(await e.run(row.id)).toMatchObject({
      status: "FAILED",
      verified: 0,
      error_code: "VERIFICATION_FAILED",
      checkpoint: 0,
    });
  });
  it("read-only retry preserves checkpoint and caps attempts at 2", async () => {
    let firstCalls = 0;
    let secondCalls = 0;
    const r = new ToolRegistry();
    r.register({
      ...testTool(),
      name: "first",
      execute: async () => {
        firstCalls++;
        return { output: {}, evidence: { source: "test" } };
      },
    });
    r.register({
      ...testTool(),
      name: "second",
      execute: async () => {
        if (++secondCalls === 1) throw new RuntimeError("NETWORK", "test");
        return { output: {}, evidence: { source: "test" } };
      },
    });
    const e = new ExecutionEngine(testDB(), r);
    const row = await e.create([
      { tool: "first", input: {} },
      { tool: "second", input: {} },
    ]);
    expect(await e.run(row.id)).toMatchObject({
      status: "FAILED",
      checkpoint: 1,
    });
    expect(await e.retry(row.id)).toMatchObject({
      status: "COMPLETE",
      checkpoint: 2,
      attempts: 2,
    });
    expect(firstCalls).toBe(1);
    expect(secondCalls).toBe(2);
    await expect(e.retry(row.id)).rejects.toMatchObject({
      code: "RETRY_FORBIDDEN",
    });
  });
  it("forbids retry of writes after uncertain failure", async () => {
    const r = new ToolRegistry();
    r.register(testTool(2, false));
    const e = new ExecutionEngine(testDB(), r);
    const row = await e.create([{ tool: "test", input: {} }]);
    await e.approve(row.id);
    await e.run(row.id);
    await expect(e.retry(row.id)).rejects.toMatchObject({
      code: "RETRY_FORBIDDEN",
    });
  });
  it("prevents concurrent execution claim", async () => {
    const r = new ToolRegistry();
    r.register(testTool());
    const e = new ExecutionEngine(testDB(), r);
    const row = await e.create([{ tool: "test", input: {} }]);
    const results = await Promise.allSettled([e.run(row.id), e.run(row.id)]);
    expect(results.filter((r) => r.status === "fulfilled").length).toBe(1);
  });
});
describe("API boundary", () => {
  it("public health queries storage", async () => {
    const r = await app.fetch(
      new Request("https://jarvish.test/health"),
      env(),
    );
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, service: "jarvish" });
  });
  it("protects all private APIs", async () => {
    const r = await app.fetch(
      new Request("https://jarvish.test/api/memories"),
      env(),
    );
    expect(r.status).toBe(401);
  });
  it("fails closed with no auth secret", async () => {
    const r = await app.fetch(new Request("https://jarvish.test/api/status"), {
      DB: testDB(),
    } as any);
    expect(r.status).toBe(503);
  });
  it("rejects cross-origin mutation", async () => {
    const r = await app.fetch(
      post("/api/memories", {}, true, { Origin: "https://evil.test" }),
      env(),
    );
    expect(r.status).toBe(403);
  });
  it("rejects invalid request", async () =>
    expect(
      (await app.fetch(post("/api/chat", { input: "" }), env())).status,
    ).toBe(400));
  it("normalizes provider unavailable; never fakes a reply", async () => {
    const r = await app.fetch(post("/api/chat", { input: "hello" }), env());
    expect(r.status).toBe(503);
    expect(await r.json()).toMatchObject({ error: { code: "NO_PROVIDER" } });
  });
  it("creates memory approval then verifies through API", async () => {
    const bindings = env();
    const r = await app.fetch(
      post("/api/memories", {
        kind: "project",
        content: "Jarvish is independent",
        importance: 3,
      }),
      bindings,
    );
    expect(r.status).toBe(201);
    const { execution } = (await r.json()) as any;
    expect(execution.status).toBe("AWAITING_APPROVAL");
    expect(
      (
        await app.fetch(
          post(`/api/executions/${execution.id}/run`, {}),
          bindings,
        )
      ).status,
    ).toBe(403);
    await app.fetch(
      post(`/api/executions/${execution.id}/approve`, {}),
      bindings,
    );
    const done = await app.fetch(
      post(`/api/executions/${execution.id}/run`, {}),
      bindings,
    );
    expect(((await done.json()) as any).execution.verified).toBe(1);
  });
  it("refuses plan override on approval", async () => {
    const bindings = env();
    const r = await app.fetch(
      post("/api/memories", { kind: "user", content: "safe" }),
      bindings,
    );
    const { execution } = (await r.json()) as any;
    expect(
      (
        await app.fetch(
          post(`/api/executions/${execution.id}/approve`, { steps: [] }),
          bindings,
        )
      ).status,
    ).toBe(400);
  });
  it("uses secure HttpOnly cookie and permits authenticated session", async () => {
    const bindings = env();
    const login = await app.fetch(
      post("/api/auth/login", { key }, false),
      bindings,
    );
    expect(login.status).toBe(200);
    const cookie = login.headers.get("set-cookie")!;
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Strict");
    const status = await app.fetch(
      new Request("https://jarvish.test/api/status", {
        headers: { Cookie: cookie.split(";")[0] },
      }),
      bindings,
    );
    expect(status.status).toBe(200);
    const logout = await app.fetch(
      new Request("https://jarvish.test/api/auth/logout", {
        method: "POST",
        headers: {
          Cookie: cookie.split(";")[0],
          "Content-Type": "application/json",
        },
        body: "{}",
      }),
      bindings,
    );
    expect(logout.status).toBe(200);
    expect(
      (
        await app.fetch(
          new Request("https://jarvish.test/api/status", {
            headers: { Cookie: cookie.split(";")[0] },
          }),
          bindings,
        )
      ).status,
    ).toBe(401);
  });
  it("rate-limits brute-force login", async () => {
    const bindings = env();
    for (let i = 0; i < 5; i++)
      expect(
        (
          await app.fetch(
            post(
              "/api/auth/login",
              { key: "wrong-test-key-long-enough" },
              false,
            ),
            bindings,
          )
        ).status,
      ).toBe(401);
    expect(
      (await app.fetch(post("/api/auth/login", { key }, false), bindings))
        .status,
    ).toBe(429);
  });
  it("rejects oversized body", async () =>
    expect(
      (await app.fetch(post("/api/chat", { input: "x".repeat(40000) }), env()))
        .status,
    ).toBe(413));
});
describe("edge regression and complete request flow", () => {
  it("rejects web redirects using Workers-supported manual mode", async () => {
    const fake = vi.fn(async (_url, init) => {
      expect(init.redirect).toBe("manual");
      return new Response("", {
        status: 302,
        headers: { Location: "https://127.0.0.1" },
      });
    });
    const t = createTools({ DB: testDB() }, fake as any).get("web.fetch");
    await expect(
      t.execute({ url: "https://example.com" }, new AbortController().signal),
    ).rejects.toMatchObject({ code: "WEB_HTTP" });
    expect(fake).toHaveBeenCalledTimes(1);
  });
  it("provider timeout is normalized", async () => {
    vi.useFakeTimers();
    try {
      const fake = (_u: any, init: any) =>
        new Promise<Response>((_, reject) =>
          init.signal.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          ),
        );
      const result = new GroqProvider(
        "test-only",
        "model",
        fake as any,
      ).generate({ messages: [] });
      const assertion = expect(result).rejects.toMatchObject({
        code: "PROVIDER_TIMEOUT",
      });
      await vi.advanceTimersByTimeAsync(25001);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
  it("late tool completion cannot overwrite FAILED after timeout", async () => {
    let release: (value: any) => void = () => {};
    const r = new ToolRegistry();
    r.register({
      ...testTool(),
      timeout: 10,
      execute: () => new Promise((resolve) => (release = resolve)),
    });
    const e = new ExecutionEngine(testDB(), r);
    const row = await e.create([{ tool: "test", input: {} }]);
    expect(await e.run(row.id)).toMatchObject({
      status: "FAILED",
      error_code: "TOOL_TIMEOUT",
    });
    release({ output: {}, evidence: { source: "late" } });
    await new Promise((r) => setTimeout(r, 20));
    expect(await e.get(row.id)).toMatchObject({
      status: "FAILED",
      checkpoint: 0,
    });
  });
  it("missing production D1 fails closed with actionable error", async () => {
    const bindings = { JARVISH_AUTH_KEY: key } as any;
    expect(
      (await app.fetch(new Request("https://jarvish.test/health"), bindings))
        .status,
    ).toBe(503);
    const r = await app.fetch(
      post("/api/auth/login", { key }, false),
      bindings,
    );
    expect(r.status).toBe(503);
    expect(await r.json()).toMatchObject({
      error: { code: "STORAGE_UNAVAILABLE" },
    });
  });
  it("full provider/core/API/memory request using an explicitly mocked Groq HTTP response", async () => {
    const bindings = { ...env(), GROQ_API_KEY: "test-only-key" };
    const requestFetch = vi.fn(async () =>
      Response.json({
        model: "test-model",
        choices: [
          {
            message: {
              content: JSON.stringify({
                reply: "Test fixture: understood",
                steps: [{ tool: "memory.search", input: { query: "Jarvish" } }],
              }),
            },
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", requestFetch);
    try {
      const r = await app.fetch(
        post("/api/chat", { input: "Read Jarvish context" }),
        bindings,
      );
      expect(r.status).toBe(200);
      const body = (await r.json()) as any;
      expect(body.execution.status).toBe("READY");
      expect(body.provider).toBe("groq");
      expect(
        (await new MemoryStore(bindings.DB).history(body.sessionId)).length,
      ).toBe(2);
      expect(requestFetch).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
