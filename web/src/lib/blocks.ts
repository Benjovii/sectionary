/** One captured block, as exported by scripts/export-sample.mjs (and later by the API). */
export type Block = {
  id: string;
  host: string;
  pageType: string;
  pageUrl: string;
  pageTitle: string | null;
  viewport: "desktop" | "mobile";
  typeHint: string;
  headline: string | null;
  bg: string;
  /** CSS pixel size of the block: the image may be 2x on mobile. */
  w: number;
  h: number;
  src: string;
  platform: string | null;
  theme: string | null;
  apps: string[];
  buttons: number;
  images: number;
  videos: number;
  text: string;
};

export type BlockSet = { generatedAt: string; blocks: Block[] };

export const PAGE_TYPE_LABEL: Record<string, string> = {
  home: "Home",
  collection: "Collection",
  product: "Product",
  cart: "Cart",
  page: "Page",
  blog: "Blog",
  article: "Article",
  other: "Other",
};

/** "featured-collection" -> "Featured collection" */
export function labelFor(typeHint: string): string {
  const s = typeHint.replace(/-part$/, "").replace(/[-_]+/g, " ").trim();
  return s ? s[0].toUpperCase() + s.slice(1) : "Block";
}
