// A throwaway Postgres 17 for tests and acceptance checks: PGlite (WASM, in
// process) behind a socket, so postgres.js, the migrations, the importer and
// the web app's search connect to it exactly as they do to Supabase.
//
// The migrations assume Supabase, so the few Supabase objects they reference
// (the auth schema, auth.uid(), the anon and authenticated roles) are stubbed
// first. Nothing else differs; every file in drizzle/ runs unchanged, in order.

import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { vector } from "@electric-sql/pglite-pgvector";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

const SUPABASE_STUBS = `
  CREATE SCHEMA auth;
  CREATE TABLE auth.users (id uuid PRIMARY KEY);
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS 'SELECT NULL::uuid';
  CREATE ROLE anon;
  CREATE ROLE authenticated;`;

export interface LocalDb { url: string; db: PGlite; migrations: string[]; stop(): Promise<void> }

export async function startLocalDb(opts: { migrate?: boolean } = {}): Promise<LocalDb> {
  const db = await PGlite.create({ extensions: { pg_trgm, pgcrypto, vector } });
  await db.exec(SUPABASE_STUBS);
  const migrations: string[] = [];
  if (opts.migrate !== false) {
    // Same order and bookkeeping as src/migrate.ts.
    await db.exec("CREATE TABLE sectionary_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
    const dir = resolve(import.meta.dirname, "../drizzle");
    for (const name of (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort()) {
      await db.exec(await readFile(resolve(dir, name), "utf8"));
      await db.query("INSERT INTO sectionary_migrations (name) VALUES ($1)", [name]);
      migrations.push(name);
    }
  }
  const server = new PGLiteSocketServer({ db, port: 0, maxConnections: 8 });
  await server.start();
  return {
    url: `postgres://postgres@${server.getServerConn()}/postgres?sslmode=disable`, // PGlite takes any password; none in the URL keeps secret scanners quiet
    db,
    migrations,
    async stop() { await server.stop(); await db.close(); },
  };
}
