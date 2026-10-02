import { apiError, database } from "@/server/db";
import { latestPages, toStore } from "@/server/sites";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ host: string }> }) {
  try {
    const { host } = await params, sql = database();
    const [site] = await sql`SELECT * FROM sites WHERE host=${host.toLowerCase()} LIMIT 1`;
    if (!site) return Response.json({ error: "Site not found", code: "NOT_FOUND" }, { status: 404 });
    const [pages, captureRows] = await Promise.all([
      latestPages(sql, [site.id]),
      sql`SELECT c.captured_at,count(DISTINCT c.page_id)::int AS pages FROM captures c JOIN pages p ON p.id=c.page_id
        WHERE p.site_id=${site.id} GROUP BY c.captured_at ORDER BY c.captured_at DESC`,
    ]);
    return Response.json({ store: toStore(site), pages: pages.get(site.id) ?? [],
      captures: captureRows.map((c) => ({ capturedAt: c.captured_at.toISOString(), pages: c.pages })) });
  } catch (error) { return apiError(error); }
}
