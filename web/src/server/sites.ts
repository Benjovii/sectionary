import type { Store } from "@/contracts/store";
import type { SiteProfile } from "@/contracts/api";
import { database, pgArray } from "@/server/db";

type Sql = ReturnType<typeof database>;

/** A `sites` row as the Store the contract describes. `n` is the row's place in its list. */
export function toStore(r: Record<string, unknown>, n = 1): Store {
  return {
    n, host: r.host as string, brand: (r.brand as string | null) ?? (r.host as string), title: r.title as string | null,
    platform: r.platform as string | null, builder: r.builder as string | null, theme: r.theme_name as string | null,
    themeVersion: r.theme_version as string | null, currency: r.currency as string | null, country: r.country as string | null,
    industry: r.industry as string, industryScore: r.industry_score as number, apps: r.apps as string[],
    collections: null, rank: r.rank as number | null, mentions: r.mentions as number, sources: r.sources as string[],
    validatedAt: (r.validated_at as Date | null)?.toISOString?.() ?? null,
  };
}

/** Every page of these sites at its latest capture, with full-page shots and block counts, keyed by site id. */
export async function latestPages(sql: Sql, siteIds: string[]): Promise<Map<string, SiteProfile["pages"]>> {
  const rows = siteIds.length
    ? await sql`SELECT p.site_id,p.url,p.type,p.title,c.captured_at,c.desktop,c.mobile,
        (SELECT count(*)::int FROM blocks b WHERE b.capture_id=c.id) AS blocks
        FROM pages p JOIN LATERAL (SELECT * FROM captures WHERE page_id=p.id ORDER BY captured_at DESC LIMIT 1) c ON true
        WHERE p.site_id=ANY(${pgArray(siteIds)}::uuid[]) ORDER BY p.type,p.url`
    : [];
  const bySite = new Map<string, SiteProfile["pages"]>();
  for (const p of rows) {
    const list = bySite.get(p.site_id) ?? [];
    list.push({ url: p.url, type: p.type, title: p.title, capturedAt: p.captured_at.toISOString(),
      desktop: p.desktop?.file ?? null, mobile: p.mobile?.file ?? null, blocks: p.blocks });
    bySite.set(p.site_id, list);
  }
  return bySite;
}
