import { apiError, database } from "@/server/db";
import { blockColumns, blockJoins, blockWhere, facetCounts, readFilters, toBlock, withColours } from "@/server/blocks";
import { searchBlocks } from "@/server/search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/blocks · BlocksQuery in, BlocksResponse out, plus the wall's
 * additions (WallQuery and WallResponse in lib/block-source.ts): the `video`
 * and `color` filters, facets for every filter and `nearMiss`.
 * Without `q`, newest captures first. With `q`, ranked by relevance: full text,
 * typo tolerance and semantic search fused (see server/search.ts).
 * Facets and near misses come with the first page only: they describe the
 * whole result set, so later pages would repeat them.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const sql = database();
    const f = await withColours(sql, readFilters(url));
    const q = url.searchParams.get("q")?.trim() || null;
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit")) || 60));
    const offset = Math.max(0, Number(url.searchParams.get("cursor")) || 0);
    const first = offset === 0;

    if (q) {
      const { items, total, nextCursor, facets, nearMiss, search } = await searchBlocks(q, f, limit, offset, first);
      // How the query was read goes in headers, so the body stays exactly BlocksResponse.
      const headers = {
        "x-search-terms": search.terms.join(" "),
        "x-search-corrected": Object.entries(search.corrected).map(([from, to]) => `${from}>${to}`).join(" "),
        "x-search-semantic": String(search.semantic),
        "x-search-intent": search.intents.join(" "),
      };
      return Response.json({ items, blocks: items, generatedAt: new Date().toISOString(), nextCursor, total, ...(first && { facets, nearMiss }) }, { headers });
    }

    // Latest capture of each page only. Within a capture, page order, so one
    // store's blocks arrive ready for its page viewer and flow view.
    const [rows, counts] = await Promise.all([
      sql`SELECT ${blockColumns(sql)} FROM ${blockJoins(sql)} WHERE ${blockWhere(sql, f)}
        ORDER BY c.captured_at DESC, c.id, b.viewport, b.block_index, b.id LIMIT ${limit} OFFSET ${offset}`,
      first ? facetCounts(sql, f) : null,
    ]);
    const total = counts?.total ?? ((await sql`SELECT count(*)::int AS total FROM ${blockJoins(sql)} WHERE ${blockWhere(sql, f)}`)[0].total as number);
    const items = rows.map(toBlock);
    return Response.json({
      items, blocks: items, generatedAt: new Date().toISOString(),
      nextCursor: offset + items.length < total ? String(offset + items.length) : null, total,
      ...(counts && { facets: counts.facets, nearMiss: counts.nearMiss }),
    });
  } catch (error) { return apiError(error); }
}
