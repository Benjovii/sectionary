// Where the web app gets its data and its images.
//
// Data: the committed sample JSON by default. When the platform's API is up,
// set NEXT_PUBLIC_BLOCKS_SRC=/api/blocks and NEXT_PUBLIC_STORES_SRC=/api/stores
// in web/.env.local and nothing else changes: the item shapes are the contract.
//
// Images: block screenshots are not in git. In development they load from the
// deployed site, so a fresh clone shows a full wall. If you captured your own
// sample (npm run capture, then node scripts/export-sample.mjs in the repo
// root), set NEXT_PUBLIC_ASSET_BASE= (empty) in web/.env.local to use them.

export const BLOCKS_SRC = process.env.NEXT_PUBLIC_BLOCKS_SRC ?? "/sample/blocks.json";
export const STORES_SRC = process.env.NEXT_PUBLIC_STORES_SRC ?? "/sample/stores.json";

const DEPLOYED = "https://sectionary-pink.vercel.app";
export const ASSET_BASE = process.env.NEXT_PUBLIC_ASSET_BASE ?? (process.env.NODE_ENV === "development" ? DEPLOYED : "");

/** Resolve a block screenshot path against the asset base; absolute URLs pass through. */
export function assetUrl(src: string): string {
  if (/^https?:\/\//.test(src) || !ASSET_BASE) return src;
  return `${ASSET_BASE}${src.startsWith("/") ? "" : "/"}${src}`;
}
