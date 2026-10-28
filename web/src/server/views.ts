import type { Plan, ViewCheck } from "@/contracts/api";
import { database } from "@/server/db";
import { UUID } from "@/server/blocks";
import { viewLimit } from "@/server/plans";

// The Free plan's daily cap (SEC-28): distinct blocks opened in the detail
// view per viewer per UTC day. Opening a block already opened today is free,
// so Back and Forward never cost a view. Pro and Team are not counted.

/** Records that `viewer` opened `blockId` today, if the cap allows it, and says whether it did. */
export async function checkView(viewer: string, blockId: string, plan: Plan | null): Promise<ViewCheck> {
  const limit = viewLimit(plan);
  if (limit === null || !UUID.test(blockId)) return { allowed: true, used: 0, limit, plan };
  const sql = database();
  return sql.begin(async (tx) => {
    // One viewer's opens in order, so two tabs cannot both take the last view.
    await tx`SELECT pg_advisory_xact_lock(hashtext(${viewer}))`;
    const [seen] = await tx`SELECT 1 FROM block_views WHERE viewer=${viewer} AND day=current_date AND block_id=${blockId}`;
    const [{ used }] = await tx`SELECT count(*)::int AS used FROM block_views WHERE viewer=${viewer} AND day=current_date`;
    if (seen) return { allowed: true, used, limit, plan };
    if (used >= limit) return { allowed: false, used, limit, plan };
    await tx`INSERT INTO block_views (viewer, day, block_id) VALUES (${viewer}, current_date, ${blockId}) ON CONFLICT DO NOTHING`;
    return { allowed: true, used: used + 1, limit, plan };
  }) as Promise<ViewCheck>;
}

/** Views used today, for the account page. */
export async function viewsToday(viewer: string): Promise<number> {
  const [{ used }] = await database()`SELECT count(*)::int AS used FROM block_views WHERE viewer=${viewer} AND day=current_date`;
  return used;
}
