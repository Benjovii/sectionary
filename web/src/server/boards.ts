import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Board, BoardPatch, SharedBoard } from "@/contracts/api";
import { database, pgArray } from "@/server/db";
import { blockColumns, blockJoins, toBlock, UUID } from "@/server/blocks";

// Boards before accounts (SEC-27): whoever holds a board's edit token owns it.
// The token is returned once, at creation; only its SHA-256 is stored.

const hash = (token: string) => createHash("sha256").update(token).digest("hex");
const iso = (d: unknown) => (d instanceof Date ? d.toISOString() : String(d));

export class BoardError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) {
    super(message);
  }
}

export function boardErrorResponse(error: unknown) {
  if (error instanceof BoardError) return Response.json({ error: error.message, code: error.code }, { status: error.status });
  return null;
}

export const tokenFrom = (request: Request) => request.headers.get("x-board-token")?.trim() ?? "";

const clean = (s: unknown, max: number) => (typeof s === "string" ? s.trim().slice(0, max) : "");

async function items(boardId: string) {
  const sql = database();
  const rows = await sql`SELECT i.block_id, i.note, i.position, ${blockColumns(sql)}
    FROM board_items i JOIN ${blockJoins(sql)} ON b.id=i.block_id
    WHERE i.board_id=${boardId} ORDER BY i.position, i.created_at`;
  return rows.map((r) => ({ blockId: r.block_id as string, note: (r.note as string | null) ?? null, position: r.position as number, block: r.id ? toBlock(r) : null }));
}

async function load(id: string): Promise<Board> {
  const sql = database();
  const [b] = await sql`SELECT id, name, description, share_slug, shared, created_at, updated_at FROM boards WHERE id=${id}`;
  if (!b) throw new BoardError("Board not found", 404, "NOT_FOUND");
  return { id: b.id, name: b.name, description: b.description, shareSlug: b.share_slug, shared: b.shared,
    createdAt: iso(b.created_at), updatedAt: iso(b.updated_at), items: await items(b.id) };
}

/** Throws 404 for an unknown board and 403 for a wrong token; the hashes are compared in constant time. */
async function authorize(id: string, token: string) {
  if (!UUID.test(id)) throw new BoardError("Board not found", 404, "NOT_FOUND");
  const sql = database();
  const [row] = await sql`SELECT edit_token_hash FROM boards WHERE id=${id}`;
  if (!row) throw new BoardError("Board not found", 404, "NOT_FOUND");
  const expected = Buffer.from(row.edit_token_hash ?? "", "hex"), given = Buffer.from(hash(token), "hex");
  if (!token || expected.length !== given.length || !timingSafeEqual(expected, given)) {
    throw new BoardError("This board belongs to someone else", 403, "FORBIDDEN");
  }
}

const touch = (id: string) => database()`UPDATE boards SET updated_at=now() WHERE id=${id}`;

export async function createBoard(input: { name?: unknown; description?: unknown }) {
  const name = clean(input.name, 120);
  if (!name) throw new BoardError("A board needs a name", 400, "INVALID");
  const description = clean(input.description, 2000) || null;
  const token = randomBytes(24).toString("base64url");
  const sql = database();
  const [row] = await sql`INSERT INTO boards (name, description, share_slug, edit_token_hash)
    VALUES (${name}, ${description}, ${randomBytes(8).toString("base64url")}, ${hash(token)}) RETURNING id`;
  return { board: await load(row.id), token };
}

export async function getBoard(id: string, token: string) {
  await authorize(id, token);
  return load(id);
}

export async function updateBoard(id: string, token: string, patch: BoardPatch) {
  await authorize(id, token);
  const sql = database();
  await sql.begin(async (tx) => {
    if (patch.name !== undefined) {
      const name = clean(patch.name, 120);
      if (!name) throw new BoardError("A board needs a name", 400, "INVALID");
      await tx`UPDATE boards SET name=${name} WHERE id=${id}`;
    }
    if (patch.description !== undefined) await tx`UPDATE boards SET description=${clean(patch.description, 2000) || null} WHERE id=${id}`;
    if (typeof patch.shared === "boolean") await tx`UPDATE boards SET shared=${patch.shared} WHERE id=${id}`;
    if (Array.isArray(patch.order)) {
      const order = patch.order.filter((x): x is string => typeof x === "string" && UUID.test(x));
      // Positions follow the given order; anything the client did not list keeps its place after them.
      await tx`UPDATE board_items i SET position=o.ord::int - 1, updated_at=now()
        FROM unnest(${pgArray(order)}::uuid[]) WITH ORDINALITY AS o(block_id, ord) WHERE i.board_id=${id} AND i.block_id=o.block_id`;
      await tx`UPDATE board_items SET position=${order.length} + position WHERE board_id=${id} AND NOT (block_id = ANY(${pgArray(order)}::uuid[]))`;
    }
    await tx`UPDATE boards SET updated_at=now() WHERE id=${id}`;
  });
  return load(id);
}

export async function deleteBoard(id: string, token: string) {
  await authorize(id, token);
  await database()`DELETE FROM boards WHERE id=${id}`;
}

export async function addItem(id: string, token: string, input: { blockId?: unknown; note?: unknown }) {
  await authorize(id, token);
  const blockId = typeof input.blockId === "string" ? input.blockId : "";
  if (!UUID.test(blockId)) throw new BoardError("Unknown block", 400, "INVALID");
  const sql = database();
  const [exists] = await sql`SELECT 1 FROM blocks WHERE id=${blockId}`;
  if (!exists) throw new BoardError("Unknown block", 404, "NOT_FOUND");
  await sql`INSERT INTO board_items (board_id, block_id, note, position)
    VALUES (${id}, ${blockId}, ${clean(input.note, 2000) || null}, (SELECT coalesce(max(position) + 1, 0) FROM board_items WHERE board_id=${id}))
    ON CONFLICT (board_id, block_id) DO NOTHING`;
  await touch(id);
  return load(id);
}

export async function setItemNote(id: string, token: string, blockId: string, note: unknown) {
  await authorize(id, token);
  await database()`UPDATE board_items SET note=${clean(note, 2000) || null}, updated_at=now() WHERE board_id=${id} AND block_id=${UUID.test(blockId) ? blockId : null}`;
  await touch(id);
  return load(id);
}

export async function removeItem(id: string, token: string, blockId: string) {
  await authorize(id, token);
  await database()`DELETE FROM board_items WHERE board_id=${id} AND block_id=${UUID.test(blockId) ? blockId : null}`;
  await touch(id);
  return load(id);
}

/** The public view of a shared board, or null when the slug is unknown or sharing is off. */
export async function sharedBoard(slug: string): Promise<SharedBoard | null> {
  const sql = database();
  const [b] = await sql`SELECT id, name, description, updated_at FROM boards WHERE share_slug=${slug} AND shared`;
  if (!b) return null;
  const list = await items(b.id);
  return { name: b.name, description: b.description, updatedAt: iso(b.updated_at),
    items: list.filter((i) => i.block).map((i) => ({ note: i.note, block: i.block! })) };
}
