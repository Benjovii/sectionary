import { apiError } from "@/server/db";
import { findBlock } from "@/server/blocks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/blocks/[id] · one Block, so a pasted `?open=<id>` link works without the wall having loaded it. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const block = await findBlock((await params).id, new URL(request.url).origin);
    if (!block) return Response.json({ error: "Block not found", code: "NOT_FOUND" }, { status: 404 });
    return Response.json(block);
  } catch (error) { return apiError(error); }
}
