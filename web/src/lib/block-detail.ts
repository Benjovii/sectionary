// What the block detail view (SEC-18) needs beyond the block itself: the same
// block at the other viewport, blocks like it, and its earlier captures.
//
// All three are lookups over the loaded set, answered from maps built once per
// index, so opening a block at 30,000 never walks the whole set more than once.
// When the API grows endpoints for these (M3, Lane B) the functions keep their
// signatures and change source.
//
// Pure: no React, no DOM.

import type { Block, Viewport } from "@/contracts/block";
import type { BlockIndex } from "./block-source.ts";
import { bucketFor } from "./colour.ts";

/** "product-grid-part" and "product-grid" are the same kind of block. */
export function baseType(typeHint: string): string {
  return typeHint.replace(/-part$/, "");
}

/**
 * The page a block belongs to: its id without `/<viewport>/<index>`. Both
 * viewports of one page share it, which is what pairs them. Ids from the API
 * are database UUIDs and say nothing about the page, so those blocks key on
 * host and page URL instead.
 */
export function pageKeyOf(block: Block): string {
  const parts = block.id.split("/");
  return parts.length > 2 ? parts.slice(0, -2).join("/") : `${block.host} ${block.pageUrl}`;
}

/**
 * When the block was captured, if the source says. Contract v1 has no such
 * field; the capture manifest does (`page.capturedAt`) and the importer keeps
 * every capture, so Block is expected to gain it. Read defensively until then,
 * the same way blurOf reads the placeholder.
 */
export function capturedAtOf(block: Block): string | undefined {
  return (block as Block & { capturedAt?: string }).capturedAt;
}

export type DetailIndex = {
  byId: Map<string, Block>;
  /** Every block of a page, both viewports, in capture order. */
  byPage: Map<string, Block[]>;
  /** Every block of a base type and viewport, for "similar". */
  byType: Map<string, Block[]>;
  /** Every capture of one block id, oldest first. */
  captures: Map<string, Block[]>;
};

const cache = new WeakMap<BlockIndex, DetailIndex>();

function push<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

export function detailIndex(index: BlockIndex): DetailIndex {
  const hit = cache.get(index);
  if (hit) return hit;

  const built: DetailIndex = { byId: new Map(), byPage: new Map(), byType: new Map(), captures: new Map() };
  for (const block of index.blocks) {
    push(built.captures, block.id, block);
    // The newest capture of an id is the one the view shows by default.
    const current = built.byId.get(block.id);
    if (current && (capturedAtOf(current) ?? "") > (capturedAtOf(block) ?? "")) continue;
    built.byId.set(block.id, block);
  }
  for (const block of built.byId.values()) {
    push(built.byPage, pageKeyOf(block), block);
    push(built.byType, `${block.viewport}:${baseType(block.typeHint)}`, block);
  }
  for (const list of built.captures.values()) {
    if (list.length > 1) list.sort((a, b) => (capturedAtOf(a) ?? "").localeCompare(capturedAtOf(b) ?? ""));
  }

  cache.set(index, built);
  return built;
}

const other = (viewport: Viewport): Viewport => (viewport === "desktop" ? "mobile" : "desktop");

/**
 * The same block at the other viewport, or null when the page has no match.
 *
 * Segmentation runs per viewport, so index 3 on desktop is not always index 3
 * on mobile: a section can split in two on a phone. What does line up is the
 * order of blocks of one type, so the second product grid on desktop pairs
 * with the second product grid on mobile. Returning nothing beats pairing a
 * hero with a footer.
 */
export function counterpartOf(detail: DetailIndex, block: Block): Block | null {
  const page = detail.byPage.get(pageKeyOf(block)) ?? [];
  const type = baseType(block.typeHint);
  const mine = page.filter((b) => b.viewport === block.viewport && baseType(b.typeHint) === type);
  const theirs = page.filter((b) => b.viewport === other(block.viewport) && baseType(b.typeHint) === type);
  if (theirs.length === 0) return null;
  const ordinal = Math.max(0, mine.findIndex((b) => b.id === block.id));
  return theirs[Math.min(ordinal, theirs.length - 1)];
}

/**
 * Blocks like this one from other stores: the same kind of block at the same
 * viewport, ranked by what a designer skimming for alternatives would notice
 * first, which is colour, then the kind of page, then the platform, then shape.
 * One per store, so a single store's twenty product pages cannot fill the row.
 */
export function similarTo(detail: DetailIndex, block: Block, limit = 12): Block[] {
  const pool = detail.byType.get(`${block.viewport}:${baseType(block.typeHint)}`) ?? [];
  const bucket = bucketFor(block.bg);
  const ratio = block.h / block.w;

  const scored: { block: Block; score: number }[] = [];
  for (const candidate of pool) {
    if (candidate.host === block.host) continue;
    let score = 0;
    if (bucket && bucketFor(candidate.bg) === bucket) score += 4;
    if (candidate.pageType === block.pageType) score += 2;
    if (candidate.platform && candidate.platform === block.platform) score += 1;
    // Up to one point for shape: 1 when the aspect ratios match, 0 at double.
    score += Math.max(0, 1 - Math.abs(Math.log2(candidate.h / candidate.w / ratio)));
    scored.push({ block: candidate, score });
  }
  scored.sort((a, b) => b.score - a.score || a.block.id.localeCompare(b.block.id));

  const out: Block[] = [];
  const hosts = new Set<string>();
  for (const { block: candidate } of scored) {
    if (hosts.has(candidate.host)) continue;
    hosts.add(candidate.host);
    out.push(candidate);
    if (out.length === limit) break;
  }
  return out;
}

/** Every capture of this block, oldest first. One entry until recapture (SEC-26) lands. */
export function capturesOf(detail: DetailIndex, block: Block): Block[] {
  return detail.captures.get(block.id) ?? [block];
}
