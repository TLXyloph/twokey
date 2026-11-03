/**
 * A D1-shaped database over real SQLite (node:sqlite) with every migration in
 * config/d1/migrations applied, for tests of the D1 stores and the routes. No network.
 */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { D1DatabaseLike, D1Value } from "@/platform/cloudflare-env";

const migrationsDir = fileURLToPath(new URL("../../../config/d1/migrations/", import.meta.url));
export const sqlite = await import("node:sqlite").catch(() => undefined);

export interface SqliteD1 {
  db: D1DatabaseLike;
  exec(sql: string): void;
  all(sql: string): unknown[];
}

export function sqliteD1(): SqliteD1 {
  if (!sqlite) throw new Error("node:sqlite unavailable");
  const database = new sqlite.DatabaseSync(":memory:");
  for (const file of readdirSync(migrationsDir).filter((name) => name.endsWith(".sql")).sort()) {
    database.exec(readFileSync(`${migrationsDir}${file}`, "utf8"));
  }
  const db: D1DatabaseLike = {
    prepare: (sql) => {
      const statement = (values: D1Value[]) => ({
        bind: (...more: D1Value[]) => statement([...values, ...more]),
        run: async () => ({ meta: { changes: Number(database.prepare(sql).run(...values).changes) } }),
        all: async <Row,>() => ({ results: database.prepare(sql).all(...values) as Row[] }),
      });
      return statement([]);
    },
  };
  return { db, exec: (sql) => database.exec(sql), all: (sql) => database.prepare(sql).all() };
}
