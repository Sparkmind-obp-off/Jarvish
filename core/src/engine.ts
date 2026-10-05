import { ProviderRouter } from "./router.js";
import type { JarvishMessage, JarvishTool, LLMProvider } from "./index.js";

export interface EngineContext {
  sessionId: string;
  memories: string[];
}

export class JarvishEngine {
  readonly router: ProviderRouter;
  private readonly tools = new Map<string, JarvishTool>();

  constructor(providers: LLMProvider[]) {
    this.router = new ProviderRouter(providers);
  }

  registerTool(tool: JarvishTool): void {
    this.tools.set(tool.name, tool);
  }

  listTools(): string[] {
    return [...this.tools.keys()];
  }

  async respond(input: string, context: EngineContext): Promise<string> {
    const messages: JarvishMessage[] = [
      {
        role: "system",
        content:
          "You are Jarvish, a concise personal operator. Be truthful, verify work, and never perform risky external actions without confirmation."
      },
      ...context.memories.map((content) => ({ role: "system" as const, content })),
      { role: "user", content: input }
    ];
    const result = await this.router.generate({ messages });
    return result.content;
  }
}