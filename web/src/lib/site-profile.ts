// A site's profile (SEC-19): the store, every page captured, and when.
//
// Two sources, one shape. With the platform's API up, GET /api/sites/[host]
// answers with a SiteProfile (contract v1) and the pages carry full-page
// screenshots. Until then the profile is assembled from the loaded blocks,
// which is all the sample has: the blocks of a page, stacked, are the page, so
// they double as its thumbnail.
//
// Pure: no React, no DOM, no fetch.

import type { Block } from "@/contracts/block";
import type { Store } from "@/contracts/store";
import type { SiteProfile } from "@/contracts/api";
import type { BlockIndex } from "./block-source.ts";
import { capturedAtOf, pageKeyOf } from "./block-detail.ts";
import { isMock } from "./mock-blocks.ts";

export type ProfilePage = {
  key: string;
  url: string;
  type: string;
  title: string | null;
  /** Null when the source does not record it, as the sample does not. */
  capturedAt: string | null;
  /** Full-page screenshots, when the source has them (the API does). */
  desktop: string | null;
  mobile: string | null;
  blockCount: number;
  /** The page's blocks in page order, when the source has them (the sample does). */
  desktopBlocks: Block[];
  mobileBlocks: Block[];
};

export type SiteView = {
  store: Store;
  /** False when the host is not in the validated store list and the store was pieced together from its blocks. */
  listed: boolean;
  pages: ProfilePage[];
  captures: { capturedAt: string | null; pages: number }[];
};

/** Home first, then the way a shopper walks a store. */
const PAGE_ORDER = ["home", "collection", "product", "cart", "checkout", "page", "blog", "article", "other"];

function byPageOrder(a: { type: string; url: string }, b: { type: string; url: string }): number {
  const rank = (t: string) => {
    const i = PAGE_ORDER.indexOf(t);
    return i < 0 ? PAGE_ORDER.length : i;
  };
  return rank(a.type) - rank(b.type) || a.url.localeCompare(b.url);
}

/** Index within the page, from the id's last segment. */
function position(block: Block): number {
  return Number(block.id.split("/").pop()) || 0;
}

/** The values in `lists`, commonest first, ties in first-seen order. */
function byFrequency(lists: string[][]): string[] {
  const counts = new Map<string, number>();
  for (const list of lists) for (const value of list) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([value]) => value);
}

/**
 * "Your Shopping Cart – My ZOO Box" -> "My ZOO Box". Shopify titles end with
 * the shop name after a dash, and the home page's title is often only that.
 */
function brandFrom(blocks: Block[], host: string): string {
  const home = blocks.find((b) => b.pageType === "home" && b.pageTitle);
  if (home?.pageTitle && !/[–|-]/.test(home.pageTitle)) return home.pageTitle.trim();
  const tails = byFrequency(
    blocks.map((b) => {
      const parts = b.pageTitle?.split(/\s[–|-]\s/) ?? [];
      return parts.length > 1 ? [parts[parts.length - 1].trim()] : [];
    }),
  );
  return tails[0] ?? home?.pageTitle ?? host;
}

/**
 * A Store for a host the validated list does not have, from what its blocks
 * carry. Only what the blocks actually say: no industry, country or rank.
 */
export function storeFromBlocks(host: string, blocks: Block[]): Store {
  return {
    n: 0,
    host,
    brand: brandFrom(blocks, host),
    title: blocks.find((b) => b.pageType === "home")?.pageTitle ?? null,
    platform: byFrequency(blocks.map((b) => (b.platform ? [b.platform] : [])))[0] ?? null,
    builder: null,
    theme: byFrequency(blocks.map((b) => (b.theme ? [b.theme] : [])))[0] ?? null,
    themeVersion: null,
    currency: null,
    country: null,
    industry: "other",
    industryScore: 0,
    // Apps are detected per page, so the site's list is the union.
    apps: byFrequency(blocks.map((b) => b.apps)),
    collections: null,
    rank: null,
    mentions: 0,
    sources: [],
    validatedAt: null,
  };
}

/** One store's blocks as its pages, each with its blocks in page order, home first. */
export function pagesFromBlocks(blocks: Block[]): ProfilePage[] {
  const pages = new Map<string, Block[]>();
  for (const block of blocks) {
    const key = pageKeyOf(block);
    const list = pages.get(key);
    if (list) list.push(block);
    else pages.set(key, [block]);
  }

  const profilePages: ProfilePage[] = [...pages].map(([key, list]) => {
    const inOrder = [...list].sort((a, b) => position(a) - position(b));
    const first = inOrder[0];
    const dates = list.map(capturedAtOf).filter((d): d is string => Boolean(d)).sort();
    return {
      key,
      url: first.pageUrl,
      type: first.pageType,
      title: first.pageTitle,
      capturedAt: dates.at(-1) ?? null,
      desktop: null,
      mobile: null,
      blockCount: list.length,
      desktopBlocks: inOrder.filter((b) => b.viewport === "desktop"),
      mobileBlocks: inOrder.filter((b) => b.viewport === "mobile"),
    };
  });
  return profilePages.sort(byPageOrder);
}

/** The profile from the loaded blocks, or null when the host is unknown to both lists. */
export function profileFromIndex(index: BlockIndex, host: string): SiteView | null {
  // Only real captures: a mock block wears this store's name over another
  // store's screenshot (see mock-blocks.ts).
  const blocks = index.blocks.filter((b) => b.host === host && !isMock(b));
  const listed = index.storeByHost.get(host);
  if (!listed && blocks.length === 0) return null;

  const profilePages = pagesFromBlocks(blocks);
  return {
    store: listed ?? storeFromBlocks(host, blocks),
    listed: Boolean(listed),
    pages: profilePages,
    captures: capturesOf(profilePages),
  };
}

/** One entry per capture date, newest first; pages with no date share one entry. */
function capturesOf(pages: ProfilePage[]): SiteView["captures"] {
  const counts = new Map<string | null, number>();
  for (const page of pages) counts.set(page.capturedAt, (counts.get(page.capturedAt) ?? 0) + 1);
  return [...counts]
    .map(([capturedAt, n]) => ({ capturedAt, pages: n }))
    .sort((a, b) => (b.capturedAt ?? "").localeCompare(a.capturedAt ?? ""));
}

/** The API's SiteProfile in the view's shape. Blocks stay empty: the API pages carry full-page shots instead. */
export function profileFromApi(profile: SiteProfile): SiteView {
  return { store: profile.store, listed: true, pages: pagesFromApi(profile.pages), captures: profile.captures };
}

function pagesFromApi(apiPages: SiteProfile["pages"]): ProfilePage[] {
  const pages: ProfilePage[] = apiPages.map((p) => ({
    key: p.url,
    url: p.url,
    type: p.type,
    title: p.title,
    capturedAt: p.capturedAt,
    desktop: p.desktop,
    mobile: p.mobile,
    blockCount: p.blocks,
    desktopBlocks: [],
    mobileBlocks: [],
  }));
  pages.sort(byPageOrder);
  return pages;
}

/** GET /api/sites: a store and its pages at their latest capture, the profile without its history. */
export type SiteSummary = Omit<SiteProfile, "captures">;

/** A store's pages from GET /api/sites, in page order, for the Sites grid and the Flows index. */
export function summaryPages(summary: SiteSummary): ProfilePage[] {
  return pagesFromApi(summary.pages);
}

/** A Sites card from GET /api/sites. The cover is the home page's full-page shots (another page when there is no home). */
export function siteCardFromApi(summary: SiteSummary): SiteCard {
  const pages = summaryPages(summary);
  const coverPage = pages.find((p) => p.type === "home") ?? pages[0];
  return {
    store: summary.store,
    listed: true,
    pageCount: pages.length,
    blockCount: pages.reduce((n, p) => n + p.blockCount, 0),
    cover: coverPage ? { desktop: [], mobile: [], shots: { desktop: coverPage.desktop, mobile: coverPage.mobile } } : null,
  };
}

/** One store on the Sites grid: who it is and what its cover shows. */
export type SiteCard = {
  store: Store;
  listed: boolean;
  pageCount: number;
  blockCount: number;
  /**
   * The home page's blocks in order (another page when there is no home), or
   * null when nothing is captured. From the API, its full-page shots instead.
   */
  cover: { desktop: Block[]; mobile: Block[]; shots?: { desktop: string | null; mobile: string | null } } | null;
};

/**
 * Every store for the Sites grid: the validated list plus any host captured
 * outside it. One pass over the blocks, not one per store, so it stays cheap
 * at capture scale.
 */
export function siteCards(index: BlockIndex): SiteCard[] {
  const byHost = new Map<string, Map<string, Block[]>>();
  for (const block of index.blocks) {
    if (isMock(block)) continue;
    let pages = byHost.get(block.host);
    if (!pages) byHost.set(block.host, (pages = new Map()));
    const key = pageKeyOf(block);
    const list = pages.get(key);
    if (list) list.push(block);
    else pages.set(key, [block]);
  }

  const cardFor = (store: Store, listed: boolean): SiteCard => {
    const pages = byHost.get(store.host);
    if (!pages) return { store, listed, pageCount: 0, blockCount: 0, cover: null };
    const lists = [...pages.values()];
    const coverPage = lists.find((l) => l[0].pageType === "home") ?? [...lists].sort((a, b) => byPageOrder(
      { type: a[0].pageType, url: a[0].pageUrl },
      { type: b[0].pageType, url: b[0].pageUrl },
    ))[0];
    const inOrder = [...coverPage].sort((a, b) => position(a) - position(b));
    return {
      store,
      listed,
      pageCount: pages.size,
      blockCount: lists.reduce((n, l) => n + l.length, 0),
      cover: { desktop: inOrder.filter((b) => b.viewport === "desktop"), mobile: inOrder.filter((b) => b.viewport === "mobile") },
    };
  };

  const cards = [...index.storeByHost.values()].map((store) => cardFor(store, true));
  for (const [host, pages] of byHost) {
    if (index.storeByHost.has(host)) continue;
    cards.push(cardFor(storeFromBlocks(host, [...pages.values()].flat()), false));
  }
  return cards;
}
