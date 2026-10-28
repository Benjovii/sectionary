import { apiError } from "@/server/db";
import { handlePaddleEvent, verifySignature, type PaddleEvent } from "@/server/paddle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/paddle/webhook · Paddle's notification destination (SEC-28).
 * 401 for a bad signature; 200 for anything verified, including events we
 * ignore, so Paddle does not retry them. A database failure is a 503, which
 * Paddle retries.
 */
export async function POST(request: Request) {
  const secret = process.env.PADDLE_WEBHOOK_SECRET;
  if (!secret) return Response.json({ error: "Webhooks are not configured", code: "NOT_CONFIGURED" }, { status: 503 });
  const raw = await request.text();
  if (!verifySignature(raw, request.headers.get("paddle-signature"), secret)) {
    return Response.json({ error: "Bad signature", code: "FORBIDDEN" }, { status: 401 });
  }
  let event: PaddleEvent;
  try {
    event = JSON.parse(raw) as PaddleEvent;
    if (!event?.event_id || !event.event_type || !event.occurred_at) throw new Error();
  } catch {
    return Response.json({ error: "Not a Paddle event", code: "INVALID" }, { status: 400 });
  }
  try {
    const outcome = await handlePaddleEvent(event);
    console.info(`[paddle] ${event.event_type} ${event.event_id}: ${outcome}`);
    return Response.json({ ok: true, outcome });
  } catch (error) { return apiError(error); }
}
