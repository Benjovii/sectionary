import type { BlockHistory } from "@/contracts/api";
import { apiError, database } from "@/server/db";
import { blockColumns, blockJoins, toBlock, UUID } from "@/server/blocks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ViewportShot = { file?: string; width?: number; fullHeight?: number } | null;

/**
 * The full-page screenshot sits next to the capture's blocks/ folder under the
 * same key layout (see platform/src/import.ts), so derive it from any block key.
 */
function fullPageSrc(blockKey: string | null, shot: ViewportShot) {
  if (!blockKey || !shot?.file || !shot.width || !shot.fullHeight) return null;
  const match = blockKey.match(/^(.*)\/blocks\/[^/]+$/);
  if (!match) return null;
  return { src: `${match[1]}/${shot.file.replace(/\.(jpe?g)$/i, ".webp")}`, w: shot.width, h: shot.fullHeight };
}

/** GET /api/blocks/[id]/history · BlockHistory, newest capture first. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!UUID.test(id)) return Response.json({ error: "Block not found", code: "NOT_FOUND" }, { status: 404 });
    const sql = database();
    const [origin] = await sql`SELECT b.viewport, b.type_hint, b.block_index, b.top, c.page_id, p.url, p.type, p.title, s.host
      FROM ${blockJoins(sql)} WHERE b.id=${id}`;
    if (!origin) return Response.json({ error: "Block not found", code: "NOT_FOUND" }, { status: 404 });

    const [captures, matches, diffs] = await Promise.all([
      sql`SELECT c.id, c.captured_at, c.desktop, c.mobile,
          (SELECT image_key FROM blocks WHERE capture_id=c.id AND viewport=${origin.viewport} AND image_key IS NOT NULL ORDER BY block_index LIMIT 1) AS any_key
        FROM captures c WHERE c.page_id=${origin.page_id} ORDER BY c.captured_at DESC`,
      // One block per capture: same type first, then the nearest index, then the nearest position.
      sql`SELECT DISTINCT ON (b.capture_id) b.capture_id, ${blockColumns(sql)} FROM ${blockJoins(sql)}
        WHERE c.page_id=${origin.page_id} AND b.viewport=${origin.viewport}
        ORDER BY b.capture_id, (b.type_hint <> ${origin.type_hint}), abs(b.block_index - ${origin.block_index}), abs(b.top - ${origin.top})`,
      sql`SELECT to_capture_id, added_block_count, removed_block_count, changed_block_count FROM capture_diffs WHERE page_id=${origin.page_id}`,
    ]);
    const byCapture = new Map(matches.map((m) => [m.capture_id as string, m]));
    const diffBy = new Map(diffs.map((d) => [d.to_capture_id as string, d]));

    const body: BlockHistory = {
      blockId: id,
      page: { host: origin.host, url: origin.url, type: origin.type, title: origin.title },
      captures: captures.map((c) => {
        const m = byCapture.get(c.id), d = diffBy.get(c.id);
        // Only a block of the same type counts as "the same block" in another capture.
        const block = m && m.type_hint === origin.type_hint ? toBlock(m) : null;
        return {
          capturedAt: (c.captured_at as Date).toISOString(),
          fullPage: fullPageSrc(c.any_key, (origin.viewport === "mobile" ? c.mobile : c.desktop) as ViewportShot),
          block,
          diff: d ? { added: d.added_block_count, removed: d.removed_block_count, changed: d.changed_block_count } : null,
        };
      }),
    };
    return Response.json(body);
  } catch (error) { return apiError(error); }
}
