import { Hono } from "hono";
import { serveStatic } from "hono/cloudflare-workers";
import { bodyLimit } from "hono/body-limit";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { z } from "zod";
import { JarvishEngine } from "../../core/src/engine.js";
import { RuntimeError, JARVISH_VERSION } from "../../core/src/index.js";
import { GroqProvider } from "../../providers/groq/index.js";
import { UnavailableLocalProvider } from "../../providers/local/index.js";
import { MemoryStore } from "../../memory/src/store.js";
import { createTools, type ToolEnv } from "../../tools/src/registry.js";
import { ExecutionEngine } from "../../execution/src/engine.js";
export interface Env extends ToolEnv {
  ASSETS: Fetcher;
  JARVISH_ENV?: string;
  GROQ_API_KEY?: string;
  GROQ_MODEL?: string;
  JARVISH_AUTH_KEY?: string;
}
const app = new Hono<{ Bindings: Env; Variables: { requestId: string } }>();
export async function hash(value: string) {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
  ]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}
app.use("*", async (c, next) => {
  const id = crypto.randomUUID();
  const start = Date.now();
  c.set("requestId", id);
  c.header("X-Request-ID", id);
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "no-referrer");
  c.header("Permissions-Policy", "camera=(), microphone=(self)");
  c.header(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; media-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  );
  if (c.req.path.startsWith("/api")) c.header("Cache-Control", "no-store");
  await next();
  console.log(
    JSON.stringify({
      event: "request",
      request_id: id,
      path: c.req.path.replace(/[0-9a-f-]{36}/g, ":id"),
      method: c.req.method,
      status: c.res.status,
      latency: Date.now() - start,
    }),
  );
});
app.use(
  "/api/*",
  bodyLimit({
    maxSize: 32768,
    onError: (c) =>
      c.json(
        {
          error: {
            code: "BODY_TOO_LARGE",
            message: "Maximum body size is 32 KiB",
          },
        },
        413,
      ),
  }),
);
app.use("/api/*", async (c, next) => {
  if (c.req.method !== "GET") {
    const origin = c.req.header("Origin");
    if (origin && origin !== new URL(c.req.url).origin)
      return c.json(
        {
          error: {
            code: "ORIGIN_DENIED",
            message: "Cross-origin requests are refused",
          },
        },
        403,
      );
    if (c.req.header("Sec-Fetch-Site") === "cross-site")
      return c.json(
        {
          error: {
            code: "ORIGIN_DENIED",
            message: "Cross-site requests are refused",
          },
        },
        403,
      );
    if (!c.req.header("Content-Type")?.startsWith("application/json"))
      return c.json(
        { error: { code: "CONTENT_TYPE", message: "Use application/json" } },
        415,
      );
  }
  await next();
});
async function rate(db: D1Database, bucket: string, limit: number) {
  const now = Math.floor(Date.now() / 1000);
  const row = await db
    .prepare(
      "INSERT INTO rate_limits(bucket,hits,expires_at) VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET hits=CASE WHEN expires_at<? THEN 1 ELSE hits+1 END,expires_at=CASE WHEN expires_at<? THEN excluded.expires_at ELSE expires_at END RETURNING hits",
    )
    .bind(bucket, now + 60, now, now)
    .first<{ hits: number }>();
  return Boolean(row && row.hits <= limit);
}
app.get("/health", async (c) => {
  try {
    await c.env.DB.prepare("SELECT id FROM sessions LIMIT 1").first();
    return c.json({ ok: true, service: "jarvish", version: JARVISH_VERSION });
  } catch {
    return c.json(
      { ok: false, service: "jarvish", error: "STORAGE_UNAVAILABLE" },
      503,
    );
  }
});
app.post("/api/auth/login", async (c) => {
  if (!c.env.DB)
    return c.json(
      {
        error: {
          code: "STORAGE_UNAVAILABLE",
          message:
            "Production D1 is not bound. Create the dedicated Jarvish database after freeing D1 quota, apply migrations, and redeploy.",
        },
      },
      503,
    );
  if (!c.env.JARVISH_AUTH_KEY)
    return c.json(
      {
        error: {
          code: "AUTH_NOT_CONFIGURED",
          message: "Owner access is not configured",
        },
      },
      503,
    );
  const ip = c.req.header("CF-Connecting-IP") ?? "local";
  if (!(await rate(c.env.DB, `login:${await hash(ip)}`, 5)))
    return c.json(
      {
        error: {
          code: "RATE_LIMIT",
          message: "Too many login attempts; wait one minute",
        },
      },
      429,
    );
  const { key } = z
    .object({ key: z.string().min(20).max(256) })
    .strict()
    .parse(await c.req.json());
  if ((await hash(key)) !== (await hash(c.env.JARVISH_AUTH_KEY)))
    return c.json(
      { error: { code: "UNAUTHORIZED", message: "Invalid owner access key" } },
      401,
    );
  const token = crypto.randomUUID() + crypto.randomUUID();
  await c.env.DB.prepare(
    "INSERT INTO auth_sessions(token_hash,expires_at) VALUES(?,?)",
  )
    .bind(await hash(token), Math.floor(Date.now() / 1000) + 43200)
    .run();
  setCookie(c, "jarvish_session", token, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === "https:",
    sameSite: "Strict",
    path: "/",
    maxAge: 43200,
  });
  // Cleanup is request-driven: no cron or external platform dependency.
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM auth_sessions WHERE expires_at<?").bind(
      Math.floor(Date.now() / 1000),
    ),
    c.env.DB.prepare("DELETE FROM rate_limits WHERE expires_at<?").bind(
      Math.floor(Date.now() / 1000) - 3600,
    ),
  ]);
  return c.json({ ok: true });
});
app.use("/api/*", async (c, next) => {
  if (!c.env.JARVISH_AUTH_KEY)
    return c.json(
      {
        error: {
          code: "AUTH_NOT_CONFIGURED",
          message: "Owner access is not configured",
        },
      },
      503,
    );
  const bearer = c.req.header("Authorization")?.replace(/^Bearer /, "");
  let allowed = false;
  if (bearer)
    allowed = (await hash(bearer)) === (await hash(c.env.JARVISH_AUTH_KEY));
  else {
    const token = getCookie(c, "jarvish_session");
    if (token && c.env.DB) {
      const session = await c.env.DB.prepare(
        "SELECT expires_at FROM auth_sessions WHERE token_hash=?",
      )
        .bind(await hash(token))
        .first<{ expires_at: number }>();
      allowed = Boolean(
        session && session.expires_at > Math.floor(Date.now() / 1000),
      );
    }
  }
  if (!allowed)
    return c.json(
      {
        error: {
          code: "UNAUTHORIZED",
          message: "Sign in with your owner access key",
        },
      },
      401,
    );
  if (!c.env.DB)
    return c.json(
      {
        error: {
          code: "STORAGE_UNAVAILABLE",
          message:
            "Dedicated Jarvish D1 is not configured; storage-dependent operations are disabled.",
        },
      },
      503,
    );
  if (c.req.method !== "GET" && !(await rate(c.env.DB, "owner:write", 30)))
    return c.json(
      {
        error: {
          code: "RATE_LIMIT",
          message: "Maximum 30 write requests per minute",
        },
      },
      429,
    );
  await next();
});
app.post("/api/auth/logout", async (c) => {
  const token = getCookie(c, "jarvish_session");
  if (token)
    await c.env.DB.prepare("DELETE FROM auth_sessions WHERE token_hash=?")
      .bind(await hash(token))
      .run();
  deleteCookie(c, "jarvish_session", { path: "/" });
  return c.json({ ok: true });
});
app.get("/api/status", async (c) =>
  c.json({
    version: JARVISH_VERSION,
    environment: c.env.JARVISH_ENV ?? "development",
    providers: [
      {
        id: "groq",
        ...(await new GroqProvider(
          c.env.GROQ_API_KEY,
          c.env.GROQ_MODEL,
        ).health()),
      },
      { id: "local", ...(await new UnavailableLocalProvider().health()) },
    ],
    voice: {
      stt: "browser Web Speech API (browser-dependent; may use browser vendor cloud)",
      tts: "browser speechSynthesis",
      local: "not connected",
    },
    tools: createTools(c.env)
      .list()
      .map(({ name, description, permission, inputSchema }) => ({
        name,
        description,
        permission,
        inputSchema,
      })),
  }),
);
const chatSchema = z
  .object({
    input: z.string().trim().min(1).max(8000),
    sessionId: z.string().uuid().optional(),
  })
  .strict();
app.post("/api/chat", async (c) => {
  const { input, sessionId = crypto.randomUUID() } = chatSchema.parse(
    await c.req.json(),
  );
  const memory = new MemoryStore(c.env.DB);
  const registry = createTools(c.env);
  const engine = new JarvishEngine([
    new GroqProvider(c.env.GROQ_API_KEY, c.env.GROQ_MODEL),
  ]);
  registry.list().forEach((t) => engine.registerTool(t));
  const context = await memory.retrieve(input);
  const result = await engine.plan(input, {
    sessionId,
    memories: context.map((m) => JSON.stringify(m)),
    history: await memory.history(sessionId),
  });
  const execution = result.steps.length
    ? await new ExecutionEngine(c.env.DB, registry).create(result.steps)
    : null;
  await memory.record(sessionId, input, result.reply);
  return c.json({ ...result, sessionId, execution });
});
app.get("/api/memories", async (c) =>
  c.json({
    memories: await new MemoryStore(c.env.DB).list(c.req.query("q") ?? ""),
  }),
);
// Memory mutations go through the execution engine, including approval and read-back verification.
app.post("/api/memories", async (c) => {
  const engine = new ExecutionEngine(c.env.DB, createTools(c.env));
  return c.json(
    {
      execution: await engine.create([
        { tool: "memory.save", input: await c.req.json() },
      ]),
    },
    201,
  );
});
app.get("/api/tools", (c) =>
  c.json({
    tools: createTools(c.env)
      .list()
      .map(({ name, description, permission, inputSchema, timeout }) => ({
        name,
        description,
        permission,
        inputSchema,
        timeout,
      })),
  }),
);
app.post("/api/executions", async (c) => {
  const { steps } = z
    .object({
      steps: z
        .array(z.object({ tool: z.string(), input: z.unknown() }).strict())
        .min(1)
        .max(4),
    })
    .strict()
    .parse(await c.req.json());
  return c.json(
    {
      execution: await new ExecutionEngine(c.env.DB, createTools(c.env)).create(
        steps,
      ),
    },
    201,
  );
});
app.get("/api/executions", async (c) =>
  c.json({
    executions: await new ExecutionEngine(c.env.DB, createTools(c.env)).list(),
  }),
);
app.get("/api/executions/:id", async (c) => {
  const id = z.string().uuid().parse(c.req.param("id"));
  const engine = new ExecutionEngine(c.env.DB, createTools(c.env));
  const execution = await engine.get(id);
  if (!execution)
    return c.json(
      { error: { code: "NOT_FOUND", message: "Execution not found" } },
      404,
    );
  return c.json({ execution, evidence: await engine.evidence(id) });
});
app.post("/api/executions/:id/:action", async (c) => {
  const id = z.string().uuid().parse(c.req.param("id"));
  const action = z
    .enum(["approve", "run", "retry"])
    .parse(c.req.param("action"));
  z.object({})
    .strict()
    .parse(await c.req.json()); // Cannot override the immutable approved plan.
  const engine = new ExecutionEngine(c.env.DB, createTools(c.env));
  const execution =
    action === "approve"
      ? await engine.approve(id)
      : action === "retry"
        ? await engine.retry(id)
        : await engine.run(id);
  return c.json({ execution, evidence: await engine.evidence(id) });
});
app.use("/static/*", serveStatic({ root: "./public" }));
app.notFound((c) =>
  c.json({ error: { code: "NOT_FOUND", message: "Route not found" } }, 404),
);
app.onError((error, c) => {
  let code = "INTERNAL_ERROR";
  let message = "Request failed; check structured server logs";
  let status: 400 | 403 | 404 | 409 | 500 | 503 = 500;
  if (error instanceof z.ZodError || error instanceof SyntaxError) {
    code = "INVALID_REQUEST";
    message = "Invalid request or tool input";
    status = 400;
  } else if (error instanceof RuntimeError) {
    code = error.code;
    message = error.message;
    status =
      code === "NOT_FOUND"
        ? 404
        : ["CONFLICT", "RETRY_FORBIDDEN"].includes(code)
          ? 409
          : ["APPROVAL_REQUIRED"].includes(code)
            ? 403
            : ["NO_PROVIDER", "NOT_CONFIGURED"].includes(code)
              ? 503
              : 400;
  } else if (error.message === "Confirmation required for this action.") {
    code = "APPROVAL_REQUIRED";
    message = error.message;
    status = 403;
  }
  console.log(
    JSON.stringify({ event: "failure", request_id: c.get("requestId"), code }),
  );
  return c.json(
    { error: { code, message }, requestId: c.get("requestId") },
    status,
  );
});
export default app;
