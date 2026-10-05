import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
// Test-only adapter: executes real SQLite statements, including atomic batches.
export function testDB(): D1Database {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(
    readFileSync(new URL("../memory/schema.sql", import.meta.url), "utf8"),
  );
  class Statement {
    constructor(
      readonly sql: string,
      readonly args: any[] = [],
    ) {}
    bind(...args: any[]) {
      return new Statement(this.sql, args);
    }
    async first(column?: string) {
      const row = sqlite.prepare(this.sql).get(...this.args);
      return column ? (row?.[column] ?? null) : (row ?? null);
    }
    async all() {
      return {
        results: sqlite.prepare(this.sql).all(...this.args),
        success: true,
        meta: {},
      };
    }
    async run() {
      const result = sqlite.prepare(this.sql).run(...this.args);
      return {
        success: true,
        meta: { changes: Number(result.changes) },
        results: [],
      };
    }
  }
  return {
    prepare: (sql: string) => new Statement(sql),
    batch: async (statements: Statement[]) => {
      sqlite.exec("BEGIN");
      try {
        const results = [];
        for (const s of statements) results.push(await s.run());
        sqlite.exec("COMMIT");
        return results;
      } catch (e) {
        sqlite.exec("ROLLBACK");
        throw e;
      }
    },
  } as unknown as D1Database;
}
