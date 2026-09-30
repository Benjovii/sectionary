import { apiError } from "@/server/db";
import { sharedBoard } from "@/server/boards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/share/[slug] · the read-only SharedBoard a client sees, or 404 when sharing is off. */
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const board = await sharedBoard(slug);
    if (!board) return Response.json({ error: "This board is not shared", code: "NOT_FOUND" }, { status: 404 });
    return Response.json(board, { headers: { "cache-control": "no-store" } });
  } catch (error) { return apiError(error); }
}
