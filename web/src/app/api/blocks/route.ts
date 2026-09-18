import { apiError, database } from "@/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const value = (url: URL, key: string) => url.searchParams.get(key)?.trim() || null;

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const page = value(url, "page"), block = value(url, "block"), vp = value(url, "vp");
    const platform = value(url, "platform"), theme = value(url, "theme"), app = value(url, "app");
    const industry = value(url, "industry"), country = value(url, "country"), host = value(url, "host"), q = value(url, "q");
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit")) || 60));
    const offset = Math.max(0, Number(url.searchParams.get("cursor")) || 0);
    const sql = database();
    const rows = await sql`
      SELECT b.id, s.host, p.type AS page_type, p.url AS page_url, p.title AS page_title,
        b.viewport, b.type_hint, b.headline, b.background, b.width, b.height, b.image_key,
        s.platform, s.theme_name, s.apps, b.buttons, b.images, b.videos, left(b.text, 400) AS text
      FROM blocks b JOIN captures c ON c.id=b.capture_id JOIN pages p ON p.id=c.page_id JOIN sites s ON s.id=p.site_id
      WHERE c.id=(SELECT c2.id FROM captures c2 WHERE c2.page_id=p.id ORDER BY c2.captured_at DESC LIMIT 1)
        AND (${page}::text IS NULL OR p.type=${page}) AND (${block}::text IS NULL OR coalesce(b.block_type,b.type_hint)=${block})
        AND (${vp}::text IS NULL OR b.viewport=${vp}) AND (${platform}::text IS NULL OR s.platform=${platform})
        AND (${theme}::text IS NULL OR s.theme_name=${theme}) AND (${app}::text IS NULL OR ${app}=ANY(s.apps))
        AND (${industry}::text IS NULL OR s.industry=${industry}) AND (${country}::text IS NULL OR s.country=${country})
        AND (${host}::text IS NULL OR s.host=${host})
        AND (${q}::text IS NULL OR to_tsvector('english',coalesce(b.headline,'')||' '||b.text||' '||b.type_hint) @@ websearch_to_tsquery('english',${q}))
      ORDER BY c.captured_at DESC, b.id LIMIT ${limit} OFFSET ${offset}`;
    const [{ count }] = await sql`
      SELECT count(*)::int AS count FROM blocks b JOIN captures c ON c.id=b.capture_id JOIN pages p ON p.id=c.page_id JOIN sites s ON s.id=p.site_id
      WHERE c.id=(SELECT c2.id FROM captures c2 WHERE c2.page_id=p.id ORDER BY c2.captured_at DESC LIMIT 1)
        AND (${page}::text IS NULL OR p.type=${page}) AND (${block}::text IS NULL OR coalesce(b.block_type,b.type_hint)=${block})
        AND (${vp}::text IS NULL OR b.viewport=${vp}) AND (${platform}::text IS NULL OR s.platform=${platform})
        AND (${theme}::text IS NULL OR s.theme_name=${theme}) AND (${app}::text IS NULL OR ${app}=ANY(s.apps))
        AND (${industry}::text IS NULL OR s.industry=${industry}) AND (${country}::text IS NULL OR s.country=${country})
        AND (${host}::text IS NULL OR s.host=${host})
        AND (${q}::text IS NULL OR to_tsvector('english',coalesce(b.headline,'')||' '||b.text||' '||b.type_hint) @@ websearch_to_tsquery('english',${q}))`;
    const items = rows.map((r) => ({ id: r.id, host: r.host, pageType: r.page_type, pageUrl: r.page_url,
      pageTitle: r.page_title, viewport: r.viewport, typeHint: r.type_hint, headline: r.headline, bg: r.background,
      w: r.width, h: r.height, src: r.image_key ?? "", platform: r.platform, theme: r.theme_name, apps: r.apps,
      buttons: r.buttons, images: r.images, videos: r.videos, text: r.text }));
    return Response.json({ items, blocks: items, generatedAt: new Date().toISOString(), nextCursor: offset + items.length < count ? String(offset + items.length) : null, total: count });
  } catch (error) { return apiError(error); }
}
