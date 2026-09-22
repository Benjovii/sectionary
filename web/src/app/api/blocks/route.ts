import { apiError, database } from "@/server/db";
import { blockColumns, blockJoins, toBlock } from "@/server/blocks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const value = (url: URL, key: string) => url.searchParams.get(key)?.trim() || null;

type TechFacet = "platform" | "theme" | "app";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const page = value(url, "page"), block = value(url, "block"), vp = value(url, "vp");
    const platform = value(url, "platform"), theme = value(url, "theme"), app = value(url, "app");
    const industry = value(url, "industry"), country = value(url, "country"), host = value(url, "host"), q = value(url, "q");
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit")) || 60));
    const offset = Math.max(0, Number(url.searchParams.get("cursor")) || 0);
    const sql = database();
    // Latest capture of each page only. A facet skips its own filter, so picking
    // one app still shows how many blocks every other app would give.
    const where = (skip?: TechFacet) => sql`
      c.id=(SELECT c2.id FROM captures c2 WHERE c2.page_id=p.id ORDER BY c2.captured_at DESC LIMIT 1)
        AND (${page}::text IS NULL OR p.type=${page}) AND (${block}::text IS NULL OR coalesce(b.block_type,b.type_hint)=${block})
        AND (${vp}::text IS NULL OR b.viewport=${vp})
        AND (${skip === "platform" ? null : platform}::text IS NULL OR s.platform=${platform})
        AND (${skip === "theme" ? null : theme}::text IS NULL OR s.theme_name=${theme})
        AND (${skip === "app" ? null : app}::text IS NULL OR ${app}=ANY(s.apps))
        AND (${industry}::text IS NULL OR s.industry=${industry}) AND (${country}::text IS NULL OR s.country=${country})
        AND (${host}::text IS NULL OR s.host=${host})
        AND (${q}::text IS NULL OR to_tsvector('english',coalesce(b.headline,'')||' '||b.text||' '||b.type_hint) @@ websearch_to_tsquery('english',${q}))`;
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
