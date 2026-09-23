// Fetches what the wall needs and hands back a queryable index.
//
// Kept apart from block-source.ts so that file stays free of runtime imports
// and scripts/mock-blocks.mjs can load it under Node type stripping.

import type { BlockSet } from "@/contracts/block";
import type { StoreSet } from "@/contracts/store";
import { buildIndex, type BlockIndex } from "@/lib/block-source";
import { expandBlocks } from "@/lib/mock-blocks";
import { profileFromApi, profileFromIndex, type SiteView } from "@/lib/site-profile";
import type { SiteProfile } from "@/contracts/api";
import { BLOCKS_SRC, STORES_SRC, SITES_SRC, MOCK_BLOCKS } from "@/lib/data-source";

async function getJson<T>(src: string): Promise<T> {
  const response = await fetch(src);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

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
