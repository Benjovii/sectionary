// Fetches what the pages need, from the sample JSON or from the API.
//
// Kept apart from block-source.ts so that file stays free of runtime imports
// and scripts/mock-blocks.mjs can load it under Node type stripping.
//
// Two paths (see data-source.ts). The sample is one file, so it loads whole
// into a BlockIndex and everything is a lookup over that. The API holds the
// full capture, so nothing loads it whole: the wall pages through
// /api/blocks with its query, and the detail view, a site profile or a
// Sites cover fetches just the stores it shows and builds a small index from
// them. The small index has the same shape as the big one, so the view code
// (block-detail.ts, site-profile.ts) does not know which path it is on.

import type { Block, BlockSet } from "@/contracts/block";
import type { Store, StoreSet } from "@/contracts/store";
import { buildIndex, MAX_LIMIT, type BlockIndex, type WallQuery, type WallResponse } from "@/lib/block-source";
import { baseType, detailIndex, type DetailIndex } from "@/lib/block-detail";
import { expandBlocks } from "@/lib/mock-blocks";
import { profileFromApi, profileFromIndex, siteCards, type SiteCard, type SiteView } from "@/lib/site-profile";
import type { SiteProfile, StoresResponse } from "@/contracts/api";
import { BLOCKS_SRC, STORES_SRC, SITES_SRC, MOCK_BLOCKS, BLOCKS_FROM_API } from "@/lib/data-source";

async function getJson<T>(src: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(src, { signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

/** `src` with the query's non-empty values appended, whether or not it already has a query string. */
function withQuery(src: string, query: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  const tail = params.toString();
  return tail ? `${src}${src.includes("?") ? "&" : "?"}${tail}` : src;
}

/** One page of blocks from the API. Facets come with the first page only. */
export function fetchBlocks(query: WallQuery, signal?: AbortSignal): Promise<WallResponse> {
  return getJson<WallResponse>(withQuery(BLOCKS_SRC, query), signal);
}

/**
 * Every block matching a query, following the cursor. Only for queries that
 * name a few stores or a kind of block, never the whole set; the cap is a
 * backstop so a mistake costs a slow view rather than the whole capture.
 */
async function fetchAllBlocks(query: WallQuery, cap = 4_000): Promise<Block[]> {
  const blocks: Block[] = [];
  let cursor: string | undefined;
  do {
    const page = await fetchBlocks({ ...query, cursor, limit: MAX_LIMIT });
    blocks.push(...page.items);
    cursor = page.nextCursor ?? undefined;
  } while (cursor && blocks.length < cap);
  return blocks;
}

/** One store's blocks, fetched once per page session and shared by the detail view and the profile. */
function hostBlocks(host: string): Promise<Block[]> {
  let pending = byHost.get(host);
  if (!pending) {
    pending = fetchAllBlocks({ host });
    pending.catch(() => byHost.delete(host));
    byHost.set(host, pending);
  }
  return pending;
}

const byHost = new Map<string, Promise<Block[]>>();

/**
 * Every store. The sample is one StoreSet; the API pages, 200 at a time, so
 * the 1,005 validated stores take six requests.
 */
export function loadStores(): Promise<Store[]> {
  storesLoad ??= (async () => {
    if (!BLOCKS_FROM_API) return (await getJson<StoreSet>(STORES_SRC)).stores;
    const stores: Store[] = [];
    let cursor: string | undefined;
    do {
      const page = await getJson<StoresResponse>(withQuery(STORES_SRC, { cursor, limit: MAX_LIMIT }));
      stores.push(...page.items);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return stores;
  })();
  storesLoad.catch(() => (storesLoad = null));
  return storesLoad;
}

let storesLoad: Promise<Store[]> | null = null;

/**
 * The whole sample as a queryable index. Sample path only: on the API path
 * the wall calls fetchBlocks instead.
 *
 * The stores come along because Block carries no industry or country: those two
 * filters join to the store set by host. See block-source.ts.
 */
export function loadBlockIndex(blocksSrc = BLOCKS_SRC, storesSrc = STORES_SRC): Promise<BlockIndex> {
  // One load per page session: going from the wall to a site profile and back
  // reuses the index rather than fetching and expanding the set again. A
  // failed load is dropped so the next visit retries.
  const key = `${blocksSrc}|${storesSrc}`;
  let pending = loaded.get(key);
  if (!pending) {
    pending = load(blocksSrc, storesSrc);
    pending.catch(() => loaded.delete(key));
    loaded.set(key, pending);
  }
  return pending;
}

const loaded = new Map<string, Promise<BlockIndex>>();

async function load(blocksSrc: string, storesSrc: string): Promise<BlockIndex> {
  const [blockSet, storeSet] = await Promise.all([getJson<BlockSet>(blocksSrc), getJson<StoreSet>(storesSrc)]);
  // The mock tops the real sample up to the target rather than replacing it,
  // so the stores we actually captured stay in the set at every scale.
  const real = blockSet.blocks;
  const blocks = MOCK_BLOCKS > 0 ? [...real, ...expandBlocks(real, storeSet.stores, Math.max(0, MOCK_BLOCKS - real.length))] : real;
  return buildIndex(blocks, storeSet.stores);
}

/**
 * What the detail view needs for one block, API path: its store's blocks (the
 * block itself, its page for the other viewport, its captures) plus blocks of
 * the same kind at the same viewport from every store, for "similar". The
 * store comes from the id (`<host>/<page-slug>/<viewport>/<index>`), so a
 * pasted link works without the wall.
 */
export async function loadDetail(id: string): Promise<DetailIndex> {
  const host = id.split("/")[0];
  const own = await hostBlocks(host);
  const block = own.find((b) => b.id === id);
  if (!block) return detailIndex(buildIndex(own, []));
  const type = baseType(block.typeHint);
  // One page is plenty: similarTo keeps one block per store and shows twelve.
  const pool = await fetchBlocks({ block: `${type},${type}-part`, vp: block.viewport, limit: MAX_LIMIT });
  const seen = new Set(own.map((b) => b.id));
  return detailIndex(buildIndex([...own, ...pool.items.filter((b) => !seen.has(b.id))], []));
}

/**
 * A site's profile. API path: the store's blocks, which make the page
 * thumbnails, with the store record from /api/sites when that is configured.
 * Sample path: from the profile API when NEXT_PUBLIC_SITES_SRC points at it,
 * otherwise assembled from the loaded blocks. Null when the host is unknown.
 */
export async function loadSiteView(host: string): Promise<SiteView | null> {
  if (BLOCKS_FROM_API) {
    const [blocks, profile] = await Promise.all([hostBlocks(host), SITES_SRC ? fetchProfile(host) : null]);
    return profileFromIndex(buildIndex(blocks, profile ? [profile.store] : []), host);
  }
  if (SITES_SRC) {
    const profile = await fetchProfile(host);
    return profile ? profileFromApi(profile) : null;
  }
  return profileFromIndex(await loadBlockIndex(), host);
}

async function fetchProfile(host: string): Promise<SiteProfile | null> {
  const response = await fetch(`${SITES_SRC}/${encodeURIComponent(host)}`);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.json()) as SiteProfile;
}

export type SitesDirectory = { cards: SiteCard[]; blockTypes: { value: string; count: number }[] };

/**
 * The Sites page: a card per store and the block-type directory. On the API
 * path the counts come from the facets and the covers are left empty for
 * loadCovers to fill as cards scroll into view.
 */
export async function loadSitesDirectory(): Promise<SitesDirectory> {
  if (BLOCKS_FROM_API) {
    const [stores, first] = await Promise.all([loadStores(), fetchBlocks({ limit: 1 })]);
    const counts = new Map((first.facets?.host ?? []).map((f) => [f.value, f.count]));
    const cards = stores.map((store) => ({ store, listed: true, pageCount: 0, blockCount: counts.get(store.host) ?? 0, cover: null }));
    return { cards, blockTypes: typeCounts(first.facets?.block ?? []) };
  }
  const index = await loadBlockIndex();
  const counts = new Map<string, number>();
  for (const b of index.blocks) counts.set(b.typeHint, (counts.get(b.typeHint) ?? 0) + 1);
  return { cards: siteCards(index), blockTypes: typeCounts([...counts].map(([value, count]) => ({ value, count }))) };
}

/** "-part" slices are what segmentation could not name ("zoo-home-part"): one store's markup, not a kind of block worth a link. */
function typeCounts(list: { value: string; count: number }[]) {
  return list.filter((t) => !t.value.endsWith("-part")).sort((a, b) => b.count - a.count);
}

/**
 * Covers for a batch of Sites cards, API path: the home pages of those stores
 * in one query, and for any store with no home page captured, its own blocks.
 * Returns the finished cards, keyed by host.
 */
export async function loadCovers(stores: Store[]): Promise<Map<string, SiteCard>> {
  const home = await fetchAllBlocks({ host: stores.map((s) => s.host).join(","), page: "home" });
  const found = new Set(home.map((b) => b.host));
  const rest = await Promise.all(stores.filter((s) => !found.has(s.host)).map((s) => hostBlocks(s.host)));
  const cards = siteCards(buildIndex([...home, ...rest.flat()], stores));
  return new Map(cards.map((c) => [c.store.host, c]));
}
