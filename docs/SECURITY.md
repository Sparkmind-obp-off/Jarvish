# Jarvish Security

## Credentials and independent deployment

Never commit Groq/GitHub/Cloudflare tokens, owner access keys, session cookies or private keys. `.env*`, `.dev.vars*`, `secrets/`, Wrangler state and test artifacts are ignored. `.env.example` contains no credential value. Provider credentials stay server-side. Browser login accepts only the owner's application key, clears it after login, and never stores it in localStorage. localStorage stores a session UUID only, not an authorization token.

Production secrets are configured in Cloudflare Pages → jarvish → Settings → Variables and Secrets → Production. Required: `JARVISH_AUTH_KEY` (private random 32+ character value); `GROQ_API_KEY` for live AI. Optional: repository-scoped `GITHUB_TOKEN` for private read/branch tools. Development authorization tokens are not implicitly copied into production. Deployment uses the user's Cloudflare BYOK account; Jarvish has no Genspark runtime authentication/API dependency.

## Single-owner API boundary

One owner per deployment, not a multi-user service. Public shell contains no private data. `/health` is public; all data/tool/provider APIs require owner bearer authentication or a valid session cookie. Login sessions are random, stored only as SHA-256 digests in D1, expire after 12 hours and can be revoked by logout. Production cookies are Secure, HttpOnly, SameSite=Strict. Local HTTP development is the only non-Secure-cookie case.

Mutation requests enforce same origin and `application/json`, reject unknown JSON properties and limit request body to 32 KiB. CSP blocks third-party scripts, frames, inline execution and cross-origin connections. External data is rendered with text nodes, never innerHTML. Login attempts are limited to five per IP/minute, authenticated mutations to 30/minute using D1. Configure infrastructure-level rate/WAF limits for high-volume traffic; application rate limits do not eliminate volumetric attacks.

Missing auth secret or DB fails closed (503); invalid/missing credentials are refused (401). No public provider inference, tool execution or memory access. Database-limit failure is not bypassed by binding another project's DB.

## Permission and tool constraints

All tools have input schema, permission, timeout, handler and verifier. Registered permission must be 0–3. Every write is approval-gated; level 2/3 cannot be approved by the LLM. Approval acts on the immutable stored execution ID and accepts no plan override. Plans are bounded to four steps. Atomic D1 claims prevent duplicate/concurrent execution. Checkpoints advance only after verified evidence is persisted. Writes do not retry automatically; read-only plans may retry once.

An external side effect can succeed before verification or network timeout. Such a run is FAILED/unverified, not falsely COMPLETE. Investigate the external service manually before any new write plan. Abrupt worker interruption may leave RUNNING/VERIFYING records; no unsafe automatic recovery is implemented.

GitHub repositories are explicitly allowlisted. Branch writes need a fine-grained token and separate GET verification. Web reads allow HTTPS on configured public hosts only, reject userinfo/nonstandard ports and do not follow redirects. Operators must not add private/internal/resolving-to-private hosts to the allowlist. Returned text remains untrusted; prompt injection cannot supply approvals. The planner marks retrieved data as untrusted, but an LLM instruction alone is not a security boundary: immutable input validation and approval are the enforced boundary.

## Privacy and retention

D1 stores user messages, explicit facts, plans, outputs and evidence. A bounded selection of history/facts is sent to Groq during chat. Browser SpeechRecognition may send audio to the browser vendor; the UI discloses this and does not claim local Whisper. Audio is not stored by Jarvish. Test provider responses exist only in automated fixtures, not runtime fallbacks.

Structured logs contain request ID/path/method/status/latency, provider ID/error code, tool name, execution ID and verification result, never request bodies, tokens, raw exception messages or memory contents. Memory validators reject common token/private-key/password patterns; this is defense-in-depth, not complete secret detection. Users must not submit credentials in chat or tools.

Memory deletion removes the canonical fact after level-3 approval but retains audit history that may include its original write plan/content. Full retention/erasure management and encrypted application-layer memory are not implemented. D1 backups/dashboard access need appropriate Cloudflare account protection. Deployments are owner-scoped; there is no cross-user tenancy claim.
