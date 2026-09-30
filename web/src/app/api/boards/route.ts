import { apiError } from "@/server/db";
import { boardErrorResponse, createBoard } from "@/server/boards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/boards · BoardCreate in, BoardCreated out. Keep the token: it is the only way to edit the board. */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    return Response.json(await createBoard(body), { status: 201 });
  } catch (error) { return boardErrorResponse(error) ?? apiError(error); }
}
