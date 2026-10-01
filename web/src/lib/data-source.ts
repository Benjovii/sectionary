// Where the web app gets its data and its images.
//
// Data: the committed sample JSON by default, which the browser loads whole
// and queries itself. Set NEXT_PUBLIC_BLOCKS_SRC=/api/blocks and
// NEXT_PUBLIC_STORES_SRC=/api/stores (SEC-47) and the app asks the API
// instead, a page at a time, because the full capture is far too big to
// download: the wall sends its query, and the detail view, site profiles and
// Sites covers fetch only the stores they show. Both paths run the same query
// code (lib/block-source.ts), so the same filters return the same blocks.
//
// Images: block screenshots are not in git. In development they load from the
// deployed site, so a fresh clone shows a full wall. If you captured your own
// sample (npm run capture, then node scripts/export-sample.mjs in the repo
// root), set NEXT_PUBLIC_ASSET_BASE= (empty) in web/.env.local to use them.

export const BLOCKS_SRC = process.env.NEXT_PUBLIC_BLOCKS_SRC ?? "/sample/blocks.json";
export const STORES_SRC = process.env.NEXT_PUBLIC_STORES_SRC ?? "/sample/stores.json";

/** True when the blocks come from the API rather than a whole-set JSON file. */
export const BLOCKS_FROM_API = !BLOCKS_SRC.endsWith(".json");

/**
 * Site profiles (SEC-19). Set NEXT_PUBLIC_SITES_SRC=/api/sites to read
 * /api/sites/[host]; unset, a profile is assembled from the loaded blocks.
 */
export const SITES_SRC = process.env.NEXT_PUBLIC_SITES_SRC ?? "";

/**
 * Scale fixture (SEC-46). Unset in normal use. Set NEXT_PUBLIC_MOCK_BLOCKS=30000
 * in web/.env.local to multiply the sample into a capture-sized set in the
 * browser, which is how the wall's virtualisation and the filters get tested
 * before the full capture exists. Nothing extra is downloaded: the expansion
 * runs on the sample JSON the app already fetched.
 */
export const MOCK_BLOCKS = Number(process.env.NEXT_PUBLIC_MOCK_BLOCKS) || 0;

const DEPLOYED = "https://sectionary-pink.vercel.app";
export const ASSET_BASE = process.env.NEXT_PUBLIC_ASSET_BASE ?? (process.env.NODE_ENV === "development" ? DEPLOYED : "");

/** Resolve a block screenshot path against the asset base; absolute URLs pass through. */
export function assetUrl(src: string): string {
  if (/^https?:\/\//.test(src) || !ASSET_BASE) return src;
  return `${ASSET_BASE}${src.startsWith("/") ? "" : "/"}${src}`;
}
