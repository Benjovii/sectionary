// Fetches what the wall needs and hands back a queryable index.
//
// Kept apart from block-source.ts so that file stays free of runtime imports
// and scripts/mock-blocks.mjs can load it under Node type stripping.

import type { Block, BlockSet } from "@/contracts/block";
import type { StoreSet } from "@/contracts/store";
import { buildIndex, queryBlocks, MAX_LIMIT, type BlockIndex, type WallQuery, type WallResponse } from "@/lib/block-source";
import { baseType, detailIndex, type DetailIndex } from "@/lib/block-detail";
import { expandBlocks } from "@/lib/mock-blocks";
import { profileFromApi, profileFromIndex, type SiteView } from "@/lib/site-profile";
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
   */
  detail(id: string, known?: Block): Promise<{ block: Block | null; detail: DetailIndex }>;
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

const apiSource: WallSource = {
  query(query, options) {
    // The API sends facets with the first page only, so there is nothing to switch off.
    return getJson<WallResponse>(withQuery(BLOCKS_SRC, { ...query }), options?.signal);
  },
  async detail(id, known) {
    const block = known ?? (await fetch(`${BLOCKS_SRC}/${encodeURIComponent(id)}`).then((r) => (r.ok ? (r.json() as Promise<Block>) : null)));
    if (!block) return { block: null, detail: detailIndex(buildIndex([], [])) };
    // The store's own blocks pair the viewports; one page of the same kind of
    // block at this viewport is plenty for "similar", which shows one per store.
    const type = baseType(block.typeHint);
    const [own, pool] = await Promise.all([
      once(storeBlocks, block.host, () => fetchAll({ host: block.host })),
      once(similarPools, `${block.viewport}:${type}`, () =>
        getJson<WallResponse>(withQuery(BLOCKS_SRC, { block: `${type},${type}-part`, vp: block.viewport, limit: MAX_LIMIT })).then((r) => r.items),
      ),
    ]);
    const seen = new Set(own.map((b) => b.id));
    return { block, detail: detailIndex(buildIndex([...own, ...pool.filter((b) => !seen.has(b.id))], [])) };
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
