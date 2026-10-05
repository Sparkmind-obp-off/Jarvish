import { memorySchema, type MemoryItem } from "./policy.js";
import type { JarvishMessage } from "../../core/src/index.js";
export class MemoryStore {
  constructor(readonly db: D1Database) {}
  async list(query = "") {
    const safe = query.replace(/[\\%_]/g, "\\$&").slice(0, 200);
    return (
      await this.db
        .prepare(
          "SELECT id,kind,content,importance FROM memories WHERE content LIKE ? ESCAPE '\\' ORDER BY importance DESC,updated_at DESC LIMIT 30",
        )
        .bind(`%${safe}%`)
        .all<MemoryItem>()
    ).results;
  }
  async retrieve(input: string) {
    const words = input.match(/[\p{L}\p{N}]{3,}/gu)?.slice(0, 6) ?? [];
    const clauses = words.map(() => "content LIKE ? ESCAPE '\\'");
    const sql = `SELECT kind,content,importance FROM memories WHERE kind IN ('user','preference')${clauses.length ? " OR " + clauses.join(" OR ") : ""} ORDER BY importance DESC,updated_at DESC LIMIT 10`;
    return (
      await this.db
        .prepare(sql)
        .bind(...words.map((w) => `%${w.replace(/[\\%_]/g, "\\$&")}%`))
        .all<{ kind: string; content: string; importance: number }>()
    ).results;
  }
  async save(input: unknown) {
    const item = memorySchema.parse(input);
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await this.db
      .prepare(
        "INSERT INTO memories(id,kind,content,importance,created_at,updated_at) VALUES(?,?,?,?,?,?)",
      )
      .bind(id, item.kind, item.content, item.importance, now, now)
      .run();
    return { id, ...item };
  }
  async get(id: string) {
    return this.db
      .prepare("SELECT id,kind,content,importance FROM memories WHERE id=?")
      .bind(id)
      .first<MemoryItem>();
  }
  async history(sessionId: string): Promise<JarvishMessage[]> {
    return (
      await this.db
        .prepare(
          "SELECT role,content FROM (SELECT rowid,role,content FROM messages WHERE session_id=? ORDER BY rowid DESC LIMIT 10) ORDER BY rowid ASC",
        )
        .bind(sessionId)
        .all<JarvishMessage>()
    ).results;
  }
  async record(sessionId: string, input: string, reply: string) {
    const now = new Date().toISOString();
    await this.db.batch([
      this.db
        .prepare("INSERT OR IGNORE INTO sessions(id,created_at) VALUES(?,?)")
        .bind(sessionId, now),
      ...(["user", "assistant"] as const).map((role, i) =>
        this.db
          .prepare(
            "INSERT INTO messages(id,session_id,role,content,created_at) VALUES(?,?,?,?,?)",
          )
          .bind(crypto.randomUUID(), sessionId, role, i ? reply : input, now),
      ),
    ]);
  }
}
