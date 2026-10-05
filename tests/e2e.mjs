import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { readFileSync, mkdirSync } from "node:fs";
const base = process.env.TEST_BASE_URL ?? "http://localhost:3000";
const key =
  process.env.JARVISH_TEST_KEY ??
  readFileSync(".dev.vars", "utf8").match(/^JARVISH_AUTH_KEY=(.+)$/m)[1];
const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox"],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1050 },
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
let passed = 0;
const pass = (label) => {
  passed++;
  console.log(`PASS ${label}`);
};
async function request(path, body) {
  const response = await page.request.fetch(base + "/api" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { data: body }),
  });
  return { response, data: await response.json() };
}
try {
  const health = await page.request.get(base + "/health");
  assert.equal(health.status(), 200);
  pass("real Wrangler D1 health");
  const denied = await page.request.get(base + "/api/memories");
  assert.equal(denied.status(), 401);
  pass("private API denied without session");
  await page.goto(base);
  await page.locator("#owner-key").fill(key);
  await page.getByRole("button", { name: "Unlock workspace" }).click();
  await page.locator("#runtime:not([hidden])").waitFor();
  await page.locator("#status").filter({ hasText: "IDLE" }).waitFor();
  assert.equal(await page.locator("#owner-key").inputValue(), "");
  pass("browser owner login, cookie and no retained key");
  const cookie = (await context.cookies()).find(
    (c) => c.name === "jarvish_session",
  );
  assert.equal(cookie.httpOnly, true);
  assert.equal(cookie.sameSite, "Strict");
  pass("session cookie security");
  await page.locator("#speak-replies").uncheck();
  await page.locator("[data-tab=memory]").click();
  const content = `Local E2E preference ${Date.now()}`;
  await page.locator("#memory-content").fill(content);
  await page.locator("#memory-form button[type=submit]").click();
  const card = page
    .locator("#memory-list .data-card")
    .filter({ hasText: "AWAITING_APPROVAL" })
    .first();
  await card.waitFor();
  pass("memory mutation creates approval plan rather than writing silently");
  page.on("dialog", (d) => d.accept());
  await card.getByRole("button", { name: "Approve this exact plan" }).click();
  await page
    .locator("#memory-list .data-card")
    .filter({ hasText: "READY" })
    .first()
    .getByRole("button", { name: "Execute & verify" })
    .click();
  await page.waitForFunction(
    (text) => document.getElementById("memory-list").textContent.includes(text),
    content,
  );
  const stored = (await request("/memories")).data.memories.find(
    (m) => m.content === content,
  );
  assert.ok(stored?.id);
  pass("real D1 write/read-back verification via browser");
  await page.reload();
  await page.locator("#runtime:not([hidden])").waitFor();
  await page.locator("[data-tab=memory]").click();
  await page.waitForFunction(
    (text) => document.getElementById("memory-list").textContent.includes(text),
    content,
  );
  pass("memory persists across browser reload");
  const web = await request("/executions", {
    steps: [{ tool: "web.fetch", input: { url: "https://example.com" } }],
  });
  assert.equal(web.response.status(), 201);
  const webRun = await request(`/executions/${web.data.execution.id}/run`, {});
  assert.equal(
    webRun.data.execution.status,
    "COMPLETE",
    JSON.stringify(webRun.data),
  );
  assert.equal(webRun.data.execution.verified, 1);
  assert.ok(
    JSON.parse(webRun.data.execution.output_json)[0].output.text.includes(
      "Example Domain",
    ),
  );
  pass("real external HTTPS fetch with verified evidence");
  const replay = await request(`/executions/${web.data.execution.id}/run`, {});
  assert.equal(replay.response.status(), 409);
  pass("replay refused by real D1 claim");
  await page.locator("[data-tab=conversation]").click();
  await page.locator("#speak-replies").uncheck();
  await page.locator("#chat-input").fill("Hello Jarvish");
  await page.locator("#send").click();
  await page.locator("#status").filter({ hasText: "ERROR" }).waitFor();
  assert.ok(
    (await page.locator("#global-error").textContent()).includes(
      "No LLM provider",
    ),
  );
  assert.equal(await page.locator("#send").isDisabled(), false);
  pass("unconfigured Groq backend fails visibly with no fake reply");
  // These two responses are controlled FRONTEND TEST FIXTURES, not claims about a live LLM.
  let release;
  const gate = new Promise((r) => (release = r));
  await page.route("**/api/chat", async (route) => {
    await gate;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        reply: "Frontend fixture response",
        sessionId: crypto.randomUUID(),
        execution: null,
      }),
    });
  });
  await page.locator("#chat-input").fill("fixture only");
  await page.locator("#send").click();
  await page.locator("#status").filter({ hasText: "THINKING" }).waitFor();
  assert.equal(await page.locator("#send").isDisabled(), true);
  pass("frontend thinking/loading state (controlled fixture)");
  release();
  await page
    .locator("#messages")
    .getByText("Frontend fixture response")
    .waitFor();
  assert.equal(await page.locator("#send").isDisabled(), false);
  pass("frontend successful response rendering (controlled fixture)");
  await page.unroute("**/api/chat");
  await page.evaluate(() => {
    window.SpeechRecognition = class {};
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      value: async () => {
        throw new DOMException(
          "Microphone permission denied",
          "NotAllowedError",
        );
      },
    });
  });
  await page.locator("#talk").click();
  await page.locator("#status").filter({ hasText: "ERROR" }).waitFor();
  assert.match(
    await page.locator("#status-detail").textContent(),
    /permission denied/i,
  );
  pass("microphone denial is caught, no unhandled promise");
  // Cleanup affects only the local test memory, through its real level-3 approval gate.
  const deletion = await request("/executions", {
    steps: [{ tool: "memory.delete", input: { id: stored.id } }],
  });
  await request(`/executions/${deletion.data.execution.id}/approve`, {});
  const deleted = await request(
    `/executions/${deletion.data.execution.id}/run`,
    {},
  );
  assert.equal(deleted.data.execution.verified, 1);
  pass("local test cleanup respects destructive approval and verification");
  await page.locator("[data-tab=conversation]").click();
  mkdirSync("test-results", { recursive: true });
  await page.screenshot({
    path: "test-results/workspace-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/workspace-mobile.png",
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    true,
  );
  pass("responsive mobile without horizontal overflow");
  assert.deepEqual(errors, []);
  pass("no uncaught browser JavaScript errors");
  console.log(
    `${passed} browser/integration checks passed. Live Groq and physical audio not claimed.`,
  );
} finally {
  await browser.close();
}
