import { BrowserVoice, type VoiceState } from "../../../voice/src/browser.js";
interface Execution {
  id: string;
  status: string;
  permission: number;
  plan_json: string;
  output_json: string | null;
  verified: number;
  error_code?: string;
  checkpoint: number;
  created_at: string;
  attempts: number;
}
interface Status {
  providers: { id: string; available: boolean; reason?: string }[];
  voice: Record<string, string>;
  tools: { name: string; permission: number; description: string }[];
  version: string;
  environment: string;
}
const element = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
let sessionId =
  localStorage.getItem("jarvish-session-id") ?? crypto.randomUUID();
let busy = false;
const language = () => element<HTMLSelectElement>("voice-language").value;
function setState(state: VoiceState, detail?: string) {
  element("status").textContent = state;
  element("status-detail").textContent =
    detail ??
    {
      IDLE: "Ready for your next thought.",
      LISTENING: "Listening. Tap the microphone to stop.",
      PROCESSING: "Understanding your words…",
      THINKING: "Retrieving context and asking the provider…",
      SPEAKING: "Speaking. You can stop voice at any time.",
      ERROR: "Something needs your attention.",
    }[state];
  element("talk").classList.toggle("listening", state === "LISTENING");
}
const voice = new BrowserVoice(setState);
async function api<T = any>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    credentials: "same-origin",
    signal: AbortSignal.timeout(90000),
  });
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401) {
      element("runtime").hidden = true;
      element("login-panel").hidden = false;
    }
    throw new Error(
      data.error?.message ?? `Backend returned HTTP ${response.status}`,
    );
  }
  return data as T;
}
function error(message: string) {
  element("global-error").textContent = message;
  element("global-error").hidden = false;
  setState("ERROR", message);
}
function clearError() {
  element("global-error").hidden = true;
}
async function guard(work: () => Promise<void>) {
  clearError();
  try {
    await work();
  } catch (e) {
    error(e instanceof Error ? e.message : "Request failed");
  }
}
function switchTab(tab: string) {
  document
    .querySelectorAll<HTMLElement>(".tab-panel")
    .forEach((p) => (p.hidden = p.id !== `${tab}-panel`));
  document
    .querySelectorAll<HTMLElement>(".nav-item")
    .forEach((p) => p.classList.toggle("active", p.dataset.tab === tab));
  element("page-title").textContent =
    tab.charAt(0).toUpperCase() + tab.slice(1);
}
function message(role: string, text: string) {
  element("messages").querySelector(".welcome")?.remove();
  const card = document.createElement("article");
  card.className = `message ${role}`;
  const label = document.createElement("span");
  label.className = "eyebrow";
  label.textContent = role === "user" ? "YOU" : "JARVISH";
  card.append(label, document.createTextNode(text));
  element("messages").append(card);
  card.scrollIntoView({ block: "nearest" });
}
async function send(input: string) {
  if (busy || !input.trim()) return;
  busy = true;
  voice.stop();
  clearError();
  element<HTMLButtonElement>("send").disabled = true;
  element<HTMLButtonElement>("talk").disabled = true;
  message("user", input);
  element<HTMLTextAreaElement>("chat-input").value = "";
  setState("THINKING");
  try {
    const data = await api<{
      reply: string;
      sessionId: string;
      execution: Execution | null;
    }>("/chat", { input, sessionId });
    sessionId = data.sessionId;
    localStorage.setItem("jarvish-session-id", sessionId);
    message("assistant", data.reply);
    if (data.execution)
      element("messages").append(executionCard(data.execution));
    setState("IDLE");
    if (element<HTMLInputElement>("speak-replies").checked)
      voice.speak(data.reply, language());
  } catch (e) {
    const text = e instanceof Error ? e.message : "Backend request failed";
    error(text);
    message("assistant", `No successful response: ${text}`);
  } finally {
    busy = false;
    element<HTMLButtonElement>("send").disabled = false;
    element<HTMLButtonElement>("talk").disabled = false;
  }
}
function executionCard(execution: Execution) {
  const card = document.createElement("article");
  card.className = "data-card";
  card.dataset.executionId = execution.id;
  const heading = document.createElement("h3");
  heading.textContent = `${execution.status} · LEVEL ${execution.permission}`;
  const meta = document.createElement("small");
  meta.textContent = `${execution.id} · checkpoint ${execution.checkpoint} · verified: ${Boolean(execution.verified)}`;
  const plan = document.createElement("pre");
  plan.textContent = JSON.stringify(JSON.parse(execution.plan_json), null, 2);
  card.append(heading, meta, plan);
  if (execution.output_json) {
    const result = document.createElement("pre");
    result.textContent = JSON.stringify(
      JSON.parse(execution.output_json),
      null,
      2,
    );
    card.append(result);
  }
  if (execution.error_code) {
    const p = document.createElement("p");
    p.textContent = `Failure: ${execution.error_code}. No verified success is claimed.`;
    card.append(p);
  }
  const actions = document.createElement("section");
  actions.className = "execution-actions";
  function button(text: string, action: () => Promise<void>) {
    const b = document.createElement("button");
    b.className = "secondary";
    b.textContent = text;
    b.onclick = () => {
      b.disabled = true;
      void guard(action).finally(() => (b.disabled = false));
    };
    actions.append(b);
  }
  const update = async (action: string) => {
    setState("PROCESSING", `${action}: execution ${execution.id}`);
    const data = await api<{ execution: Execution; evidence: unknown }>(
      `/executions/${execution.id}/${action}`,
      {},
    );
    card.replaceWith(executionCard(data.execution));
    setState(
      data.execution.status === "FAILED" ? "ERROR" : "IDLE",
      `Execution ${data.execution.status}`,
    );
    if (action !== "approve") {
      await loadMemory();
      await loadExecutions();
      if (element<HTMLInputElement>("speak-replies").checked)
        voice.speak(
          data.execution.verified
            ? "Execution complete. Results verified."
            : `Execution ${data.execution.status}. No verified success.`,
          language(),
        );
    }
  };
  if (execution.status === "AWAITING_APPROVAL")
    button("Approve this exact plan", async () => {
      if (
        window.confirm(
          `Approve level ${execution.permission} action?\n\n${plan.textContent}`,
        )
      )
        await update("approve");
    });
  if (execution.status === "READY")
    button("Execute & verify", () => update("run"));
  if (
    execution.status === "FAILED" &&
    execution.permission === 0 &&
    execution.attempts < 2
  )
    button("Retry read-only from checkpoint", () => update("retry"));
  button("Inspect evidence", async () => {
    const data = await api(`/executions/${execution.id}`);
    const evidence = document.createElement("pre");
    evidence.textContent = JSON.stringify(data.evidence, null, 2);
    card.append(evidence);
  });
  card.append(actions);
  return card;
}
async function loadMemory() {
  const { memories } = await api("/memories");
  element("memory-list").replaceChildren();
  if (!memories.length)
    element("memory-list").textContent =
      "No persistent memories yet. Save an explicit fact above.";
  for (const m of memories) {
    const card = document.createElement("article");
    card.className = "data-card";
    const h = document.createElement("h3");
    h.textContent = m.kind.toUpperCase();
    const p = document.createElement("p");
    p.textContent = m.content;
    const s = document.createElement("small");
    s.textContent = `${m.id} · importance ${m.importance}`;
    card.append(h, p, s);
    element("memory-list").append(card);
  }
}
async function loadExecutions() {
  const { executions } = await api("/executions");
  element("execution-list").replaceChildren(...executions.map(executionCard));
  if (!executions.length)
    element("execution-list").textContent =
      "No executions yet. Nothing has been silently performed.";
}
function template(name: string) {
  return name === "memory.save"
    ? {
        kind: "preference",
        content: "I prefer concise responses",
        importance: 3,
      }
    : name === "memory.search"
      ? { query: "" }
      : name === "memory.delete"
        ? { id: "REPLACE_WITH_MEMORY_UUID" }
        : name === "github.inspect"
          ? { repo: "Sparkmind-obp-off/Jarvish" }
          : name === "github.branch.create"
            ? {
                repo: "Sparkmind-obp-off/Jarvish",
                branch: "jarvish-task",
                from: "main",
              }
            : { url: "https://example.com" };
}
async function connect() {
  const data = await api<Status>("/status");
  element("login-panel").hidden = true;
  element("runtime").hidden = false;
  element("logout").hidden = false;
  const available = data.providers.some((p) => p.available);
  element("connection").textContent = available
    ? "CONNECTED"
    : "PROVIDER NOT CONFIGURED";
  element("connection").classList.toggle("warning", !available);
  element("system-info").replaceChildren();
  for (const provider of data.providers) {
    const card = document.createElement("article");
    card.className = "data-card";
    const h = document.createElement("h3");
    h.textContent = `${provider.id.toUpperCase()} · ${provider.available ? "CONFIGURED (not a live health probe)" : "UNAVAILABLE"}`;
    const p = document.createElement("p");
    p.textContent =
      provider.reason ??
      "Configured on the server. A successful response is required to confirm live functionality.";
    card.append(h, p);
    element("system-info").append(card);
  }
  const voiceCard = document.createElement("article");
  voiceCard.className = "data-card";
  const pre = document.createElement("pre");
  pre.textContent = JSON.stringify(
    { voice: data.voice, environment: data.environment, version: data.version },
    null,
    2,
  );
  voiceCard.append(pre);
  element("system-info").append(voiceCard);
  const select = element<HTMLSelectElement>("tool-select");
  select.replaceChildren(
    ...data.tools.map((t) => {
      const option = document.createElement("option");
      option.value = t.name;
      option.textContent = `${t.name} · LEVEL ${t.permission}`;
      return option;
    }),
  );
  element<HTMLTextAreaElement>("tool-input").value = JSON.stringify(
    template(select.value),
    null,
    2,
  );
  await Promise.all([loadMemory(), loadExecutions()]);
  setState(
    "IDLE",
    available
      ? "Connected. Ready for your next thought."
      : "Tools and memory are connected. Configure GROQ_API_KEY to enable AI conversation.",
  );
}
document
  .querySelectorAll<HTMLElement>("[data-tab]")
  .forEach((b) => (b.onclick = () => switchTab(b.dataset.tab!)));
element("login-form").onsubmit = (event) => {
  event.preventDefault();
  element("login-error").textContent = "";
  void (async () => {
    try {
      await api("/auth/login", {
        key: element<HTMLInputElement>("owner-key").value,
      });
      element<HTMLInputElement>("owner-key").value = "";
      await connect();
    } catch (e) {
      element("login-error").textContent =
        e instanceof Error ? e.message : "Login failed";
    }
  })();
};
element("logout").onclick = () =>
  void guard(async () => {
    await api("/auth/logout", {});
    voice.stop();
    element("runtime").hidden = true;
    element("login-panel").hidden = false;
    element("logout").hidden = true;
    element("messages").replaceChildren();
    element("memory-list").replaceChildren();
    element("execution-list").replaceChildren();
  });
element("chat-form").onsubmit = (e) => {
  e.preventDefault();
  void send(element<HTMLTextAreaElement>("chat-input").value);
};
element("chat-input").onkeydown = (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    void send(element<HTMLTextAreaElement>("chat-input").value);
  }
};
element("talk").onclick = () =>
  void voice.listen(language(), (text) => void send(text));
element("stop-voice").onclick = () => voice.stop();
element("open-memory").onclick = () => switchTab("memory");
element("new-session").onclick = () => {
  voice.stop();
  sessionId = crypto.randomUUID();
  localStorage.setItem("jarvish-session-id", sessionId);
  element("messages").replaceChildren();
  setState("IDLE", "New session. Persistent memory is preserved.");
};
element("refresh-memory").onclick = () => void guard(loadMemory);
element("refresh-executions").onclick = () => void guard(loadExecutions);
element("tool-select").onchange = () =>
  (element<HTMLTextAreaElement>("tool-input").value = JSON.stringify(
    template(element<HTMLSelectElement>("tool-select").value),
    null,
    2,
  ));
element("memory-form").onsubmit = (e) => {
  e.preventDefault();
  void guard(async () => {
    const data = await api("/memories", {
      kind: element<HTMLSelectElement>("memory-kind").value,
      content: element<HTMLTextAreaElement>("memory-content").value,
      importance: 3,
    });
    element("memory-list").prepend(executionCard(data.execution));
    element<HTMLTextAreaElement>("memory-content").value = "";
  });
};
element("tool-form").onsubmit = (e) => {
  e.preventDefault();
  void guard(async () => {
    const data = await api("/executions", {
      steps: [
        {
          tool: element<HTMLSelectElement>("tool-select").value,
          input: JSON.parse(element<HTMLTextAreaElement>("tool-input").value),
        },
      ],
    });
    element("execution-list").prepend(executionCard(data.execution));
  });
};
element("inspect-repo").onclick = () =>
  void guard(async () => {
    const data = await api("/executions", {
      steps: [
        {
          tool: "github.inspect",
          input: { repo: "Sparkmind-obp-off/Jarvish" },
        },
      ],
    });
    switchTab("executions");
    element("execution-list").prepend(executionCard(data.execution));
  });
void connect().catch(() => {
  element("runtime").hidden = true;
  element("login-panel").hidden = false;
});
void fetch("/health")
  .then(async (response) => {
    if (!response.ok) {
      element("login-error").textContent =
        "Production storage is unavailable. This deployment requires a dedicated Jarvish D1 binding and migrations. No operational runtime is claimed until storage is activated.";
    }
  })
  .catch(() => {
    element("login-error").textContent =
      "Backend is unreachable. Check your connection.";
  });
