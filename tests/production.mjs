import assert from "node:assert/strict";
const origin = process.env.PRODUCTION_URL ?? "https://jarvish-apv.pages.dev";
const degraded = process.env.EXPECT_DEGRADED === "1";
const home = await fetch(origin);
assert.equal(home.status, 200);
assert.match(await home.text(), /Jarvish/);
assert.ok(home.headers.get("content-security-policy"));
console.log("PASS production shell HTTP 200 + CSP");
const css = await fetch(origin + "/static/style.css");
assert.equal(css.status, 200);
console.log("PASS production CSS HTTP 200");
const health = await fetch(origin + "/health");
const healthData = await health.json();
if (degraded) {
  assert.equal(health.status, 503);
  assert.equal(healthData.error, "STORAGE_UNAVAILABLE");
  console.log(
    "PASS explicitly expected degraded D1 health 503 (NOT operational)",
  );
} else {
  assert.equal(
    health.status,
    200,
    "Production readiness FAILED; D1 activation required. EXPECT_DEGRADED=1 checks only safe failure behavior.",
  );
  assert.equal(healthData.ok, true);
  console.log(
    "PASS production D1 health 200 (live AI still requires separate verification)",
  );
}
const privateAPI = await fetch(origin + "/api/memories");
assert.ok([401, 503].includes(privateAPI.status));
assert.ok((await privateAPI.json()).error);
console.log("PASS private API fails closed without owner authentication");
const login = await fetch(origin + "/api/auth/login", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ key: "test-only-not-a-real-key" }),
});
assert.equal(login.status, degraded ? 503 : 401);
console.log("PASS invalid owner login or explicit storage-blocked response");
const csrf = await fetch(origin + "/api/memories", {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: "https://evil.test" },
  body: "{}",
});
assert.equal(csrf.status, 403);
console.log("PASS cross-origin writes refused");
console.log(
  degraded
    ? "6 degraded-production checks passed. Production operator/AI runtime is NOT operational."
    : "6 infrastructure checks passed. Authenticate and test real Groq/voice/tools before an operational claim.",
);
