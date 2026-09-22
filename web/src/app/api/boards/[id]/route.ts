import type { BoardPatch } from "@/contracts/api";
import { apiError } from "@/server/db";
import { boardErrorResponse, deleteBoard, getBoard, tokenFrom, updateBoard } from "@/server/boards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    return Response.json(await getBoard(id, tokenFrom(request)));
  } catch (error) { return boardErrorResponse(error) ?? apiError(error); }
}

export async function PATCH(request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const patch = (await request.json().catch(() => ({}))) as BoardPatch;
    return Response.json(await updateBoard(id, tokenFrom(request), patch));
  } catch (error) { return boardErrorResponse(error) ?? apiError(error); }
}

export async function DELETE(request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    await deleteBoard(id, tokenFrom(request));
    return new Response(null, { status: 204 });
  } catch (error) { return boardErrorResponse(error) ?? apiError(error); }
}
