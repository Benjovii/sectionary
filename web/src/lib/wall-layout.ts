// Masonry layout for the wall, computed rather than measured.
//
// The contract guarantees w and h on every block ("the wall reserves the
// block's aspect ratio before the image loads"), so every card's height is
// known before anything renders. That is what makes 30,000 blocks affordable:
// no DOM measurement, no reflow, no layout thrash. Positions are computed once
// per width change, and each scroll frame only asks which cards fall inside the
// viewport, which is a binary search per column.
//
// Pure: no React, no DOM, so it can be checked from a script.

import type { Block } from "@/contracts/block";

/** Gap between cards, matching the 12px the wall used before it was virtualised. */
export const GAP = 12;

/** Fixed caption height, so the computed height is exact and nothing drifts. */
export const CAPTION_HEIGHT = 32;

/** A mobile screenshot stops widening here, as it did in the original card. */
export const MOBILE_MAX_WIDTH = 300;

export type Placed = {
  block: Block;
  /** Offsets within the wall, in CSS pixels. */
  x: number;
  y: number;
  /** Width of the slot. A mobile card is centred inside it, see cardWidth. */
  width: number;
  cardWidth: number;
  height: number;
};

export type Layout = {
  columns: Placed[][];
  columnWidth: number;
  height: number;
  count: number;
};

/** Column count by width, mirroring the breakpoints the wall has always used. */
export function columnsFor(width: number): number {
  if (width >= 1700) return 5;
  if (width >= 1280) return 4;
  if (width >= 900) return 3;
  if (width >= 560) return 2;
  return 1;
}

/** Pack blocks into the shortest column, computing every position up front. */
export function layOut(blocks: Block[], width: number, columns = columnsFor(width)): Layout {
  const columnWidth = Math.max(1, (width - GAP * (columns - 1)) / columns);
  const placed: Placed[][] = Array.from({ length: columns }, () => []);
  const heights = new Array<number>(columns).fill(0);

  for (const block of blocks) {
    // Shortest column first; ties go left, which keeps the packing stable.
    let column = 0;
    for (let c = 1; c < columns; c += 1) {
      if (heights[c] < heights[column]) column = c;
    }

    const cardWidth = block.viewport === "mobile" ? Math.min(columnWidth, MOBILE_MAX_WIDTH) : columnWidth;
    const imageHeight = (block.h / block.w) * cardWidth;
    const height = Math.round(imageHeight + CAPTION_HEIGHT);

    placed[column].push({
      block,
      x: column * (columnWidth + GAP),
      y: heights[column],
      width: columnWidth,
      cardWidth,
      height,
    });
    heights[column] += height + GAP;
  }

  return {
    columns: placed,
    columnWidth,
    height: Math.max(0, Math.max(...heights, 0) - GAP),
    count: blocks.length,
  };
}

/** First index in a column whose card still reaches past `top`. */
function firstAfter(column: Placed[], top: number): number {
  let low = 0;
  let high = column.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (column[mid].y + column[mid].height > top) high = mid;
    else low = mid + 1;
  }
  return low;
}

/**
 * The cards intersecting [top, bottom). Each column is sorted by y, so this is
 * a binary search plus a short walk, independent of how many blocks are loaded.
 */
export function visible(layout: Layout, top: number, bottom: number): Placed[] {
  const out: Placed[] = [];
  for (const column of layout.columns) {
    for (let i = firstAfter(column, top); i < column.length && column[i].y < bottom; i += 1) {
      out.push(column[i]);
    }
  }
  return out;
}
