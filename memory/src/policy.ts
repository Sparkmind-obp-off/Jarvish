import { z } from "zod";
export const memorySchema = z
  .object({
    kind: z.enum([
      "user",
      "preference",
      "project",
      "task",
      "experience",
      "session",
    ]),
    content: z
      .string()
      .trim()
      .min(1)
      .max(2000)
      .refine(
        (v) =>
          !/(gsk_[A-Za-z0-9]{10,}|gh[pousr]_[A-Za-z0-9]{10,}|github_pat_|sk-[A-Za-z0-9]{10,}|-----BEGIN .*PRIVATE KEY|api[_ -]?key\s*[:=]|password\s*[:=]|bearer\s+[A-Za-z0-9._-]{20,})/i.test(
            v,
          ),
        "Do not store credentials in memory",
      ),
    importance: z.number().int().min(1).max(5).default(1),
  })
  .strict();
export type MemoryKind = z.infer<typeof memorySchema>["kind"];
export type MemoryItem = z.infer<typeof memorySchema> & { id: string };
export function shouldPersistMemory(item: MemoryItem) {
  return memorySchema.safeParse({
    kind: item.kind,
    content: item.content,
    importance: item.importance,
  }).success;
}
