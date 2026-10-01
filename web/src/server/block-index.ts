// The database's blocks as a BlockIndex, so /api/blocks answers with the same
// query layer the sample path runs in the browser (lib/block-source.ts).
//
// One implementation of the filters means the API and the sample can never
// disagree about what "platform=shopify,woocommerce&color=blue" returns, and
// the parts contract v1 has no SQL for yet (the viewport pair, video, colour,
// facets, near misses) work on day one. The cost is holding the latest
// capture of every block in memory: about 1 KB a block, so 60 MB at the full
// capture. When search (SEC-17) moves filtering into Postgres, this file is
// what it replaces, and the route's response does not change.

import type { Block } from "@/contracts/block";
import type { Store } from "@/contracts/store";
import { buildIndex, type BlockIndex } from "@/lib/block-source";
import type { Row } from "postgres";
import { database } from "@/server/db";

/** How long a loaded index answers before the next request reloads it. Imports show up within this. */
const TTL_MS = 60_000;

let cached: { at: number; index: Promise<BlockIndex> } | null = null;

/** The current index, loaded at most once per TTL however many requests arrive together. */
export function blockIndex(): Promise<BlockIndex> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.index;
  const index = load();
  const entry = { at: Date.now(), index };
  cached = entry;
  // A failed load must not be served for a minute.
  index.catch(() => {
    if (cached === entry) cached = null;
  });
  return index;
}

/** A `sites` row as contract v1's Store. */
export function storeFromRow(r: Row, n: number): Store {
  return {
    n,
    host: r.host,
    brand: r.brand ?? r.host,
    title: r.title,
    platform: r.platform,
    builder: r.builder,
    theme: r.theme_name,
    themeVersion: r.theme_version,
    currency: r.currency,
    country: r.country,
    industry: r.industry,
    industryScore: r.industry_score,
    apps: r.apps,
    collections: null,
    rank: r.rank,
    mentions: r.mentions,
    sources: r.sources,
    validatedAt: r.validated_at?.toISOString?.() ?? null,
  };
}

async function load(): Promise<BlockIndex> {
  const sql = database();
  // The latest capture of each page only, newest pages first, blocks in page
  // order. That order is the wall's order, so a store's hero comes before its
  // footer.
  const [rows, siteRows] = await Promise.all([
    sql`
      SELECT s.host, p.slug, p.type AS page_type, p.url AS page_url, p.title AS page_title, c.captured_at,
        b.block_index, b.viewport, b.type_hint, b.headline, b.background, b.width, b.height, b.image_key,
        s.platform, s.theme_name, s.apps, b.buttons, b.images, b.videos, left(b.text, 400) AS text
      FROM pages p
      JOIN sites s ON s.id = p.site_id
      JOIN LATERAL (SELECT id, captured_at FROM captures WHERE page_id = p.id ORDER BY captured_at DESC LIMIT 1) c ON true
      JOIN blocks b ON b.capture_id = c.id
      ORDER BY c.captured_at DESC, s.host, p.slug, b.viewport, b.block_index`,
    sql`SELECT * FROM sites ORDER BY rank ASC NULLS LAST, host`,
  ]);

  const blocks: Block[] = rows.map((r) => ({
    // Contract v1's stable id, not the row's uuid: it survives a recapture,
    // so a shared link keeps opening the same block and the detail view can
    // pair viewports and list captures by id (lib/block-detail.ts).
    id: `${r.host}/${r.slug}/${r.viewport}/${r.block_index}`,
    host: r.host,
    pageType: r.page_type,
    pageUrl: r.page_url,
    pageTitle: r.page_title,
    viewport: r.viewport,
    typeHint: r.type_hint,
    headline: r.headline,
    bg: r.background,
    w: r.width,
    h: r.height,
    src: r.image_key ?? "",
    platform: r.platform,
    theme: r.theme_name,
    apps: r.apps,
    buttons: r.buttons,
    images: r.images,
    videos: r.videos,
    text: r.text,
    // Not in contract v1; the detail view reads it when present.
    capturedAt: r.captured_at.toISOString(),
  }) as Block);

  const stores = siteRows.map((r, i) => storeFromRow(r, i + 1));
  return buildIndex(blocks, stores);
}
