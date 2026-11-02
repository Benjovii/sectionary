export const dynamic = "force-dynamic";

/**
 * GET /api/health · 200 while the server is up. App Runner's health check, so
 * it touches nothing else: a slow database must not get the app restarted.
 */
export function GET() {
  return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
}
