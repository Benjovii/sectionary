// Fetches what the wall needs and hands back a queryable index.
//
// Kept apart from block-source.ts so that file stays free of runtime imports
// and scripts/mock-blocks.mjs can load it under Node type stripping.

import type { Block, BlockSet } from "@/contracts/block";
import type { Store, StoreSet } from "@/contracts/store";
import { buildIndex, queryBlocks, MAX_LIMIT, type BlockIndex, type WallQuery, type WallResponse } from "@/lib/block-source";
import { baseType, detailIndex, type DetailIndex } from "@/lib/block-detail";
import { expandBlocks } from "@/lib/mock-blocks";
import { pagesFromBlocks, profileFromApi, profileFromIndex, siteCardFromApi, siteCards, storeFromBlocks, summaryPages, type ProfilePage, type SiteCard, type SiteSummary, type SiteView } from "@/lib/site-profile";
import { flowSummaries, flowSummariesFromApi, type FlowSummary } from "@/lib/flows";
import type { SiteProfile } from "@/contracts/api";
import { BLOCKS_SRC, STORES_SRC, SITES_SRC, MOCK_BLOCKS, API_MODE } from "@/lib/data-source";

async function getJson<T>(src: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(src, { signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

/**
 * Where the wall gets its blocks (SEC-47). The sample is one file, so it loads
 * whole and every query runs over it in the browser. The API holds the full
 * capture, far too much to download, so each query goes to /api/blocks and
 * comes back a page at a time. Both answer with the same WallResponse, facets
 * and near misses included (server/blocks.ts runs the same rules in SQL).
 */
export type WallSource = {
  /** One page of a query. `facets: false` for the pages after the first. */
  query(query: WallQuery, options?: { facets?: boolean; signal?: AbortSignal }): Promise<WallResponse>;
  /**
   * What the detail view needs for one block: the block (null when the id is
   * unknown) and the index its pairing, similar blocks and captures read.
   * `known` is the block when the wall already has it, which saves a request.
   * `onPartial` gets an index early, as soon as part of it is in (the page's
   * own blocks, which pair the viewports, before "similar"), so the viewer can
   * fill in as it goes rather than wait for the slowest part.
   */
  detail(id: string, known?: Block, onPartial?: (detail: DetailIndex) => void): Promise<{ block: Block | null; detail: DetailIndex }>;
  /** Start fetching what opening this block needs, before it is opened (a hover). */
  prefetch?(block: Block): void;
};

export function wallSource(): WallSource {
  return API_MODE ? apiSource : sampleSource;
}

const sampleSource: WallSource = {
  async query(query, options) {
    return queryBlocks(await loadBlockIndex(), query, options);
  },
  async detail(id) {
    const detail = detailIndex(await loadBlockIndex());
    return { block: detail.byId.get(id) ?? null, detail };
  },
};

/** `src` with the query's non-empty values appended. */
function withQuery(src: string, query: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  const tail = params.toString();
  return tail ? `${src}${src.includes("?") ? "&" : "?"}${tail}` : src;
}

/**
 * Every block matching a query, following the cursor. Only for queries that
 * name one store or one kind of block; the cap is a backstop so a mistake
 * costs a slow view, not the whole capture.
 */
async function fetchAll(query: WallQuery, cap = 4_000): Promise<Block[]> {
  const blocks: Block[] = [];
  let cursor: string | undefined;
  do {
    const page = await getJson<WallResponse>(withQuery(BLOCKS_SRC, { ...query, cursor, limit: MAX_LIMIT }));
    blocks.push(...page.items);
    cursor = page.nextCursor ?? undefined;
  } while (cursor && blocks.length < cap);
  return blocks;
}

/** Fetched once per page session and dropped on failure, so the next try refetches. */
function once<T>(cache: Map<string, Promise<T>>, key: string, load: () => Promise<T>): Promise<T> {
  let pending = cache.get(key);
  if (!pending) {
    pending = load();
    pending.catch(() => cache.delete(key));
    cache.set(key, pending);
  }
  return pending;
}

const storeBlocks = new Map<string, Promise<Block[]>>();
const similarPools = new Map<string, Promise<Block[]>>();
const firstPages = new Map<string, { at: number; response: Promise<WallResponse> }>();

/** How long the browser reuses a wall page it already has: switching Web / Mobile and back asks once. */
const PAGE_TTL = 5 * 60_000;

/** One page of blocks of this kind at this viewport, for "similar": one per store is shown, so 200 is plenty. */
function similarPool(block: Block): Promise<Block[]> {
  const type = baseType(block.typeHint);
  return once(similarPools, `${block.viewport}:${type}`, () =>
    getJson<WallResponse>(withQuery(BLOCKS_SRC, { block: `${type},${type}-part`, vp: block.viewport, limit: MAX_LIMIT, facets: 0 })).then((r) => r.items),
  );
}

/** The block's own page at both viewports, which is all the Web / Mobile pairing reads. */
function pageOf(block: Block): Promise<Block[]> {
  return loadPageBlocks(block.host, block.pageUrl).then(({ desktop, mobile }) => [...desktop, ...mobile]);
}

const apiSource: WallSource = {
  query(query, options) {
    // The API sends facets with the first page only, so there is nothing to switch off.
    const src = withQuery(BLOCKS_SRC, { ...query });
    if (query.cursor) return getJson<WallResponse>(src, options?.signal);
    // First pages are kept a while: going back to a view already seen is instant.
    // The fetch itself is never aborted, so a view left half-loaded is ready next time.
    let hit = firstPages.get(src);
    if (!hit || Date.now() - hit.at > PAGE_TTL) {
      hit = { at: Date.now(), response: getJson<WallResponse>(src) };
      const mine = hit;
      hit.response.catch(() => firstPages.get(src) === mine && firstPages.delete(src));
      firstPages.set(src, hit);
    }
    const signal = options?.signal;
    if (!signal) return hit.response;
    return new Promise((resolve, reject) => {
      if (signal.aborted) return reject(new DOMException("Aborted", "AbortError"));
      signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      hit.response.then(resolve, reject);
    });
  },
  async detail(id, known, onPartial) {
    const block = known ?? (await fetch(`${BLOCKS_SRC}/${encodeURIComponent(id)}`).then((r) => (r.ok ? (r.json() as Promise<Block>) : null)));
    if (!block) return { block: null, detail: detailIndex(buildIndex([], [])) };
    const own = pageOf(block).catch(() => [block]);
    const pool = similarPool(block).catch(() => [] as Block[]);
    const index = (mine: Block[], others: Block[]) => {
      const seen = new Set(mine.map((b) => b.id));
      return detailIndex(buildIndex([...mine, ...others.filter((b) => !seen.has(b.id))], []));
    };
    // The page is one quick request; similar is a bigger one. Whichever comes first shows first.
    let done = false;
    let mineNow: Block[] = [block];
    let othersNow: Block[] = [];
    if (onPartial) {
      own.then((mine) => {
        mineNow = mine;
        if (!done) onPartial(index(mineNow, othersNow));
      });
      pool.then((others) => {
        othersNow = others;
        if (!done) onPartial(index(mineNow, othersNow));
      });
    }
    const [mine, others] = await Promise.all([own, pool]);
    done = true;
    return { block, detail: index(mine, others) };
  },
  prefetch(block) {
    void pageOf(block).catch(() => undefined);
    void similarPool(block).catch(() => undefined);
  },
};

/**
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
 * A site's profile: from the API when NEXT_PUBLIC_SITES_SRC points at it,
 * otherwise assembled from the loaded blocks. Null when the host is unknown.
 */
export async function loadSiteView(host: string): Promise<SiteView | null> {
  if (SITES_SRC) {
    const response = await fetch(`${SITES_SRC}/${encodeURIComponent(host)}`);
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return profileFromApi((await response.json()) as SiteProfile);
  }
  return profileFromIndex(await loadBlockIndex(), host);
}

export type PageBlocks = {
  desktop: Block[];
  mobile: Block[];
  /** True when only the sections the wall shows came back, without the ones the store repeats on other pages. */
  partial: boolean;
};

const pageBlocks = new Map<string, Promise<PageBlocks>>();

/**
 * Every block of one page, in page order, so the site profile can rebuild the
 * page from sections that each open in the block viewer. From
 * /api/sites/[host]/page; where that is not deployed yet, the store's blocks
 * from /api/blocks, which leave out the sections repeated from other pages.
 */
export function loadPageBlocks(host: string, url: string): Promise<PageBlocks> {
  return once(pageBlocks, `${host} ${url}`, async () => {
    const response = await fetch(withQuery(`${SITES_SRC}/${encodeURIComponent(host)}/page`, { url })).catch(() => null);
    if (response?.ok) {
      const { desktop, mobile } = (await response.json()) as { desktop: Block[]; mobile: Block[] };
      return { desktop, mobile, partial: false };
    }
    const own = (await once(storeBlocks, host, () => fetchAll({ host }))).filter((b) => b.pageUrl === url);
    return { desktop: own.filter((b) => b.viewport === "desktop"), mobile: own.filter((b) => b.viewport === "mobile"), partial: true };
  });
}

/**
 * Every store with its pages, from GET /api/sites when NEXT_PUBLIC_SITES_SRC
 * is set (SEC-47). 200 a request, so the 1,005 validated stores take six;
 * fetched once per page session and shared by the Sites grid and Flows.
 */
function loadSiteSummaries(): Promise<SiteSummary[]> {
  return once(siteLists, SITES_SRC, async () => {
    const sites: SiteSummary[] = [];
    let cursor: string | undefined;
    do {
      const page = await getJson<{ items: SiteSummary[]; nextCursor: string | null }>(withQuery(SITES_SRC, { cursor, limit: MAX_LIMIT }));
      sites.push(...page.items);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return sites;
  });
}

const siteLists = new Map<string, Promise<SiteSummary[]>>();

export type SitesDirectory = { cards: SiteCard[]; blockTypes: { value: string; count: number }[] };

/**
 * The Sites page: a card per store and the block-type directory above them.
 * From the API, cards come from /api/sites and the type counts from the
 * wall's facets; from the sample, both from the loaded blocks.
 */
export async function loadSitesDirectory(): Promise<SitesDirectory> {
  if (SITES_SRC) {
    const [sites, first] = await Promise.all([loadSiteSummaries(), wallSource().query({ limit: 1 })]);
    return { cards: sites.map(siteCardFromApi), blockTypes: namedTypes(first.facets?.block ?? []) };
  }
  const index = await loadBlockIndex();
  const counts = new Map<string, number>();
  for (const b of index.wall) counts.set(b.typeHint, (counts.get(b.typeHint) ?? 0) + 1);
  return { cards: siteCards(index), blockTypes: namedTypes([...counts].map(([value, count]) => ({ value, count }))) };
}

/** "-part" slices are what segmentation could not name ("zoo-home-part"): one store's markup, not a kind of block worth a link. */
function namedTypes(list: { value: string; count: number }[]) {
  return list.filter((t) => !t.value.endsWith("-part")).sort((a, b) => b.count - a.count);
}

/** Every captured store's flow: from /api/sites when it is configured, otherwise from the loaded blocks. */
export async function loadFlowSummaries(): Promise<FlowSummary[]> {
  return SITES_SRC ? flowSummariesFromApi(await loadSiteSummaries()) : flowSummaries(await loadBlockIndex());
}

/** A page from another store, offered as like the one open. */
export type SimilarPage = { store: Store; page: ProfilePage };

/** Every store with its pages, for "similar pages": from /api/sites, or built from the loaded blocks. */
function allSitePages(): Promise<SimilarPage[][]> {
  return once(sitePages, SITES_SRC, async () => {
    if (SITES_SRC) return (await loadSiteSummaries()).map((s) => summaryPages(s).map((page) => ({ store: s.store, page })));
    const index = await loadBlockIndex();
    const byHost = new Map<string, Block[]>();
    for (const b of index.blocks) {
      const list = byHost.get(b.host);
      if (list) list.push(b);
      else byHost.set(b.host, [b]);
    }
    return [...byHost].map(([host, blocks]) => {
      const store = index.storeByHost.get(host) ?? storeFromBlocks(host, blocks);
      return pagesFromBlocks(blocks).map((page) => ({ store, page }));
    });
  });
}

const sitePages = new Map<string, Promise<SimilarPage[][]>>();

/** Start loading what "similar pages" reads, so it is there by the time a page is opened. */
export function prefetchSimilarPages(): void {
  void allSitePages().catch(() => undefined);
}

/**
 * Pages like this one from other stores: the same kind of page (another home
 * page for a home page), one per store, ranked by what makes a store a useful
 * comparison: the same industry, then platform, then theme, then country.
 * The traffic rank breaks ties, so better-known stores come first.
 */
export async function loadSimilarPages(store: Store, page: ProfilePage, limit = 12): Promise<SimilarPage[]> {
  const scored: { item: SimilarPage; score: number }[] = [];
  for (const pages of await allSitePages()) {
    const match = pages.find((p) => p.page.type === page.type && p.page.blockCount > 0);
    if (!match || match.store.host === store.host) continue;
    const other = match.store;
    let score = 0;
    if (other.industry && other.industry === store.industry) score += 4;
    if (other.platform && other.platform === store.platform) score += 2;
    if (other.theme && other.theme === store.theme) score += 1;
    if (other.country && other.country === store.country) score += 0.5;
    scored.push({ item: match, score });
  }
  scored.sort((a, b) => b.score - a.score || (a.item.store.rank ?? Infinity) - (b.item.store.rank ?? Infinity) || a.item.store.host.localeCompare(b.item.store.host));
  return scored.slice(0, limit).map((s) => s.item);
}
