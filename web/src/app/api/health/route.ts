import { databaseResponds, resetDatabase } from "@/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** How long `SELECT 1` may take before the pool counts as stuck. Under the load balancer's 5 s check timeout. */
const PROBE_MS = 3_000;
/** The load balancers check every 30 s, more than one of them: probe at most this often. */
const EVERY_MS = 15_000;

declare global {
  var sectionaryProbe: { at: number; ok: boolean; running?: Promise<boolean> } | undefined;
}

/** Probes the pool, at most every EVERY_MS, and resets it when it does not answer. */
function checkDatabase(): Promise<boolean> {
  const last = globalThis.sectionaryProbe;
  if (last?.running) return last.running;
  if (last && Date.now() - last.at < EVERY_MS) return Promise.resolve(last.ok);
  const running = databaseResponds(PROBE_MS).then((ok) => {
    if (!ok) {
      console.error(`Health: the database did not answer SELECT 1 within ${PROBE_MS} ms; resetting the connection pool.`);
      resetDatabase();
    }
    globalThis.sectionaryProbe = { at: Date.now(), ok };
    return ok;
  });
  globalThis.sectionaryProbe = { at: last?.at ?? 0, ok: last?.ok ?? true, running };
  return running;
}

/**
 * GET /api/health · the ECS load balancer's health check. 200 while the
 * server is up, whatever the database says: a slow or down Supabase must not
 * get the app restarted in a loop, since a new task would meet the same
 * database. But each check also probes the connection pool and, when it does
 * not answer, drops it (server/db.ts), so a pool whose connections are stuck
 * comes back within a check or two instead of hanging every request until the
 * task is replaced. `database` reports the last probe.
 */
export async function GET() {
  const ok = process.env.DATABASE_URL ? await checkDatabase() : null;
  return Response.json({ ok: true, database: ok === null ? "unconfigured" : ok ? "ok" : "reset" }, { headers: { "cache-control": "no-store" } });
}
