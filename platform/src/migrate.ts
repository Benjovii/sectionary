import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import postgres from "postgres";

try { process.loadEnvFile(resolve(import.meta.dirname, "../.env")); } catch {}
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required (set it in platform/.env)");
const sql = postgres(url, { max: 1 });

try {
  // Create migrations table
  await sql`CREATE TABLE IF NOT EXISTS sectionary_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;

  // Find all migration files
  const drizzleDir = resolve(import.meta.dirname, "../drizzle");
  const files = await readdir(drizzleDir);
  const migrations = files
    .filter((f) => f.endsWith(".sql"))
    .sort();

  // Apply each migration in order
  for (const migrationFile of migrations) {
    const [done] = await sql`SELECT name FROM sectionary_migrations WHERE name=${migrationFile}`;
    if (done) {
      console.log(`✓ ${migrationFile} already applied`);
    } else {
      const migration = await readFile(resolve(drizzleDir, migrationFile), "utf8");
      await sql.begin(async (tx) => {
        await tx.unsafe(migration);
        await tx`INSERT INTO sectionary_migrations (name) VALUES (${migrationFile})`;
      });
      console.log(`✓ Applied ${migrationFile}`);
    }
  }

  console.log("Migrations complete");
} finally { await sql.end(); }
