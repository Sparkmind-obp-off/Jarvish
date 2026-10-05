export type MemoryKind =
  | "user"
  | "preference"
  | "project"
  | "task"
  | "experience"
  | "session";

export interface MemoryItem {
  id: string;
  kind: MemoryKind;
  content: string;
  importance: number;
}

export function shouldPersistMemory(item: MemoryItem): boolean {
  return item.content.trim().length > 0 && item.importance >= 1;
}