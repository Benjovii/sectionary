// Scale fixture for the wall (SEC-46). The 84 captured sample blocks re-hosted
// across the 1,005 validated stores, so the wall's virtualisation and the
// filters can be exercised at the size we expect after the full capture,
// without waiting for the capture.
//
// Varied three ways, as the task asks:
//   hosts   every store in the list is represented, so the host, platform,
//           theme, industry and country filters keep believable distributions
//   types   each store gets its own mix of pages, and each page contributes
//           both viewports, so no filter lands on an empty set
//   sizes   every height is jittered, which is what gives the masonry
//           something to pack and the virtualiser varied rows to measure
//
// Backgrounds vary too, because the colour filter needs them to: see
// BRAND_COLOURS below.
//
// Pure and deterministic: the same inputs and seed always produce the same set,
// so a slow frame is reproducible. No I/O and no value imports, so
// scripts/mock-blocks.mjs can run this file directly under Node type stripping.

import type { Block } from "@/contracts/block";
import type { Store } from "@/contracts/store";

/** Page types in the order a crawl walks them. */
const PAGE_ORDER = ["home", "product", "collection", "cart"] as const;

/** How often a store has each page type. Every store has a home page. */
const PAGE_ODDS: Record<string, number> = { home: 1, product: 0.85, collection: 0.7, cart: 0.45 };

/** Heights move by up to a quarter either way, so the wall never packs a uniform grid. */
const JITTER = 0.25;

/**
 * One representative background per colour bucket (lib/colour.ts). The 84
 * samples all come from one store and carry three distinct backgrounds between
 * them, which is not enough to exercise a colour filter, so each mock store
 * gets a brand colour from this list.
 */
const BRAND_COLOURS = [
  "rgb(255, 255, 255)",
  "rgb(244, 240, 233)",
  "rgb(150, 146, 139)",
  "rgb(58, 54, 48)",
  "rgb(20, 18, 16)",
  "rgb(199, 62, 48)",
  "rgb(232, 133, 58)",
  "rgb(229, 193, 68)",
  "rgb(76, 148, 76)",
  "rgb(63, 163, 160)",
  "rgb(65, 120, 200)",
  "rgb(138, 92, 196)",
  "rgb(212, 92, 150)",
];

/**
 * How often a block keeps the background it was captured with rather than
 * taking its store's brand colour. Most of the web is white or near-white, and
 * the samples already are, so this keeps that shape instead of dealing every
 * bucket equally.
 */
const KEEP_CAPTURED_BACKGROUND = 0.55;

/** mulberry32: small, fast, and stable across machines, which matters for reproducing a slow frame. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A stable URL slug for a store's page, unique within the host. A store has one
 * home and one cart, so those keep their plain names on the first pass; a later
 * pass over the store list suffixes them, which reads as a second capture of
 * the same site and keeps block ids unique.
 */
function slugFor(pageType: string, nth: number, round: number): string {
  const base = pageType === "home" || pageType === "cart" ? pageType : `${pageType}s-${nth.toString(36)}`;
  return round === 0 ? base : `${base}-${round + 1}`;
}

type Pools = { desktop: Block[]; mobile: Block[] };

/** Sample blocks grouped by page type, then split by viewport. */
function poolsByPageType(samples: Block[]): Map<string, Pools> {
  const map = new Map<string, Pools>();
  for (const sample of samples) {
    let pools = map.get(sample.pageType);
    if (!pools) {
      pools = { desktop: [], mobile: [] };
      map.set(sample.pageType, pools);
    }
    pools[sample.viewport].push(sample);
  }
  return map;
}

/**
 * Multiply `samples` into `target` blocks spread across `stores`.
 *
 * Every generated block keeps its sample's screenshot, headline and copy, so
 * the wall shows real images and the search filter has real text to match. Only
 * the identity (host, page, size, tech stack) is swapped for the store's.
 */
export function expandBlocks(samples: Block[], stores: Store[], target: number, seed = 1): Block[] {
  if (samples.length === 0 || stores.length === 0 || target <= 0) return [];

  const pools = poolsByPageType(samples);

  // Spread the set evenly over the whole store list rather than capturing the
  // first few stores exhaustively. A budget of target/stores lands near 30
  // blocks per store, which is what the full capture projects: 1,005 stores,
  // about 60,000 blocks over six pages each.
  const budget = Math.max(2, Math.ceil(target / stores.length));

  const out: Block[] = [];
  for (let round = 0; out.length < target; round += 1) {
    for (let s = 0; s < stores.length && out.length < target; s += 1) {
      const store = stores[s];
      const random = rng(seed + round * 7919 + s);
      const brand = BRAND_COLOURS[s % BRAND_COLOURS.length];

      const pages = PAGE_ORDER.filter((pageType) => random() <= (PAGE_ODDS[pageType] ?? 0));
      // Split the store's budget across its pages, so a store with a home, a
      // product and a collection page contributes all three rather than
      // spending everything on the page that happens to come first.
      const perPage = Math.max(2, Math.floor(budget / Math.max(1, pages.length)));

      for (let p = 0; p < pages.length && out.length < target; p += 1) {
        const pageType = pages[p];
        const pagePools = pools.get(pageType);
        if (!pagePools) continue;

        const slug = slugFor(pageType, round * stores.length + s + p + 1, round);
        const pageUrl = `https://${store.host}/${slug === "home" ? "" : slug}`;
        // Start at a different point in each pool so stores do not all lead
        // with the same header.
        const offsets = {
          desktop: Math.floor(random() * Math.max(1, pagePools.desktop.length)),
          mobile: Math.floor(random() * Math.max(1, pagePools.mobile.length)),
        };
        const taken = { desktop: 0, mobile: 0 };

        for (let k = 0; k < perPage && out.length < target; k += 1) {
          // Alternate, so every page carries both viewports for the vp filter
          // and for the desktop-beside-mobile detail view later.
          const viewport = k % 2 === 0 ? "desktop" : "mobile";
          const pool = pagePools[viewport];
          const nth = taken[viewport];
          if (pool.length === 0 || nth >= pool.length) continue;
          taken[viewport] += 1;

          const sample = pool[(offsets[viewport] + nth) % pool.length];
          out.push({
            ...sample,
            id: `${store.host}/${slug}/${viewport}/${nth + 1}`,
            host: store.host,
            pageUrl,
            pageTitle: store.title ?? store.brand,
            h: Math.max(60, Math.round(sample.h * (1 - JITTER + random() * JITTER * 2))),
            bg: random() < KEEP_CAPTURED_BACKGROUND ? sample.bg : brand,
            platform: store.platform,
            theme: store.theme,
            apps: store.apps,
          });
        }
      }
    }
  }

  return out.slice(0, target);
}
