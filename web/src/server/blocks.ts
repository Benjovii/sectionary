import type { Block } from "@/contracts/block";
import { BLOCKS_SRC } from "@/lib/data-source";
import { bucketFor } from "@/lib/colour";
import { database } from "@/server/db";

type Sql = ReturnType<typeof database>;

/**
 * The columns every Block comes from. Use it as `SELECT ${blockColumns(sql)} FROM ${blockJoins(sql)}`
 * so /api/blocks, boards, share links and the time machine return the same shape.
 */
export const blockColumns = (sql: Sql) => sql`b.id, s.host, p.type AS page_type, p.url AS page_url, p.title AS page_title,
  b.viewport, b.type_hint, b.headline, b.background, b.width, b.height, b.image_key,
  s.platform, s.theme_name, s.apps, b.buttons, b.images, b.videos, left(b.text, 400) AS text`;
export const blockJoins = (sql: Sql) => sql`blocks b JOIN captures c ON c.id=b.capture_id JOIN pages p ON p.id=c.page_id JOIN sites s ON s.id=p.site_id`;

export function toBlock(r: Record<string, unknown>): Block {
  return {
    id: r.id as string, host: r.host as string, pageType: r.page_type as string, pageUrl: r.page_url as string,
    pageTitle: (r.page_title as string | null) ?? null, viewport: r.viewport as Block["viewport"], typeHint: r.type_hint as string,
    headline: (r.headline as string | null) ?? null, bg: r.background as string, w: r.width as number, h: r.height as number,
    src: (r.image_key as string | null) ?? "", platform: (r.platform as string | null) ?? null, theme: (r.theme_name as string | null) ?? null,
    apps: (r.apps as string[]) ?? [], buttons: r.buttons as number, images: r.images as number, videos: r.videos as number, text: r.text as string,
  };
}

export type TechFacet = "platform" | "theme" | "app";

/**
 * Every filter the wall offers, in the order facets are reported. `video` and
 * `color` are not in contract v1 yet (see WallQuery in lib/block-source.ts):
 * they are accepted here so the wall works the same on the API as on the sample.
 */
export const FILTER_KEYS = ["page", "block", "vp", "platform", "theme", "app", "industry", "country", "host", "video", "color"] as const;
export type FilterKey = (typeof FILTER_KEYS)[number];

/**
 * A BlocksQuery's filters. `bg` is `color` resolved to the background colours
 * in those buckets (see withColours); blockWhere needs it whenever `color` is set.
 */
export type BlockFilters = Partial<Record<FilterKey, string[]>> & { bg?: string[] };

/** BlocksQuery filters from a URL. Multi-value filters are comma-separated (see the contract); a block matches any of them. */
export function readFilters(url: URL): BlockFilters {
  const f: BlockFilters = {};
  for (const key of FILTER_KEYS) {
    const values = (url.searchParams.get(key) ?? "").split(",").map((v) => v.trim()).filter(Boolean);
    if (values.length) f[key] = values;
  }
  return f;
}

/** What a block offers each filter, as a column over blockJoins. `app` is an array; every other one a single value. */
function valueOf(sql: Sql, key: FilterKey) {
  switch (key) {
    case "page": return sql`p.type`;
    case "block": return sql`coalesce(b.block_type,b.type_hint)`;
    case "vp": return sql`b.viewport`;
    case "platform": return sql`s.platform`;
    case "theme": return sql`s.theme_name`;
    case "app": return sql`s.apps`;
    case "industry": return sql`s.industry`;
    case "country": return sql`s.country`;
    case "host": return sql`s.host`;
    case "video": return sql`(CASE WHEN b.videos>0 THEN 'yes' ELSE 'no' END)`;
    case "color": return sql`b.background`;
  }
}

/**
 * One filter as a condition, or null when it is not set. Never NULL in SQL: a
 * store with no country fails a country filter rather than vanishing from the
 * near-miss counts.
 */
function condition(sql: Sql, f: BlockFilters, key: FilterKey) {
  if (!f[key]) return null;
  if (key === "app") return sql`coalesce(s.apps && ${sql.array(f.app!)}::text[], false)`;
  if (key === "color") {
    if (!f.bg) throw new Error("color filter used before withColours");
    return sql`coalesce(b.background=ANY(${sql.array(f.bg)}::text[]), false)`;
  }
  return sql`coalesce(${valueOf(sql, key)}=ANY(${sql.array(f[key]!)}::text[]), false)`;
}

const LATEST = (sql: Sql) => sql`c.id=(SELECT c2.id FROM captures c2 WHERE c2.page_id=p.id ORDER BY c2.captured_at DESC LIMIT 1)`;

/**
 * The WHERE clause for a BlocksQuery over blockJoins: the latest capture of
 * each page, then every filter given. `skip` leaves filters out, which is how
 * a facet counts what its other values would add.
 */
export function blockWhere(sql: Sql, f: BlockFilters, skip: FilterKey[] = []) {
  return FILTER_KEYS.filter((key) => !skip.includes(key))
    .map((key) => condition(sql, f, key))
    .reduce((where, next) => (next ? sql`${where} AND ${next}` : where), LATEST(sql));
}

// The colour filter buckets Block.bg in lib/colour.ts. Postgres cannot run
// that, but the library has few distinct backgrounds, so the server buckets
// each one once and filters on the list. Refreshed every few minutes so new
// captures' colours join without a restart.
let palette: { at: number; bucket: Map<string, string> } | null = null;

async function colourBuckets(sql: Sql): Promise<Map<string, string>> {
  if (palette && Date.now() - palette.at < 5 * 60_000) return palette.bucket;
  const rows = await sql`SELECT DISTINCT background FROM blocks WHERE background IS NOT NULL`;
  const bucket = new Map<string, string>();
  for (const { background } of rows) {
    const key = bucketFor(background as string);
    if (key) bucket.set(background as string, key);
  }
  palette = { at: Date.now(), bucket };
  return bucket;
}

/** `f` with its colour buckets resolved to backgrounds, ready for blockWhere. */
export async function withColours(sql: Sql, f: BlockFilters): Promise<BlockFilters> {
  if (!f.color) return f;
  const wanted = new Set(f.color);
  const bg = [...(await colourBuckets(sql))].filter(([, key]) => wanted.has(key)).map(([background]) => background);
  return { ...f, bg };
}

export type Facet = { value: string; count: number };
export type FacetCounts = { facets: Record<string, Facet[]>; nearMiss: Record<string, number>; total: number };

/**
 * Facet counts for every filter, plus near misses, in one pass over the
 * matching set, the same rule lib/block-source.ts applies in the browser: a
 * block counts toward filter D's facets when it clears every filter but D, and
 * it is a near miss for D when D is set and is the only filter it fails.
 * `ids` narrows the set (search passes its candidates). `f` must have been
 * through withColours.
 */
export async function facetCounts(sql: Sql, f: BlockFilters, ids?: string[]): Promise<FacetCounts> {
  const ok = (key: FilterKey) => sql(`ok_${key}`);
  const others = (key: FilterKey | null) =>
    FILTER_KEYS.filter((k) => k !== key).reduce((all, k) => sql`${all} AND ${ok(k)}`, sql`true`);
  const columns = FILTER_KEYS.map((key) => sql`${valueOf(sql, key)} AS ${sql(key)}, ${condition(sql, f, key) ?? sql`true`} AS ${ok(key)}`)
    .reduce((all, next) => sql`${all}, ${next}`);
  const facet = (key: FilterKey) =>
    key === "app"
      ? sql`SELECT 'app' AS key, a AS value, count(*)::int AS count FROM r CROSS JOIN unnest(r.app) a WHERE ${others(key)} GROUP BY a`
      : sql`SELECT ${key}::text AS key, ${sql(key)}::text AS value, count(*)::int AS count FROM r WHERE ${others(key)} AND ${sql(key)} IS NOT NULL GROUP BY 2`;
  const near = FILTER_KEYS.filter((key) => f[key]).map(
    (key) => sql`SELECT '#near' AS key, ${key}::text AS value, count(*)::int AS count FROM r WHERE ${others(key)} AND NOT ${ok(key)}`,
  );
  const parts = [sql`SELECT '#total' AS key, NULL::text AS value, count(*)::int AS count FROM r WHERE ${others(null)}`, ...FILTER_KEYS.map(facet), ...near];
  const rows = await sql`WITH r AS MATERIALIZED (
      SELECT ${columns} FROM ${blockJoins(sql)}
      WHERE ${LATEST(sql)} ${ids ? sql`AND b.id=ANY(${sql.array(ids)}::uuid[])` : sql``}
    ) ${parts.reduce((all, next) => sql`${all} UNION ALL ${next}`)}`;

  const tallies = new Map<string, Map<string, number>>();
  const nearMiss: Record<string, number> = {};
  let total = 0;
  const buckets = rows.some((r) => r.key === "color") ? await colourBuckets(sql) : null;
  for (const { key, value, count } of rows) {
    if (key === "#total") total = count;
    else if (key === "#near") { if (count > 0) nearMiss[value] = count; }
    else {
      // Colour comes back per background; the filter is per bucket.
      const shown = key === "color" ? buckets!.get(value) : value;
      if (!shown) continue;
      const tally = tallies.get(key) ?? new Map<string, number>();
      tally.set(shown, (tally.get(shown) ?? 0) + count);
      tallies.set(key, tally);
    }
  }
  const facets: Record<string, Facet[]> = {};
  for (const key of FILTER_KEYS) {
    facets[key] = [...(tallies.get(key) ?? [])]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
  }
  return { facets, nearMiss, total };
}

export const UUID =/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const hasDatabase = () => Boolean(process.env.DATABASE_URL);

/**
 * Find one block by id from a trusted source: the database when it is
 * configured, otherwise the sample JSON the app itself serves. Never trust a
 * block object sent by the browser: its `src` would decide what the server fetches.
 */
export async function findBlock(id: string, origin: string): Promise<Block | null> {
  if (hasDatabase()) {
    if (!UUID.test(id)) return null;
    const sql = database();
    const [row] = await sql`SELECT ${blockColumns(sql)} FROM ${blockJoins(sql)} WHERE b.id=${id}`;
    return row ? toBlock(row) : null;
  }
  const res = await fetch(new URL(BLOCKS_SRC, origin), { cache: "force-cache" });
  if (!res.ok) return null;
  const set = (await res.json()) as { blocks?: Block[]; items?: Block[] };
  return (set.blocks ?? set.items ?? []).find((b) => b.id === id) ?? null;
}
