import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Board, BoardPatch, SharedBoard } from "@/contracts/api";
import { database, pgArray } from "@/server/db";
import { blockColumns, blockJoins, toBlock, UUID } from "@/server/blocks";
import { userForRequest, type SessionUser } from "@/server/accounts";
import { accessOf, canUseBoards } from "@/server/plans";

// Who may touch a board. A board with an owner (owner_id, SEC-27) belongs to
// that signed-in account and nobody else. A board from before accounts belongs
// to whoever holds its edit token, returned once at creation and stored only as
// its SHA-256; the first signed-in request that carries the token claims it.
//
// Plan gate (SEC-28, with PLAN_GATES=on): creating boards and adding to them
// needs Pro or Team. Reading, sharing, reordering and deleting what you already
// have keeps working after a downgrade, so nobody loses a client link.

const hash = (token: string) => createHash("sha256").update(token).digest("hex");
const iso = (d: unknown) => (d instanceof Date ? d.toISOString() : String(d));

export class BoardError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(message: string, status: number, code: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function boardErrorResponse(error: unknown) {
  if (error instanceof BoardError) return Response.json({ error: error.message, code: error.code }, { status: error.status });
  return null;
}

export type Actor = { token: string; user: SessionUser | null };

export const actorFrom = async (request: Request): Promise<Actor> =>
  ({ token: request.headers.get("x-board-token")?.trim() ?? "", user: await userForRequest(request) });

function requirePlan(actor: Actor) {
  if (canUseBoards(accessOf(actor.user))) return;
  if (!actor.user) throw new BoardError("Sign in to make boards", 401, "SIGN_IN_REQUIRED");
  throw new BoardError("Boards come with Pro and Team", 402, "PLAN_REQUIRED");
}

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

/** Throws 404 for an unknown board and 403 for someone else's; token hashes are compared in constant time. */
async function authorize(id: string, actor: Actor) {
  if (!UUID.test(id)) throw new BoardError("Board not found", 404, "NOT_FOUND");
  const sql = database();
  const [row] = await sql`SELECT edit_token_hash, owner_id FROM boards WHERE id=${id}`;
  if (!row) throw new BoardError("Board not found", 404, "NOT_FOUND");
  if (row.owner_id) {
    if (row.owner_id === actor.user?.id) return;
    throw new BoardError("This board belongs to someone else", 403, "FORBIDDEN");
  }
  const expected = Buffer.from(row.edit_token_hash ?? "", "hex"), given = Buffer.from(hash(actor.token), "hex");
  if (!actor.token || expected.length !== given.length || !timingSafeEqual(expected, given)) {
    throw new BoardError("This board belongs to someone else", 403, "FORBIDDEN");
  }
  if (actor.user) await sql`UPDATE boards SET owner_id=${actor.user.id}, created_by=coalesce(created_by, ${actor.user.id}) WHERE id=${id} AND owner_id IS NULL`;
}

const touch = (id: string) => database()`UPDATE boards SET updated_at=now() WHERE id=${id}`;

export async function createBoard(actor: Actor, input: { name?: unknown; description?: unknown }) {
  requirePlan(actor);
  const name = clean(input.name, 120);
  if (!name) throw new BoardError("A board needs a name", 400, "INVALID");
  const description = clean(input.description, 2000) || null;
  const token = randomBytes(24).toString("base64url");
  const sql = database();
  const owner = actor.user?.id ?? null;
  const [row] = await sql`INSERT INTO boards (name, description, share_slug, edit_token_hash, owner_id, created_by)
    VALUES (${name}, ${description}, ${randomBytes(8).toString("base64url")}, ${hash(token)}, ${owner}, ${owner}) RETURNING id`;
  return { board: await load(row.id), token };
}

/** The signed-in account's boards, newest change first. */
export async function listBoards(actor: Actor): Promise<Board[]> {
  if (!actor.user) throw new BoardError("Sign in to see your boards", 401, "SIGN_IN_REQUIRED");
  const rows = await database()`SELECT id FROM boards WHERE owner_id=${actor.user.id} ORDER BY updated_at DESC LIMIT 200`;
  return Promise.all(rows.map((r) => load(r.id)));
}

export async function getBoard(id: string, actor: Actor) {
  await authorize(id, actor);
  return load(id);
}

export async function updateBoard(id: string, actor: Actor, patch: BoardPatch) {
  await authorize(id, actor);
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

export async function deleteBoard(id: string, actor: Actor) {
  await authorize(id, actor);
  await database()`DELETE FROM boards WHERE id=${id}`;
}

export async function addItem(id: string, actor: Actor, input: { blockId?: unknown; note?: unknown }) {
  await authorize(id, actor);
  requirePlan(actor);
  const blockId = typeof input.blockId === "string" ? input.blockId : "";
  if (!UUID.test(blockId)) throw new BoardError("Unknown block", 400, "INVALID");
  const sql = database();
  const [exists] = await sql`SELECT 1 FROM blocks WHERE id=${blockId}`;
  if (!exists) throw new BoardError("Unknown block", 404, "NOT_FOUND");
  await sql`INSERT INTO board_items (board_id, block_id, note, position, added_by)
    VALUES (${id}, ${blockId}, ${clean(input.note, 2000) || null}, (SELECT coalesce(max(position) + 1, 0) FROM board_items WHERE board_id=${id}), ${actor.user?.id ?? null})
    ON CONFLICT (board_id, block_id) DO NOTHING`;
  await touch(id);
  return load(id);
}

export async function setItemNote(id: string, actor: Actor, blockId: string, note: unknown) {
  await authorize(id, actor);
  await database()`UPDATE board_items SET note=${clean(note, 2000) || null}, updated_at=now() WHERE board_id=${id} AND block_id=${UUID.test(blockId) ? blockId : null}`;
  await touch(id);
  return load(id);
}

export async function removeItem(id: string, actor: Actor, blockId: string) {
  await authorize(id, actor);
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
