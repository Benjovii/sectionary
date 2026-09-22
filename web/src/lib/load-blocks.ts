// Fetches what the wall needs and hands back a queryable index.
//
// Kept apart from block-source.ts so that file stays free of runtime imports
// and scripts/mock-blocks.mjs can load it under Node type stripping.

import type { BlockSet } from "@/contracts/block";
import type { StoreSet } from "@/contracts/store";
import { buildIndex, type BlockIndex } from "@/lib/block-source";
import { expandBlocks } from "@/lib/mock-blocks";
import { BLOCKS_SRC, STORES_SRC, MOCK_BLOCKS } from "@/lib/data-source";

async function getJson<T>(src: string): Promise<T> {
  const response = await fetch(src);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

/**
 * The stores come along because Block carries no industry or country: those two
 * filters join to the store set by host. See block-source.ts.
 */
export async function loadBlockIndex(blocksSrc = BLOCKS_SRC, storesSrc = STORES_SRC): Promise<BlockIndex> {
  const [blockSet, storeSet] = await Promise.all([getJson<BlockSet>(blocksSrc), getJson<StoreSet>(storesSrc)]);
  const blocks = MOCK_BLOCKS > 0 ? expandBlocks(blockSet.blocks, storeSet.stores, MOCK_BLOCKS) : blockSet.blocks;
  return buildIndex(blocks, storeSet.stores);
}
