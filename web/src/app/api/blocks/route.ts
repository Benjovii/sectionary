import { apiError, database } from "@/server/db";
import { blockColumns, blockJoins, blockWhere, readFilters, toBlock, type TechFacet } from "@/server/blocks";
import { searchBlocks } from "@/server/search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/blocks · BlocksQuery in, BlocksResponse out.
 * Without `q`, newest captures first. With `q`, ranked by relevance: full text,
 * typo tolerance and semantic search fused (see server/search.ts).
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const f = readFilters(url);
    const q = url.searchParams.get("q")?.trim() || null;
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit")) || 60));
    const offset = Math.max(0, Number(url.searchParams.get("cursor")) || 0);

    if (q) {
      const { items, total, nextCursor, facets, search } = await searchBlocks(q, f, limit, offset);
      // How the query was read goes in headers, so the body stays exactly BlocksResponse.
      const headers = {
        "x-search-terms": search.terms.join(" "),
        "x-search-corrected": Object.entries(search.corrected).map(([from, to]) => `${from}>${to}`).join(" "),
        "x-search-semantic": String(search.semantic),
      };
      return Response.json({ items, blocks: items, generatedAt: new Date().toISOString(), nextCursor, total, facets }, { headers });
    }

    const sql = database();
    // Latest capture of each page only. A facet skips its own filter, so picking
    // one app still shows how many blocks every other app would give.
    const where = (skip?: TechFacet) => blockWhere(sql, f, skip ? [skip] : []);
    const [rows, [{ count }], platforms, themes, apps] = await Promise.all([
      sql`SELECT ${blockColumns(sql)} FROM ${blockJoins(sql)} WHERE ${where()} ORDER BY c.captured_at DESC, b.id LIMIT ${limit} OFFSET ${offset}`,
      sql`SELECT count(*)::int AS count FROM ${blockJoins(sql)} WHERE ${where()}`,
      sql`SELECT s.platform AS value, count(*)::int AS count FROM ${blockJoins(sql)} WHERE ${where("platform")} AND s.platform IS NOT NULL GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 50`,
      sql`SELECT s.theme_name AS value, count(*)::int AS count FROM ${blockJoins(sql)} WHERE ${where("theme")} AND s.theme_name IS NOT NULL GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 100`,
      sql`SELECT a AS value, count(*)::int AS count FROM ${blockJoins(sql)} CROSS JOIN unnest(s.apps) a WHERE ${where("app")} GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 100`,
    ]);
    const facet = (list: readonly Record<string, unknown>[]) => list.map((r) => ({ value: r.value as string, count: r.count as number }));
    const items = rows.map(toBlock);
    return Response.json({
      items, blocks: items, generatedAt: new Date().toISOString(),
      nextCursor: offset + items.length < count ? String(offset + items.length) : null, total: count,
      facets: { platform: facet(platforms), theme: facet(themes), app: facet(apps) },
    });
  } catch (error) { return apiError(error); }
}
