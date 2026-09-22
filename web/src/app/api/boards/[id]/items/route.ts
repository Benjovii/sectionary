import { apiError } from "@/server/db";
import { addItem, boardErrorResponse, tokenFrom } from "@/server/boards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/boards/[id]/items · BoardItemAdd in, the updated Board out. Adding a block twice is a no-op. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    return Response.json(await addItem(id, tokenFrom(request), body));
  } catch (error) { return boardErrorResponse(error) ?? apiError(error); }
}
