# Jarvish Architecture — implemented runtime

## Runtime loop

Browser microphone → Web Speech recognition → authenticated Hono `/api/chat` → D1 retrieval/history → provider-neutral JarvishEngine → ProviderRouter → Groq adapter → schema-validated reply/plan → explicit user execution/approval → ToolRegistry → ExecutionEngine → independent verification → D1 checkpoint/evidence → UI + browser TTS.

Plans do not claim completed actions. Tool outputs are rendered directly as verified evidence, not invented by an LLM. Sessions and explicit facts remain in D1. No service simulates local models or external successes.

## Control plane

- `apps/web`: TypeScript/Vite client with conversation, memory, execution and status panels.
- `cloudflare/worker/index.ts`: Hono Pages advanced-mode Worker; authentication, validation, API, structured logs.
- `core/src`: interfaces, permission primitive, sequential fallback routing, bounded JSON planner.
- `providers/groq`: server-side Groq HTTP/timeout/error translation; credentials are Worker secrets.
- `providers/local`: explicitly unavailable until a real separate local inference runtime exists.
- `memory/src`: typed facts and bounded relevance/history queries with parameterized SQL.
- `tools/src`: validated tool registration, schemas, permissions, timeouts, handlers and verifiers.
- `execution/src`: durable state machine and verified checkpoints; atomic D1 update claims.
- `voice/src/browser.ts`: browser STT/TTS; microphone tracks are released after permission testing.
- `database/migrations`: original foundation retained as migration 0001, additive runtime migration 0002.

Production uses dedicated D1. There are no deployed KV/R2/Durable Object/cron services. R2 is appropriate for future binary artifacts, not currently needed. No memory or persistent execution state is kept in Worker memory/files. There is no Node runtime dependency in the bundled Worker; Node is used only by development/build/test/activation scripts.

## Provider contract

`id`, `name`, `capabilities`, `health()`, `generate(request)` → normalized content/provider/model or RuntimeError. Health is a configuration check, not a live inference probe. Groq-specific JSON exists only in its adapter. Additional providers can implement the same interface. Router fallback and malformed-response handling are tested; default API uses Groq only, so it cannot promise live fallback inference.

Memory/history are marked as untrusted user data, not additional system instructions. Maximum 10 memories and 10 recent history messages are supplied. Plans contain at most four independently valid steps, without output-variable interpolation or uncontrolled loops.

## Execution states

`UNDERSTAND/PLAN` occur in the core before durable plan creation.

`READY` (read-only) or `AWAITING_APPROVAL` (write) → explicit approval → atomic claim → `RUNNING` → `VERIFYING` → checkpoint + evidence → `COMPLETE` or `FAILED`.

Every write, including level 1, requires approval (stricter than the minimum). GitHub branch creation is conservatively level 2 because it changes an external repository. Memory deletion is level 3. Approval applies to the stored immutable plan; the approval request cannot replace inputs. Duplicate/concurrent runs are refused. Failed read-only plans can retry once from their last verified checkpoint. Writes never replay automatically, including after ambiguous timeouts. A worker interrupted during RUNNING/VERIFYING requires manual investigation; this build does not automatically recover potentially side-effecting interrupted work.

GitHub branch creation verifies the exact returned SHA with a separate GET ref. Memory writes verify by reading the stored row. Web reads use successful response + nonempty content as sufficient evidence for a read. HTTPS host/repository allowlists constrain network scope; redirects are manual and non-2xx responses are rejected.

## Current infrastructure limitation

Cloudflare D1 creation was rejected at the account database-count limit. No other project's database is reused. Production remains safely degraded without a DB binding; deployment of code alone is not operational readiness. The activation script attaches only a real Cloudflare-returned Jarvish UUID when account quota becomes available.
