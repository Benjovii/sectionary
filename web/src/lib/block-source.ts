// The wall's query layer. It answers a BlocksQuery with a BlocksResponse, the
// same shapes /api/blocks serves, so the wall never learns where its blocks
// came from and SEC-47 becomes a change of source rather than a rewrite.
//
// Two notes on the contract:
//  - Multi-value filters are comma-separated, per docs/CONTRACTS.md.
//  - Block carries no industry or country, so those two filters join to the
//    store set by host. If the API ever adds them to Block this join can go.
//
// Kept free of runtime imports from outside lib/, so scripts/mock-blocks.mjs
// can load it under Node's type stripping.

import type { Block } from "@/contracts/block";
import type { Store } from "@/contracts/store";
import type { BlocksQuery, BlocksResponse } from "@/contracts/api";
// Relative, not "@/lib/colour": this is a value import, so Node cannot strip
// it the way it strips the type imports above, and it does not know the alias.
import { bucketFor } from "./colour.ts";

/**
 * BlocksQuery as SEC-16 needs it. Three gaps against contract v1, all of them
 * additive fixes to announce in SEC-37 before anyone opens a `contract/` PR:
 *
 *  1. `vp` is typed Viewport, a single value, so it cannot carry the
 *     comma-separated pair every other multi-value filter uses. Widening it to
 *     string is a one-word change and the only one that is arguably a fix
 *     rather than an addition.
 *  2. No `video`. Derived here from Block.videos.
 *  3. No `color`. Derived here from Block.bg, see lib/colour.ts.
 *
 * All three are filtered on the client today, so nothing is blocked; they
 * simply will not survive the move to /api/blocks (SEC-47) until the contract
 * catches up.
 */
export type WallQuery = Omit<BlocksQuery, "vp"> & {
  /** Comma-separated viewports. Contract v1 allows only one, see above. */
  vp?: string;
  /** "yes", "no", or both. */
  video?: string;
  /** Comma-separated colour buckets. */
  color?: string;
};

export const DEFAULT_LIMIT = 60;
export const MAX_LIMIT = 200;

/**
 * BlocksResponse plus what the empty state needs to teach (SEC-21). `nearMiss`
 * says, per dimension, how many blocks would appear if that one filter were
 * dropped, so "Nothing matches. Try removing Theme." names the filter actually
 * responsible rather than guessing.
 */
export type WallResponse = BlocksResponse & { nearMiss?: Record<string, number> };

/** Blocks plus the store lookup the industry and country filters need. */
export type BlockIndex = { blocks: Block[]; storeByHost: Map<string, Store> };

export function buildIndex(blocks: Block[], stores: Store[]): BlockIndex {
  return { blocks, storeByHost: new Map(stores.map((s) => [s.host, s])) };
}

/** "shopify,woocommerce" -> ["shopify", "woocommerce"]; empty means no filter. */
function values(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

/** One filterable dimension: how to select it and what a block offers it. */
type Dimension = {
  key: string;
  wanted: string[];
  /** Every value this block contributes, for both matching and facet counts. */
  of: (block: Block, store: Store | undefined) => string[];
  /** Dimensions with no sensible facet list (free text) opt out. */
  faceted: boolean;
};

function dimensions(query: WallQuery): Dimension[] {
  const q = query.q?.trim().toLowerCase() ?? "";
  return [
    { key: "page", wanted: values(query.page), faceted: true, of: (b) => [b.pageType] },
    { key: "block", wanted: values(query.block), faceted: true, of: (b) => [b.typeHint] },
    { key: "vp", wanted: values(query.vp), faceted: true, of: (b) => [b.viewport] },
    { key: "platform", wanted: values(query.platform), faceted: true, of: (b) => (b.platform ? [b.platform] : []) },
    { key: "theme", wanted: values(query.theme), faceted: true, of: (b) => (b.theme ? [b.theme] : []) },
    { key: "app", wanted: values(query.app), faceted: true, of: (b) => b.apps },
    { key: "host", wanted: values(query.host), faceted: true, of: (b) => [b.host] },
    { key: "industry", wanted: values(query.industry), faceted: true, of: (_b, s) => (s ? [s.industry] : []) },
    { key: "country", wanted: values(query.country), faceted: true, of: (_b, s) => (s?.country ? [s.country] : []) },
    { key: "video", wanted: values(query.video), faceted: true, of: (b) => [b.videos > 0 ? "yes" : "no"] },
    {
      key: "color",
      wanted: values(query.color),
      faceted: true,
      of: (b) => {
        const bucket = bucketFor(b.bg);
        return bucket ? [bucket] : [];
      },
    },
    {
      key: "q",
      wanted: q ? [q] : [],
      faceted: false,
      // Matching happens in passes() below; the values here are what we search.
      of: (b) => [b.headline ?? "", b.text, b.typeHint],
    },
  ];
}

function passes(dimension: Dimension, block: Block, store: Store | undefined): boolean {
  if (dimension.wanted.length === 0) return true;
  const offered = dimension.of(block, store);
  if (dimension.key === "q") {
    const needle = dimension.wanted[0];
    return offered.some((text) => text.toLowerCase().includes(needle));
  }
  return offered.some((value) => dimension.wanted.includes(value));
}

/**
 * Run a query. Facet counts for a dimension ignore that dimension's own
 * selection, so ticking one platform still shows how many blocks the other
 * platforms would add. One pass over the set does both jobs: a block is in the
 * result when it clears every dimension, and it counts toward dimension D's
 * facets when the only dimension it fails is D.
 */
export function queryBlocks(index: BlockIndex, query: WallQuery = {}, options: { facets?: boolean } = {}): WallResponse {
  // Facets are the expensive half and they do not change as you page through a
  // fixed result set, so the second page onwards can skip them.
  const withFacets = options.facets !== false;
  const dims = dimensions(query);
  const all = (1 << dims.length) - 1;
  const facetTallies = dims.map(() => new Map<string, number>());
  const nearMissTallies = new Array<number>(dims.length).fill(0);

  const matched: Block[] = [];
  for (const block of index.blocks) {
    const store = index.storeByHost.get(block.host);

    let mask = 0;
    for (let d = 0; d < dims.length; d += 1) {
      if (passes(dims[d], block, store)) mask |= 1 << d;
    }

    if (mask === all) matched.push(block);

    for (let d = 0; d < dims.length; d += 1) {
      const bit = 1 << d;
      // Clears everything else, so this block is either a match or one filter away.
      if ((mask | bit) !== all) continue;

      // Failed only this dimension, so dropping it alone would reveal the block.
      if (!(mask & bit) && dims[d].wanted.length > 0) nearMissTallies[d] += 1;

      if (!withFacets || !dims[d].faceted) continue;
      const tally = facetTallies[d];
      for (const value of dims[d].of(block, store)) {
        tally.set(value, (tally.get(value) ?? 0) + 1);
      }
    }
  }

  const facets: Record<string, { value: string; count: number }[]> = {};
  for (let d = 0; withFacets && d < dims.length; d += 1) {
    if (!dims[d].faceted) continue;
    facets[dims[d].key] = [...facetTallies[d]]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
  }

  const limit = Math.min(MAX_LIMIT, Math.max(1, query.limit ?? DEFAULT_LIMIT));
  const offset = Math.max(0, Number(query.cursor) || 0);
  const items = matched.slice(offset, offset + limit);
  const next = offset + items.length;

  const nearMiss: Record<string, number> = {};
  for (let d = 0; d < dims.length; d += 1) {
    if (nearMissTallies[d] > 0) nearMiss[dims[d].key] = nearMissTallies[d];
  }

  const response: WallResponse = { items, nextCursor: next < matched.length ? String(next) : null, total: matched.length, nearMiss };
  return withFacets ? { ...response, facets } : response;
}
