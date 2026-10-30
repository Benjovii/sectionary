import { apiError, database, PUBLIC_CACHE } from "@/server/db";
import { blockColumns, blockJoins, LATEST, toBlock } from "@/server/blocks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/sites/[host]/page?url=<page url> · every block of one page at its
 * latest capture, in page order, per viewport: `{ desktop, mobile }`.
 *
 * Unlike /api/blocks this keeps the sections a store repeats (the header on
 * every page), because the site profile's page viewer rebuilds the whole page
 * from its blocks, and each one opens in the block viewer.
 */
export async function GET(request: Request, { params }: { params: Promise<{ host: string }> }) {
  try {
    const { host } = await params;
    const url = new URL(request.url).searchParams.get("url");
    if (!url) return Response.json({ error: "url is required", code: "BAD_REQUEST" }, { status: 400 });
    const sql = database();
    const rows = await sql`SELECT ${blockColumns(sql)} FROM ${blockJoins(sql)}
      WHERE s.host=${host.toLowerCase()} AND p.url=${url} AND ${LATEST(sql)}
      ORDER BY b.viewport, b.block_index, b.id`;
    const blocks = rows.map(toBlock);
    return Response.json(
      { desktop: blocks.filter((b) => b.viewport === "desktop"), mobile: blocks.filter((b) => b.viewport === "mobile") },
      { headers: PUBLIC_CACHE },
    );
  } catch (error) { return apiError(error); }
}
