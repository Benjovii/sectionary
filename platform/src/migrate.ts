import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import postgres from "postgres";

try { process.loadEnvFile(resolve(import.meta.dirname, "../.env")); } catch {}
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required (set it in platform/.env)");
const sql = postgres(url, { max: 1 });
try {
  await sql`CREATE TABLE IF NOT EXISTS sectionary_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
  // Every .sql file in drizzle/, in name order, each once.
  const dir = resolve(import.meta.dirname, "../drizzle");
  for (const name of (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort()) {
    const [done] = await sql`SELECT name FROM sectionary_migrations WHERE name=${name}`;
    if (done) { console.log(`${name} is already applied`); continue; }
    const migration = await readFile(resolve(dir, name), "utf8");
    await sql.begin(async (tx) => {
      await tx.unsafe(migration);
      await tx`INSERT INTO sectionary_migrations (name) VALUES (${name})`;
    });
    console.log(`Applied ${name}`);
  }
} finally { await sql.end(); }
