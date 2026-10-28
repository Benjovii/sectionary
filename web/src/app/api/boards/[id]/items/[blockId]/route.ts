import { apiError } from "@/server/db";
import { actorFrom, boardErrorResponse, removeItem, setItemNote } from "@/server/boards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; blockId: string }> };

/** PATCH { note } sets the note shown under the block on the shared board. */
export async function PATCH(request: Request, { params }: Ctx) {
  try {
    const { id, blockId } = await params;
    const body = (await request.json().catch(() => ({}))) as { note?: unknown };
    return Response.json(await setItemNote(id, await actorFrom(request), blockId, body.note));
  } catch (error) { return boardErrorResponse(error) ?? apiError(error); }
}

export async function DELETE(request: Request, { params }: Ctx) {
  try {
    const { id, blockId } = await params;
    return Response.json(await removeItem(id, await actorFrom(request), blockId));
  } catch (error) { return boardErrorResponse(error) ?? apiError(error); }
}
