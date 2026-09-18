import { apiError, database } from "@/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url), get = (key: string) => url.searchParams.get(key)?.trim() || null;
    const platform = get("platform"), industry = get("industry"), country = get("country"), q = get("q");
    const sort = get("sort") ?? "rank", limit = Math.min(200, Math.max(1, Number(get("limit")) || 60));
    const offset = Math.max(0, Number(get("cursor")) || 0), sql = database();
    const order = sort === "brand" ? sql`brand ASC NULLS LAST` : sort === "platform" ? sql`platform ASC NULLS LAST` : sort === "industry" ? sql`industry ASC` : sql`rank ASC NULLS LAST`;
    const rows = await sql`SELECT *, count(*) OVER()::int AS total FROM sites
      WHERE (${platform}::text IS NULL OR platform=${platform}) AND (${industry}::text IS NULL OR industry=${industry})
        AND (${country}::text IS NULL OR country=${country})
        AND (${q}::text IS NULL OR to_tsvector('simple',coalesce(host,'')||' '||coalesce(brand,'')||' '||coalesce(title,'')) @@ websearch_to_tsquery('simple',${q}))
      ORDER BY ${order} LIMIT ${limit} OFFSET ${offset}`;
    const items = rows.map((r, i) => ({ n: offset + i + 1, host: r.host, brand: r.brand ?? r.host, title: r.title,
      platform: r.platform, builder: r.builder, theme: r.theme_name, themeVersion: r.theme_version, currency: r.currency,
      country: r.country, industry: r.industry, industryScore: r.industry_score, apps: r.apps, collections: null,
      rank: r.rank, mentions: r.mentions, sources: r.sources, validatedAt: r.validated_at?.toISOString?.() ?? null }));
    const total = rows[0]?.total ?? 0;
    return Response.json({ items, stores: items, generatedAt: new Date().toISOString(), nextCursor: offset + items.length < total ? String(offset + items.length) : null, total });
  } catch (error) { return apiError(error); }
}
