import { apiError } from "@/server/db";
import { actorFrom, boardErrorResponse, createBoard, listBoards } from "@/server/boards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/boards · the signed-in account's boards as { items: Board[] }. */
export async function GET(request: Request) {
  try {
    return Response.json({ items: await listBoards(await actorFrom(request)) });
  } catch (error) { return boardErrorResponse(error) ?? apiError(error); }
}

/** POST /api/boards · BoardCreate in, BoardCreated out. Signed out, keep the token: it is the only way to edit the board. */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    return Response.json(await createBoard(await actorFrom(request), body), { status: 201 });
  } catch (error) { return boardErrorResponse(error) ?? apiError(error); }
}
