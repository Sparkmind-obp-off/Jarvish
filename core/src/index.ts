export type JarvishPermissionLevel = 0 | 1 | 2 | 3;
export interface JarvishMessage {
  role: "system" | "user" | "assistant";
  content: string;
}
export interface LLMRequest {
  messages: JarvishMessage[];
  model?: string;
  temperature?: number;
  json?: boolean;
}
export interface LLMResponse {
  content: string;
  provider: string;
  model: string;
}
export interface ProviderHealth {
  available: boolean;
  reason?: string;
}
export interface LLMProvider {
  readonly id: string;
  readonly name: string;
  readonly capabilities: readonly string[];
  health(): Promise<ProviderHealth>;
  generate(request: LLMRequest): Promise<LLMResponse>;
}
export class RuntimeError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "RuntimeError";
  }
}
export interface ToolResult {
  output: unknown;
  evidence: unknown;
}
export interface JarvishTool {
  readonly name: string;
  readonly description: string;
  readonly permission: JarvishPermissionLevel;
  readonly inputSchema: Record<string, unknown>;
  readonly timeout: number;
  validate(input: unknown): unknown;
  execute(input: unknown, signal: AbortSignal): Promise<ToolResult>;
  verify(
    input: unknown,
    result: ToolResult,
    signal: AbortSignal,
  ): Promise<boolean>;
}
export type ExecutionStatus =
  | "AWAITING_APPROVAL"
  | "READY"
  | "RUNNING"
  | "VERIFYING"
  | "COMPLETE"
  | "FAILED";
export interface PlanStep {
  tool: string;
  input: unknown;
}
export interface OperatorReply {
  reply: string;
  steps: PlanStep[];
  provider: string;
  model: string;
}
export const JARVISH_VERSION = "0.2.0";
