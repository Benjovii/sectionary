// CONTRACT v1 · the HTTP API between the platform (Lane B) and the web app
// (Lane C). Until the endpoints exist the web app reads /sample/*.json, which
// carries the same item shapes. See docs/CONTRACTS.md for the rules.

import type { Block, Viewport } from "./block";
import type { Store } from "./store";

export const CONTRACT_VERSION = 1;

/** Cursor pagination everywhere: opaque cursor in, next cursor (or null) out. */
export type Page<T> = { items: T[]; nextCursor: string | null; total: number };

/** GET /api/blocks · every filter is optional and multi-value filters are comma-separated. */
export type BlocksQuery = {
  page?: string;
  block?: string;
  vp?: Viewport;
  platform?: string;
  theme?: string;
  app?: string;
  industry?: string;
  country?: string;
  host?: string;
  q?: string;
  cursor?: string;
  /** Default 60, maximum 200. */
  limit?: number;
};
export type BlocksResponse = Page<Block> & { facets?: Record<string, { value: string; count: number }[]> };

/** GET /api/stores */
export type StoresQuery = { platform?: string; industry?: string; country?: string; q?: string; sort?: "rank" | "brand" | "platform" | "industry"; cursor?: string; limit?: number };
export type StoresResponse = Page<Store>;

/** GET /api/sites/[host] */
export type SiteProfile = {
  store: Store;
  pages: { url: string; type: string; title: string | null; capturedAt: string; desktop: string | null; mobile: string | null; blocks: number }[];
  captures: { capturedAt: string; pages: number }[];
};

/** Every error response, any endpoint. */
export type ApiError = { error: string; code?: string };
