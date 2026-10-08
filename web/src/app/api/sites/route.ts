import { apiError, database } from "@/server/db";
import { latestPages, toStore } from "@/server/sites";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/sites · every store with its pages at their latest capture, for
 * the Sites grid and the Flows index (SEC-47). A SiteProfile per store without
 * the capture history, paged like every list: `cursor`, `limit` up to 200.
 * Stores never captured come back with no pages. Ranked order, as /api/stores.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url), sql = database();
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit")) || 60));
    const offset = Math.max(0, Number(url.searchParams.get("cursor")) || 0);
    const rows = await sql`SELECT *, count(*) OVER()::int AS total FROM sites ORDER BY rank ASC NULLS LAST, host LIMIT ${limit} OFFSET ${offset}`;
    const pages = await latestPages(sql, rows.map((r) => r.id as string));
    const items = rows.map((r, i) => ({ store: toStore(r, offset + i + 1), pages: pages.get(r.id) ?? [] }));
    const total = rows[0]?.total ?? 0;
    return Response.json({ items, generatedAt: new Date().toISOString(), nextCursor: offset + items.length < total ? String(offset + items.length) : null, total });
  } catch (error) { return apiError(error); }
}
