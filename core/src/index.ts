export type JarvishPermissionLevel = 0 | 1 | 2 | 3;

export interface JarvishMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
}

export interface LLMRequest {
  messages: JarvishMessage[];
  model?: string;
  temperature?: number;
}

export interface LLMResponse {
  content: string;
  provider: string;
  model: string;
}

export interface LLMProvider {
  readonly name: string;
  generate(request: LLMRequest): Promise<LLMResponse>;
}

export interface JarvishTool<I = unknown, O = unknown> {
  readonly name: string;
  readonly description: string;
  readonly permission: JarvishPermissionLevel;
  execute(input: I): Promise<O>;
}

export interface ExecutionRecord {
  id: string;
  tool: string;
  permission: JarvishPermissionLevel;
  input: unknown;
  output?: unknown;
  verified: boolean;
  createdAt: string;
}

export const JARVISH_VERSION = "0.1.0";
