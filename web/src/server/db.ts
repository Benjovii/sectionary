import postgres from "postgres";

declare global { var sectionarySql: ReturnType<typeof postgres> | undefined; }

export function database() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not configured");
  // DATABASE_POOL_MAX=1 for a local PGlite (platform/src/local-db.ts), which mixes up statements from parallel connections.
  const max = Number(process.env.DATABASE_POOL_MAX) || 5;
  return globalThis.sectionarySql ??= postgres(url, { max, prepare: false, idle_timeout: 20, ...(needsTls(url) && { ssl: "require" as const }) });
}

/**
 * Encrypted unless the URL says otherwise (sslmode=...) or the database is on
 * this machine. Hosted on AWS, the app reaches Supabase across the internet.
 */
export function needsTls(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.searchParams.has("sslmode")) return false;
    return !["localhost", "127.0.0.1", "[::1]", "::1"].includes(u.hostname);
  } catch {
    return false;
  }
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

/**
 * Headers for a public read that every visitor gets alike, like the wall's
 * first page. A CDN (Vercel's, or one put in front of AWS) keeps it for ten
 * minutes and then serves the old copy while it fetches a fresh one; on AWS
 * the server keeps it in memory by the same rule (server/response-cache.ts),
 * since /api/blocks takes the database two seconds or more to build. The
 * browser keeps it for two minutes, so a reload, Back, or switching Web /
 * Mobile and back does not ask again. Blocks only change when a capture is
 * imported, so ten minutes stale is fine.
 */
export const PUBLIC_CACHE = { "Cache-Control": "public, max-age=120, s-maxage=600, stale-while-revalidate=86400" };

export function apiError(error: unknown) {
  console.error(error);
  const message = error instanceof Error && error.message.includes("DATABASE_URL") ? error.message : "Database request failed";
  return Response.json({ error: message, code: "DATABASE_ERROR" }, { status: 503 });
}
