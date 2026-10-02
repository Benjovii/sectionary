// A store's flow (SEC-20): its captured pages in the order a shopper walks a
// store, home to checkout.
//
// Complete means home, collection and product are all there. Cart counts when
// it was captured, which is rare: Shopify's default robots.txt keeps bots out
// of /cart and the crawler obeys it. Checkout is never captured at all (see
// docs/bot-page.md), so it is always a gap, and the view says why.
//
// Pure: no React, no DOM, no fetch. Relative imports, so
// `npm run flow-check` runs it under Node's type stripping.

import type { Block } from "@/contracts/block";
import type { Store } from "@/contracts/store";
import type { BlockIndex } from "./block-source.ts";
import { isMock } from "./mock-blocks.ts";
import { pagesFromBlocks, storeFromBlocks, summaryPages, type ProfilePage, type SiteSummary } from "./site-profile.ts";

export const FLOW_STEPS = ["home", "collection", "product", "cart", "checkout"] as const;
export type FlowStepType = (typeof FLOW_STEPS)[number];

/** What a flow needs to count as complete toward the SEC-20 target. */
export const REQUIRED_STEPS: readonly FlowStepType[] = ["home", "collection", "product"];

export type FlowStep = {
  type: FlowStepType;
  /** The captured pages of this type, by URL. Empty for a gap. */
  pages: ProfilePage[];
  /** Why a step is empty: "never" is policy (checkout), "missing" is this store. Null when captured. */
  gap: "never" | "missing" | null;
};

export type Flow = {
  /** Always the five steps, in FLOW_STEPS order. */
  steps: FlowStep[];
  complete: boolean;
  /** Required steps not captured. */
  missing: FlowStepType[];
  /** Steps with at least one page. */
  captured: number;
};

export type FlowSummary = { store: Store; listed: boolean; flow: Flow };

/** A page counts when there is something to show: its blocks, or a full-page screenshot. */
const hasContent = (p: ProfilePage) => Boolean(p.desktop || p.mobile || p.desktopBlocks.length || p.mobileBlocks.length);

export function flowOf(pages: ProfilePage[]): Flow {
  const steps = FLOW_STEPS.map((type): FlowStep => {
    const list = pages.filter((p) => p.type === type && hasContent(p)).sort((a, b) => a.url.localeCompare(b.url));
    return { type, pages: list, gap: list.length ? null : type === "checkout" ? "never" : "missing" };
  });
  const missing = REQUIRED_STEPS.filter((type) => steps.find((s) => s.type === type)!.pages.length === 0);
  return { steps, complete: missing.length === 0, missing, captured: steps.filter((s) => s.pages.length > 0).length };
}

/**
 * Every captured store's flow, in one pass over the blocks. Stores with no
 * real capture are left out: they have no flow to show. Complete flows first,
 * then the most steps, then traffic rank, then name.
 */
export function flowSummaries(index: BlockIndex): FlowSummary[] {
  const byHost = new Map<string, Block[]>();
  for (const block of index.blocks) {
    if (isMock(block)) continue;
    const list = byHost.get(block.host);
    if (list) list.push(block);
    else byHost.set(block.host, [block]);
  }

  const summaries: FlowSummary[] = [];
  for (const [host, blocks] of byHost) {
    const listed = index.storeByHost.get(host);
    summaries.push({ store: listed ?? storeFromBlocks(host, blocks), listed: Boolean(listed), flow: flowOf(pagesFromBlocks(blocks)) });
  }
  return summaries.sort(byFlow);
}

/** The same list from GET /api/sites (SEC-47): every store with a capture, in the same order. */
export function flowSummariesFromApi(sites: SiteSummary[]): FlowSummary[] {
  return sites
    .filter((site) => site.pages.length > 0)
    .map((site) => ({ store: site.store, listed: true, flow: flowOf(summaryPages(site)) }))
    .sort(byFlow);
}

/** Complete flows first, then the most steps, then traffic rank, then name. */
function byFlow(a: FlowSummary, b: FlowSummary): number {
  const rank = (s: FlowSummary) => s.store.rank ?? Number.POSITIVE_INFINITY;
  return (
    Number(b.flow.complete) - Number(a.flow.complete) ||
    b.flow.captured - a.flow.captured ||
    rank(a) - rank(b) ||
    a.store.brand.localeCompare(b.store.brand)
  );
}

/** The numbers the SEC-20 Done when is read from. */
export function flowCounts(summaries: FlowSummary[]): { complete: number; withCart: number; captured: number } {
  const complete = summaries.filter((s) => s.flow.complete);
  return {
    complete: complete.length,
    withCart: complete.filter((s) => s.flow.steps[FLOW_STEPS.indexOf("cart")].pages.length > 0).length,
    captured: summaries.length,
  };
}

export type Viewport = "desktop" | "mobile";

/** What to draw for one page in one viewport. */
export type PageView = {
  viewport: Viewport;
  /** A full-page screenshot (API source), or null when the page is its blocks. */
  full: string | null;
  blocks: Block[];
  /** Height over width of the whole page. Unknown, so infinite, for a full screenshot. */
  ratio: number;
  /** True when the wanted viewport had nothing and this is the other one. */
  fallback: boolean;
};

/** The page in the wanted viewport, or in the other when that is all there is. Null when neither has anything. */
export function pageView(page: ProfilePage, want: Viewport): PageView | null {
  const other: Viewport = want === "desktop" ? "mobile" : "desktop";
  for (const viewport of [want, other]) {
    const full = viewport === "desktop" ? page.desktop : page.mobile;
    const blocks = viewport === "desktop" ? page.desktopBlocks : page.mobileBlocks;
    if (!full && blocks.length === 0) continue;
    const ratio = full ? Number.POSITIVE_INFINITY : blocks.reduce((sum, b) => sum + b.h / b.w, 0);
    return { viewport, full, blocks, ratio, fallback: viewport !== want };
  }
  return null;
}

/** A leftover thinner than this (height over width) is not worth a link: at 340px it is under 7px. */
const SLIVER = 0.02;

/**
 * The blocks of a page cut at `cap` (height over width), or all of them when
 * cap is null. Blocks below the cap are dropped and the one crossing it is
 * cut to fit, so no link reaches past the frame.
 */
export function cutBlocks(blocks: Block[], cap: number | null): { block: Block; ratio: number; cut: number | null }[] {
  const drawn: { block: Block; ratio: number; cut: number | null }[] = [];
  let used = 0;
  for (const block of blocks) {
    if (cap !== null && cap - used < SLIVER) break;
    const ratio = block.h / block.w;
    drawn.push({ block, ratio, cut: cap !== null && used + ratio > cap ? cap - used : null });
    used += ratio;
  }
  return drawn;
}
