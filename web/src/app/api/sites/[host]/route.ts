import { apiError, database } from "@/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ host: string }> }) {
  try {
    const { host } = await params, sql = database();
    const [site] = await sql`SELECT * FROM sites WHERE host=${host.toLowerCase()} LIMIT 1`;
    if (!site) return Response.json({ error: "Site not found", code: "NOT_FOUND" }, { status: 404 });
    const pageRows = await sql`SELECT p.url,p.type,p.title,c.captured_at,c.desktop,c.mobile,
      (SELECT count(*)::int FROM blocks b WHERE b.capture_id=c.id) AS blocks
      FROM pages p JOIN LATERAL (SELECT * FROM captures WHERE page_id=p.id ORDER BY captured_at DESC LIMIT 1) c ON true
      WHERE p.site_id=${site.id} ORDER BY p.type,p.url`;
    const captureRows = await sql`SELECT c.captured_at,count(DISTINCT c.page_id)::int AS pages FROM captures c JOIN pages p ON p.id=c.page_id
      WHERE p.site_id=${site.id} GROUP BY c.captured_at ORDER BY c.captured_at DESC`;
    const store = { n: 1, host: site.host, brand: site.brand ?? site.host, title: site.title, platform: site.platform,
      builder: site.builder, theme: site.theme_name, themeVersion: site.theme_version, currency: site.currency, country: site.country,
      industry: site.industry, industryScore: site.industry_score, apps: site.apps, collections: null, rank: site.rank,
      mentions: site.mentions, sources: site.sources, validatedAt: site.validated_at?.toISOString?.() ?? null };
    return Response.json({ store, pages: pageRows.map((p) => ({ url: p.url, type: p.type, title: p.title,
      capturedAt: p.captured_at.toISOString(), desktop: p.desktop?.file ?? null, mobile: p.mobile?.file ?? null, blocks: p.blocks })),
      captures: captureRows.map((c) => ({ capturedAt: c.captured_at.toISOString(), pages: c.pages })) });
  } catch (error) { return apiError(error); }
}
