import { apiError } from "@/server/db";
import { blockIndex } from "@/server/block-index";
import { queryBlocks, type WallQuery } from "@/lib/block-source";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/blocks · contract v1's BlocksQuery in, BlocksResponse out, with the
 * wall's three additive extras (a comma-separated `vp`, `video`, `color`) and
 * `facets` on every first page. Multi-value filters are comma-separated, as
 * docs/CONTRACTS.md says. The filtering is lib/block-source.ts, the same code
 * the sample path runs, over the index in server/block-index.ts.
 */
const KEYS = ["page", "block", "vp", "platform", "theme", "app", "industry", "country", "host", "video", "color", "q", "cursor"] as const;

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const query: WallQuery = {};
    for (const key of KEYS) {
      const value = url.searchParams.get(key)?.trim();
      if (value) query[key] = value;
    }
    const limit = Number(url.searchParams.get("limit"));
    if (limit) query.limit = limit;

    // Facets do not change as you page through one result set, so later pages skip them.
    const response = queryBlocks(await blockIndex(), query, { facets: !query.cursor });
    return Response.json(response);
  } catch (error) {
    return apiError(error);
  }
}
