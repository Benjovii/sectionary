import { apiError, database, PUBLIC_CACHE } from "@/server/db";
import { cachedJson, keyOf } from "@/server/response-cache";
import { blockColumns, blockJoins, blockWhere, facetCounts, readFilters, toBlock, withColours } from "@/server/blocks";
import { searchBlocks } from "@/server/search";
import { userForRequest } from "@/server/accounts";
import { accessOf, can, FREE_FILTERS, gatesOn } from "@/server/plans";
import type { BlockFilters } from "@/server/blocks";

/**
 * Free and signed-out viewers filter by Store and Block type only (with
 * PLAN_GATES=on): any other filter is dropped. Only a request that carries one
 * looks up the session, so the wall's ordinary pages stay CDN-cached for all.
 */
async function allowedFilters(request: Request, f: BlockFilters): Promise<{ f: BlockFilters; personal: boolean }> {
  const extra = Object.keys(f).filter((k) => !FREE_FILTERS.has(k));
  if (!gatesOn() || extra.length === 0) return { f, personal: false };
  if (can(accessOf(await userForRequest(request)), "filters")) return { f, personal: true };
  const kept: BlockFilters = {};
  for (const k of Object.keys(f) as (keyof BlockFilters)[]) if (FREE_FILTERS.has(k)) (kept as Record<string, unknown>)[k] = f[k];
  return { f: kept, personal: true };
}
const PRIVATE = { "Cache-Control": "private, no-store" };

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
    const gated = await allowedFilters(request, readFilters(url));
    // An answer every visitor gets alike is kept in memory (server/response-cache.ts):
    // on AWS no CDN keeps it, and building one takes the database seconds.
    if (gated.personal) {
      const { body, headers } = await answer(url, sql, gated.f);
      return Response.json(body, { headers: { ...PRIVATE, ...headers } });
    }
    return await cachedJson(keyOf(url), PUBLIC_CACHE, () => answer(url, sql, gated.f));
  } catch (error) { return apiError(error); }
}

/**
 * One page of blocks. `facets=0` leaves out facets and near misses even on the
 * first page, for callers that only want the blocks (the viewer's "similar").
 */
async function answer(url: URL, sql: ReturnType<typeof database>, filters: BlockFilters): Promise<{ body: unknown; headers?: Record<string, string> }> {
  const f = await withColours(sql, filters);
  const q = url.searchParams.get("q")?.trim() || null;
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit")) || 60));
  const offset = Math.max(0, Number(url.searchParams.get("cursor")) || 0);
  const first = offset === 0 && url.searchParams.get("facets") !== "0";

  if (q) {
    const { items, total, nextCursor, facets, nearMiss, search } = await searchBlocks(q, f, limit, offset, first);
    // How the query was read goes in headers, so the body stays exactly BlocksResponse.
    const headers = {
      "x-search-terms": search.terms.join(" "),
      "x-search-corrected": Object.entries(search.corrected).map(([from, to]) => `${from}>${to}`).join(" "),
      "x-search-semantic": String(search.semantic),
      "x-search-intent": search.intents.join(" "),
    };
    return { body: { items, blocks: items, generatedAt: new Date().toISOString(), nextCursor, total, ...(first && { facets, nearMiss }) }, headers };
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
  return {
    body: {
      items, blocks: items, generatedAt: new Date().toISOString(),
      nextCursor: offset + items.length < total ? String(offset + items.length) : null, total,
      ...(counts && { facets: counts.facets, nearMiss: counts.nearMiss }),
    },
  };
}
