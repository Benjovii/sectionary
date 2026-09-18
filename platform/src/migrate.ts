import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import postgres from "postgres";

try { process.loadEnvFile(resolve(import.meta.dirname, "../.env")); } catch {}
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required (set it in platform/.env)");
const sql = postgres(url, { max: 1 });
try {
  const migration = await readFile(resolve(import.meta.dirname, "../drizzle/0001_schema_v1.sql"), "utf8");
  await sql`CREATE TABLE IF NOT EXISTS sectionary_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
  const [done] = await sql`SELECT name FROM sectionary_migrations WHERE name='0001_schema_v1.sql'`;
  if (done) console.log("Schema v1 is already applied");
  else {
    await sql.begin(async (tx) => {
      await tx.unsafe(migration);
      await tx`INSERT INTO sectionary_migrations (name) VALUES ('0001_schema_v1.sql')`;
    });
    console.log("Applied schema v1");
  }
} finally { await sql.end(); }
