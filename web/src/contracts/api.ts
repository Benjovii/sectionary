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

/**
 * Boards (additive, M3). Until accounts exist a board is owned by whoever holds
 * its edit token: POST /api/boards returns it once, and every write sends it as
 * the `x-board-token` header. `shareSlug` is the public read-only link
 * (/b/<slug>), live while `shared` is true.
 */
export type BoardItem = { blockId: string; note: string | null; position: number; block: Block | null };
export type Board = {
  id: string;
  name: string;
  description: string | null;
  shareSlug: string;
  shared: boolean;
  createdAt: string;
  updatedAt: string;
  items: BoardItem[];
};
/** POST /api/boards body. The response is BoardCreated (201). */
export type BoardCreate = { name: string; description?: string | null };
export type BoardCreated = { board: Board; token: string };
/** PATCH /api/boards/[id]. `order` is the complete list of block ids in their new order. */
export type BoardPatch = { name?: string; description?: string | null; shared?: boolean; order?: string[] };
/** POST /api/boards/[id]/items adds a block (idempotent); PATCH /api/boards/[id]/items/[blockId] sets its note. */
export type BoardItemAdd = { blockId: string; note?: string | null };
/** GET /api/share/[slug] · what a client sees: no ids, no tokens, only shared boards. */
export type SharedBoard = { name: string; description: string | null; updatedAt: string; items: { note: string | null; block: Block }[] };

/**
 * GET /api/blocks/[id]/history · the time machine. Every capture of the block's
 * page, newest first, with the block that best matches this one in each
 * capture (same viewport and type, nearest position), or null when the page no
 * longer has one.
 */
export type BlockHistory = {
  blockId: string;
  page: { host: string; url: string; type: string; title: string | null };
  captures: {
    capturedAt: string;
    /** Full-page screenshot for the block's viewport, when known. */
    fullPage: { src: string; w: number; h: number } | null;
    block: Block | null;
    /** Block counts that changed against the previous capture (both viewports), when the importer recorded a diff. */
    diff: { added: number; removed: number; changed: number } | null;
  }[];
};

/**
 * POST /api/brief · "copy as design brief". Streams text/plain (Markdown). The
 * `x-brief-source` response header says `claude` or `template` (no API key on
 * the server, so the brief is assembled from the block's metadata).
 */
export type BriefTarget = "claude-code" | "cursor" | "designer";
export type BriefRequest = { blockId: string; target: BriefTarget };

/** Every error response, any endpoint. */
export type ApiError = { error: string; code?: string };
