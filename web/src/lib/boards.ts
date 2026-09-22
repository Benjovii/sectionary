"use client";

import type { Board, BoardCreated, BoardPatch } from "@/contracts/api";
import type { Block } from "@/contracts/block";
import { API_MODE } from "@/lib/data-source";

// Boards on the client. Two stores behind one interface:
//
// - API mode (blocks from /api/blocks): boards live in the database. Until
//   accounts exist, this browser keeps each board's edit token, and the share
//   link (/b/<slug>) is live: edits show up for the client on reload.
// - Sample mode (the committed sample JSON, as on the preview deploy): boards
//   live in this browser, and the share link (/share#...) carries the whole
//   board, so it works with no database. It is a snapshot: copy it again after
//   changes.

export type BoardSummary = { id: string; name: string; blockIds: string[]; cover: Block | null; updatedAt: string };

export interface BoardStore {
  /** "live" links follow later edits; "snapshot" links freeze the board when copied. */
  readonly linkKind: "live" | "snapshot";
  list(): Promise<BoardSummary[]>;
  get(id: string): Promise<Board>;
  create(name: string, description?: string | null): Promise<Board>;
  update(id: string, patch: BoardPatch): Promise<Board>;
  remove(id: string): Promise<void>;
  add(id: string, block: Block): Promise<Board>;
  removeItem(id: string, blockId: string): Promise<Board>;
  setNote(id: string, blockId: string, note: string): Promise<Board>;
  /** Absolute share URL, or null while sharing is off. */
  shareUrl(board: Board): string | null;
}

const CHANGED = "sectionary:boards";
/** Re-render when any board changes, in this tab or another. */
export function onBoardsChanged(fn: () => void) {
  const storage = (e: StorageEvent) => e.key?.startsWith("sectionary.boards") && fn();
  window.addEventListener(CHANGED, fn);
  window.addEventListener("storage", storage);
  return () => {
    window.removeEventListener(CHANGED, fn);
    window.removeEventListener("storage", storage);
  };
}
const changed = <T,>(value: T) => {
  window.dispatchEvent(new Event(CHANGED));
  return value;
};

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    throw new Error("This browser would not save the board (storage is full or blocked).");
  }
}

const summary = (b: Board): BoardSummary => ({
  id: b.id, name: b.name, updatedAt: b.updatedAt,
  blockIds: b.items.map((i) => i.blockId), cover: b.items.find((i) => i.block)?.block ?? null,
});

// ---------------------------------------------------------------------------
// API store

const TOKENS = "sectionary.boards.tokens.v1";
const tokens = () => read<Record<string, string>>(TOKENS, {});

async function call<T>(path: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("content-type", "application/json");
  if (init.token) headers.set("x-board-token", init.token);
  const res = await fetch(path, { ...init, headers });
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as { error?: string } | null;
    throw Object.assign(new Error(err?.error ?? `HTTP ${res.status}`), { status: res.status });
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

const apiStore: BoardStore = {
  linkKind: "live",
  async list() {
    const ids = Object.keys(tokens());
    const boards = await Promise.all(ids.map((id) => this.get(id).catch((e: { status?: number }) => {
      // Deleted elsewhere: forget it. Anything else (offline, 503): keep the token.
      if (e.status === 404 || e.status === 403) {
        const t = tokens();
        delete t[id];
        write(TOKENS, t);
      }
      return null;
    })));
    return boards.filter((b): b is Board => b !== null).map(summary).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },
  get: (id) => call<Board>(`/api/boards/${id}`, { token: tokens()[id] }),
  async create(name, description) {
    const { board, token } = await call<BoardCreated>("/api/boards", { method: "POST", body: JSON.stringify({ name, description }) });
    write(TOKENS, { ...tokens(), [board.id]: token });
    return changed(board);
  },
  update: async (id, patch) => changed(await call<Board>(`/api/boards/${id}`, { method: "PATCH", token: tokens()[id], body: JSON.stringify(patch) })),
  async remove(id) {
    await call<void>(`/api/boards/${id}`, { method: "DELETE", token: tokens()[id] });
    const t = tokens();
    delete t[id];
    write(TOKENS, t);
    changed(null);
  },
  add: async (id, block) => changed(await call<Board>(`/api/boards/${id}/items`, { method: "POST", token: tokens()[id], body: JSON.stringify({ blockId: block.id }) })),
  removeItem: async (id, blockId) => changed(await call<Board>(`/api/boards/${id}/items/${blockId}`, { method: "DELETE", token: tokens()[id] })),
  setNote: async (id, blockId, note) => changed(await call<Board>(`/api/boards/${id}/items/${blockId}`, { method: "PATCH", token: tokens()[id], body: JSON.stringify({ note }) })),
  shareUrl: (b) => (b.shared ? `${location.origin}/b/${b.shareSlug}` : null),
};

// ---------------------------------------------------------------------------
// Browser store (sample mode)

const LOCAL = "sectionary.boards.v1";
const localBoards = () => read<Board[]>(LOCAL, []);

function saveLocal(id: string, edit: (b: Board) => Board): Board {
  const all = localBoards();
  const i = all.findIndex((b) => b.id === id);
  if (i < 0) throw Object.assign(new Error("Board not found"), { status: 404 });
  all[i] = { ...edit(all[i]), updatedAt: new Date().toISOString() };
  write(LOCAL, all);
  return changed(all[i]);
}
const renumber = (items: Board["items"]) => items.map((it, position) => ({ ...it, position }));

const localStore: BoardStore = {
  linkKind: "snapshot",
  list: async () => localBoards().map(summary).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
  async get(id) {
    const b = localBoards().find((x) => x.id === id);
    if (!b) throw Object.assign(new Error("Board not found"), { status: 404 });
    return b;
  },
  async create(name, description) {
    const now = new Date().toISOString();
    const board: Board = { id: crypto.randomUUID(), name: name.trim().slice(0, 120), description: description?.trim() || null, shareSlug: "", shared: true, createdAt: now, updatedAt: now, items: [] };
    write(LOCAL, [board, ...localBoards()]);
    return changed(board);
  },
  update: async (id, patch) =>
    saveLocal(id, (b) => {
      let items = b.items;
      if (patch.order) {
        const rank = new Map(patch.order.map((x, i) => [x, i]));
        items = renumber([...items].sort((x, y) => (rank.get(x.blockId) ?? 1e9) - (rank.get(y.blockId) ?? 1e9)));
      }
      return {
        ...b, items,
        name: patch.name !== undefined ? patch.name.trim().slice(0, 120) || b.name : b.name,
        description: patch.description !== undefined ? patch.description?.trim() || null : b.description,
      };
    }),
  async remove(id) {
    write(LOCAL, localBoards().filter((b) => b.id !== id));
    changed(null);
  },
  add: async (id, block) =>
    saveLocal(id, (b) => (b.items.some((i) => i.blockId === block.id) ? b : { ...b, items: renumber([...b.items, { blockId: block.id, note: null, position: 0, block }]) })),
  removeItem: async (id, blockId) => saveLocal(id, (b) => ({ ...b, items: renumber(b.items.filter((i) => i.blockId !== blockId)) })),
  setNote: async (id, blockId, note) =>
    saveLocal(id, (b) => ({ ...b, items: b.items.map((i) => (i.blockId === blockId ? { ...i, note: note.trim().slice(0, 2000) || null } : i)) })),
  shareUrl: (b) => `${location.origin}/share#${encodeSnapshot(b)}`,
};

export const boardStore: BoardStore = API_MODE ? apiStore : localStore;

// ---------------------------------------------------------------------------
// Snapshot links: the board travels in the URL fragment, which never reaches a server.

export type Snapshot = { name: string; description: string | null; items: { blockId: string; note: string | null }[] };

function toBase64Url(s: string) {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromBase64Url(s: string) {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export function encodeSnapshot(b: Board) {
  return toBase64Url(JSON.stringify({ v: 1, n: b.name, d: b.description, i: b.items.map((i) => (i.note ? [i.blockId, i.note] : [i.blockId])) }));
}

export function decodeSnapshot(hash: string): Snapshot | null {
  try {
    const j = JSON.parse(fromBase64Url(hash.replace(/^#/, ""))) as { v: number; n: string; d: string | null; i: [string, string?][] };
    if (j.v !== 1 || typeof j.n !== "string" || !Array.isArray(j.i)) return null;
    return { name: j.n, description: j.d ?? null, items: j.i.map(([blockId, note]) => ({ blockId: String(blockId), note: note ?? null })) };
  } catch {
    return null;
  }
}
