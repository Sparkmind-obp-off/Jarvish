import {
  RuntimeError,
  type LLMProvider,
  type LLMRequest,
  type LLMResponse,
} from "../../core/src/index.js";
export class GroqProvider implements LLMProvider {
  readonly id = "groq";
  readonly name = "groq";
  readonly capabilities = ["chat", "json"];
  constructor(
    private readonly key?: string,
    private readonly model = "llama-3.3-70b-versatile",
    private readonly fetcher: typeof fetch = fetch.bind(globalThis),
  ) {}
  async health() {
    return {
      available: Boolean(this.key),
      reason: this.key ? undefined : "GROQ_API_KEY is not configured",
    };
  }
  async generate(request: LLMRequest): Promise<LLMResponse> {
    if (!this.key)
      throw new RuntimeError("NOT_CONFIGURED", "Groq is not configured");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    try {
      const response = await this.fetcher(
        "https://api.groq.com/openai/v1/chat/completions",
        {
          method: "POST",
          signal: controller.signal,
          redirect: "manual",
          headers: {
            Authorization: `Bearer ${this.key}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: request.model ?? this.model,
            messages: request.messages,
            temperature: request.temperature ?? 0.2,
            max_completion_tokens: 2048,
            ...(request.json
              ? { response_format: { type: "json_object" } }
              : {}),
          }),
        },
      );
      if (!response.ok)
        throw new RuntimeError(
          response.status === 429
            ? "RATE_LIMIT"
            : response.status === 401
              ? "PROVIDER_AUTH"
              : "PROVIDER_HTTP",
          `Groq returned HTTP ${response.status}`,
          response.status >= 500 || response.status === 429,
        );
      const body = (await response.json()) as {
        model?: string;
        choices?: { message?: { content?: string } }[];
      };
      const content = body?.choices?.[0]?.message?.content;
      if (
        typeof content !== "string" ||
        !content.trim() ||
        typeof body.model !== "string"
      )
        throw new RuntimeError("MALFORMED_RESPONSE", "Invalid Groq response");
      return { content, model: body.model, provider: this.id };
    } catch (error) {
      if (error instanceof RuntimeError) throw error;
      throw new RuntimeError(
        controller.signal.aborted ? "PROVIDER_TIMEOUT" : "PROVIDER_NETWORK",
        "Groq connection failed",
        true,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
