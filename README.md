# Jarvish

Independent personal AI operator. Source of truth: https://github.com/Sparkmind-obp-off/Jarvish.
No runtime dependency on Genspark, HOLBERY or Bozq One System.

## Implemented

- Hono control plane bundled as a Cloudflare Pages advanced-mode Worker; Vite/TypeScript browser UI.
- Provider-neutral core, normalized failures and sequential fallback router; real Groq HTTP adapter with JSON-plan validation and 25-second timeout. Local inference explicitly unavailable.
- Structured D1 memory: user, preference, project, task, experience and session; bounded retrieval, validated explicit writes, conversation history.
- Tools: `memory.save`, `memory.search`, `memory.delete`, `github.inspect`, `github.branch.create`, `web.fetch`.
- Durable immutable execution plans, approval, atomic run claims, checkpoints, verification evidence and one read-only retry. Maximum four independent steps; no write replay.
- Browser microphone/STT and speechSynthesis adapters with permission/error handling and listening/thinking/speaking states. Browser STT may use the browser vendor cloud; this is not local Whisper.
- Single-owner authentication, hashed expiring sessions, HttpOnly/SameSite cookies, same-origin mutation checks, rate limits, body limits, CSP and secret-free structured logs.
- Responsive conversation, memory, execution ledger and honest capability-status screens.
- Automated tests and an inactive GitHub CI template (`tests/ci-workflow.example.yml`). The authorized GitHub App lacks workflows permission; no active workflow is claimed.

## Honest deployment status — 2026-10-05

The dedicated Pages project is `jarvish`, with assigned domain **https://jarvish-apv.pages.dev**. Source deployment/verification is recorded in `docs/IMPLEMENTATION_STATUS.md`.

**Production runtime activation is blocked:** Cloudflare refused creation of `jarvish-production` because the account has reached its D1 database limit. Other projects' databases have not been deleted or reused. Production configuration contains no fabricated database ID. Storage-dependent operations fail closed; `/health` returns 503 until D1 is bound and migrated.

`GROQ_API_KEY` is not available, so no live Groq conversation or complete physical voice round trip is claimed. Production owner authentication also requires a configured `JARVISH_AUTH_KEY`.

Local Wrangler D1 memory/approval/execution and a real external HTTPS read have been tested. Provider success tests use explicitly labeled test fixtures, never a simulated production provider.

## Local setup (Node 22+)

```sh
npm ci
cp .env.example .dev.vars
# Set JARVISH_AUTH_KEY to a private random value (32+ characters), optionally set GROQ_API_KEY.
npm run db:local
npm run typecheck
npm test
npm run build
# Sandbox: pm2 start ecosystem.config.cjs
# Outside sandbox: npm run dev:sandbox
```

Local D1 uses `cloudflare/wrangler.jsonc` for migrations and the explicit dev-only `--d1 DB --persist-to cloudflare/.wrangler/state` binding. The production config is `wrangler.jsonc` at the root. Local configuration does not need a production ID. After rebuilding, stop/restart the Wrangler process to avoid transient hot-reload reads while dist is replaced.

Open http://localhost:3000, unlock with the local owner key, and use Memory or Executions without Groq. To save memory: create plan → approve exact plan → execute → inspect evidence. Read plans need execution but not approval. Branch creation needs a repository-scoped GitHub token and level-2 approval. `memory.delete` is level 3 and requires approval; audit history is retained.

### Validation

```sh
npm run typecheck
npm test
npm run build
npm audit
npx playwright install --with-deps chromium
npm run test:e2e # requires running Wrangler + local .dev.vars; uses local test memory only
```

46 automated tests and 16 browser/integration checks passed at the recorded implementation run. The browser suite explicitly labels its mocked successful LLM response; it also tests the real missing-provider failure. Physical microphone/STT/TTS output needs user-device validation.

## Production activation (Cloudflare BYOK)

1. Make room for an independent D1 database by upgrading the account, or explicitly authorize removal of an identified unused database. Never delete/reuse another project's database implicitly.
2. With `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` configured securely, run `node scripts/activate-d1.mjs`. It creates/finds only `jarvish-production`, inserts its returned UUID, applies migrations, validates, deploys and checks D1 health. Commit the resulting non-secret binding change to main.
3. Cloudflare dashboard → Workers & Pages → **jarvish** → Settings → Variables and Secrets → Production: set encrypted secrets `JARVISH_AUTH_KEY` (required, private random owner key) and `GROQ_API_KEY` (required for AI). Alternatively use `npx wrangler pages secret put NAME --project-name jarvish` interactively from a trusted terminal. Redeploy afterwards.
4. Optional `GITHUB_TOKEN`: fine-grained token scoped to permitted repositories, Contents read/write for branch creation. Never use the deployment/GitHub-development token as an implicit runtime credential.
5. Run `npm run deploy`, verify `/health` = 200, owner login, real chat, memory approval/read-back, read tool evidence, then voice from a supported HTTPS browser.

Configuration variables: `GROQ_MODEL` defaults to `llama-3.3-70b-versatile`; `GITHUB_REPOSITORIES` defaults to `Sparkmind-obp-off/Jarvish`; `WEB_ALLOWED_HOSTS` defaults to a small public allowlist. Provider model availability must be verified with a real credential.

No KV, R2, cron or Durable Object resources are provisioned because the implemented runtime does not require them. Evidence is structured D1 data; artifact binary storage is not implemented.

## API entry points

Except `/health` and the login handler, APIs require owner bearer authentication or a valid session cookie. All POST requests use `application/json` and reject unexpected properties.

| Method / path | Input / result |
|---|---|
| `GET /health` | Public storage readiness; 503 is not healthy |
| `POST /api/auth/login` | `{key}` → expiring HttpOnly cookie |
| `POST /api/auth/logout` | `{}` → revoke session |
| `GET /api/status` | Configured providers, voice limitations, tools |
| `POST /api/chat` | `{input, sessionId?}` → reply, immutable proposed execution, sessionId |
| `GET /api/memories?q=` | Bounded structured memory retrieval |
| `POST /api/memories` | `{kind, content, importance?}` → approval plan; not an immediate write |
| `GET /api/tools` | Schemas, permissions and timeouts |
| `POST /api/executions` | `{steps:[{tool,input}]}` → validated immutable plan |
| `GET /api/executions` | Latest 30 executions |
| `GET /api/executions/:id` | Persisted status/output and evidence |
| `POST /api/executions/:id/approve` | `{}` → approval for stored plan only |
| `POST /api/executions/:id/run` | `{}` → execute, verify, checkpoint |
| `POST /api/executions/:id/retry` | `{}` → failed read-only plan, at most once |

## Data architecture and boundaries

D1 tables: sessions, messages, memories, projects, tasks, executions, execution_evidence, auth_sessions, rate_limits. Dedicated project/task CRUD is not implemented; project/task facts can be explicit typed memory. Core owns the provider/tool contracts. Backend owns credentials and permissions. Frontend renders all external text using text nodes, not HTML.

Not implemented: vision, shell/desktop/browser automation, email/calendar, wake word, local Whisper/Piper/Kokoro/Ollama, long-running autonomous/background jobs, multi-user isolation and binary artifacts. V0/V1/V3 functionality is built; V2/V5/V6 maturity is not claimed. Recommended immediate work is activation of dedicated D1 and Groq, followed by a real user voice round trip and opt-in repository-scoped GitHub action validation.
