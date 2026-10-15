// The Block shape is a cross-lane contract: it lives in src/contracts.
import type { Block } from "@/contracts/block";
export type { Block, BlockSet } from "@/contracts/block";

export const PAGE_TYPE_LABEL: Record<string, string> = {
  home: "Home",
  collection: "Collection",
  product: "Product",
  checkout: "Checkout",
  page: "Page",
  blog: "Blog",
  article: "Article",
  other: "Other",
};

/**
 * Cart blocks: Sectionary does not offer them, so the site never shows them.
 * Every block on a cart page, and every block whose type is a cart
 * ("cart-items", "main-cart", "cart-drawer") wherever it was captured. An
 * add-to-cart button belongs to a product page, not a cart. The API applies
 * the same rule in SQL (CART in server/blocks.ts).
 */
export function isCart(block: Pick<Block, "pageType" | "typeHint">): boolean {
  return block.pageType === "cart" || (/cart($|[^a-z]|items)/i.test(block.typeHint) && !/add-to-cart/i.test(block.typeHint));
}

/**
 * What makes two blocks the same screenshot: a store's header or footer is
 * captured on every page, so the same shot recurs once per page. Same store,
 * viewport, type, size, background and text. The API applies the same rule in
 * SQL (SHOWN in server/blocks.ts).
 */
export function shotKey(block: Block): string {
  return [block.host, block.viewport, block.typeHint, block.w, block.h, block.bg, block.text ?? ""].join("\u0000");
}

/** Pages in the order a visitor meets them: of a repeated shot, the copy from the earliest is the one kept. */
const PAGE_RANK = ["home", "collection", "product"];
const pageRank = (b: Block) => (PAGE_RANK.indexOf(b.pageType) + PAGE_RANK.length + 1) % (PAGE_RANK.length + 1);

/** `blocks` without cart blocks and with one block per screenshot, in their original order. */
export function shownBlocks(blocks: Block[]): Block[] {
  const keep = new Map<string, Block>();
  for (const b of blocks) {
    if (isCart(b)) continue;
    const key = shotKey(b), kept = keep.get(key);
    if (!kept || pageRank(b) < pageRank(kept) || (pageRank(b) === pageRank(kept) && b.pageUrl < kept.pageUrl)) keep.set(key, b);
  }
  const shown = new Set(keep.values());
  return blocks.filter((b) => shown.has(b));
}

/** "featured-collection" -> "Featured collection" */
export function labelFor(typeHint: string): string {
  const s = typeHint.replace(/-part$/, "").replace(/[-_]+/g, " ").trim();
  return s ? s[0].toUpperCase() + s.slice(1) : "Block";
}

/**
 * The low-quality placeholder for a block, if there is one.
 *
 * Contract v1 gives the wall one colour signal, `bg`, which is what the card
 * paints while the screenshot loads. SEC-9 (Lane A) is due to put real blur
 * placeholders in object storage alongside the WebP and the thumbnails; when
 * `Block` gains that field this reads it and the cards need no change. Until
 * then it returns undefined and the background colour does the job.
 */
export function blurOf(block: Block): string | undefined {
  return (block as Block & { blur?: string }).blur;
}
