import postgres from "postgres";

declare global { var sectionarySql: ReturnType<typeof postgres> | undefined; }

export function database() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not configured");
  return globalThis.sectionarySql ??= postgres(url, { max: 5, prepare: false, idle_timeout: 20 });
}

/**
 * An array parameter as a Postgres array literal; cast it in SQL (`${pgArray(xs)}::text[]`).
 *
 * Not sql.array(): with prepare: false (the Supabase pooler) postgres.js picks
 * an array's type from a map it fills only once a connection has fetched the
 * server's array types, so the first queries on a fresh pool send ["a","b"] as
 * "a,b" and fail with "malformed array literal". Every multi-word search on a
 * cold server did. A literal does not depend on that.
 */
export function pgArray(values: readonly string[]): string {
  return `{${values.map((v) => `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",")}}`;
}

export function apiError(error: unknown) {
  console.error(error);
  const message = error instanceof Error && error.message.includes("DATABASE_URL") ? error.message : "Database request failed";
  return Response.json({ error: message, code: "DATABASE_ERROR" }, { status: 503 });
}
