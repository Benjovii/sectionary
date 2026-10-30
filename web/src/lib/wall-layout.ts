// Grid layout for the wall, computed rather than measured.
//
// Every card in a row shares its top and bottom edge, and every row is the
// same height: the screenshot is cropped from the top to fit its cell (or, when
// it is shorter than the cell, shown whole on its own background colour). So
// every card's position is known before anything renders, which is what makes
// 30,000 blocks affordable: no DOM measurement, no reflow, no layout thrash.
// Positions are computed once per width change, and each scroll frame only
// asks which rows fall inside the viewport, which is a division.
//
// The row is split into units. Web shows one desktop block per unit. Mobile
// and All halve the units: a mobile block takes one, a desktop block two, so
// in All the phones sit two to a desktop column and every edge still lines up.
//
// Pure: no React, no DOM, so it can be checked from a script.

import type { Block } from "@/contracts/block";

/** Gap between cards, matching the 12px the wall used before it was virtualised. */
export const GAP = 12;

/** Fixed caption height, so the computed height is exact and nothing drifts. */
export const CAPTION_HEIGHT = 32;

/**
 * Height over width of a desktop cell's screenshot. Near the median section
 * (about 0.52), so most fill their cell with little cropped off the bottom.
 */
export const DESKTOP_RATIO = 0.6;

/** Height over width of a mobile cell's screenshot in the Mobile view: phone-shaped. */
export const MOBILE_RATIO = 1.6;

/**
 * How far ahead All looks for a phone to fill a one-unit gap at the end of a
 * row, rather than leaving the gap or stretching a card into it.
 */
const LOOKAHEAD = 24;

/** Which blocks the wall is showing: the Web / Mobile switch above it. */
export type WallMode = "desktop" | "mobile" | "all";

export type Placed = {
  block: Block;
  /** Offsets within the wall, in CSS pixels. */
  x: number;
  y: number;
  width: number;
  height: number;
  /**
   * "cover" crops a screenshot taller than its cell from the top; "contain"
   * shows a shorter one whole, centred on the block's background colour.
   */
  fit: "cover" | "contain";
};

export type Layout = {
  rows: Placed[][];
  /** Card height, caption included. Every row has it. */
  rowHeight: number;
  height: number;
  count: number;
};

/** Desktop column count by width, mirroring the breakpoints the wall has always used. */
export function columnsFor(width: number): number {
  if (width >= 1700) return 5;
  if (width >= 1280) return 4;
  if (width >= 900) return 3;
  if (width >= 560) return 2;
  return 1;
}

/** Lay the blocks out in even rows, in order, computing every position up front. */
export function layOut(blocks: Block[], width: number, mode: WallMode, columns = columnsFor(width)): Layout {
  const units = mode === "desktop" ? columns : columns * 2;
  const unit = Math.max(1, (width - GAP * (units - 1)) / units);
  const columnWidth = Math.max(1, (width - GAP * (columns - 1)) / columns);
  const imageHeight = Math.round(mode === "mobile" ? unit * MOBILE_RATIO : columnWidth * DESKTOP_RATIO);
  const rowHeight = imageHeight + CAPTION_HEIGHT;
  const spanOf = (block: Block) => (mode === "all" && block.viewport !== "mobile" ? 2 : 1);

  const rows: { block: Block; at: number; span: number }[][] = [];
  let row: { block: Block; at: number; span: number }[] = [];
  let used = 0;
  // Phones pulled forward into an earlier row, skipped when the walk reaches them.
  const taken = new Uint8Array(blocks.length);

  const close = () => {
    // A gap the lookahead could not fill goes to the row's last desktop card,
    // which stays a sensible shape a unit wider; a phone would not. The cards
    // after it move along to make room.
    if (used < units && row.length) {
      const wide = row.findLast((c) => c.span > 1) ?? row[row.length - 1];
      wide.span += units - used;
      let at = 0;
      for (const cell of row) {
        cell.at = at;
        at += cell.span;
      }
    }
    rows.push(row);
    row = [];
    used = 0;
  };

  for (let i = 0; i < blocks.length; i += 1) {
    if (taken[i]) continue;
    const span = spanOf(blocks[i]);
    if (used + span > units) {
      for (let j = i + 1; j < Math.min(blocks.length, i + LOOKAHEAD) && used < units; j += 1) {
        if (taken[j] || spanOf(blocks[j]) > units - used) continue;
        taken[j] = 1;
        row.push({ block: blocks[j], at: used, span: 1 });
        used += 1;
      }
      close();
    }
    row.push({ block: blocks[i], at: used, span });
    used += span;
    if (used === units) close();
  }
  // The last row stays as it is: more blocks may yet arrive to fill it.
  if (row.length) rows.push(row);

  const placed = rows.map((cells, r) =>
    cells.map(({ block, at, span }): Placed => {
      const cardWidth = span * unit + (span - 1) * GAP;
      return {
        block,
        x: at * (unit + GAP),
        y: r * (rowHeight + GAP),
        width: cardWidth,
        height: rowHeight,
        fit: block.h / block.w >= imageHeight / cardWidth ? "cover" : "contain",
      };
    }),
  );

  return {
    rows: placed,
    rowHeight,
    height: Math.max(0, placed.length * (rowHeight + GAP) - GAP),
    count: blocks.length,
  };
}

/**
 * The cards intersecting [top, bottom). Every row is the same height, so the
 * rows in view are a division away, independent of how many blocks are loaded.
 */
export function visible(layout: Layout, top: number, bottom: number): Placed[] {
  const stride = layout.rowHeight + GAP;
  const first = Math.max(0, Math.floor(top / stride));
  const last = Math.min(layout.rows.length, Math.ceil(bottom / stride));
  const out: Placed[] = [];
  for (let r = first; r < last; r += 1) out.push(...layout.rows[r]);
  return out;
}
