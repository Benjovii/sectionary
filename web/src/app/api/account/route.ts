import type { AccountResponse } from "@/contracts/api";
import { apiError } from "@/server/db";
import { toAccount, userForRequest } from "@/server/accounts";
import { viewLimit } from "@/server/plans";
import { viewsToday } from "@/server/views";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/account · the signed-in account and today's views, or { account: null }. */
export async function GET(request: Request) {
  try {
    if (!process.env.DATABASE_URL) return Response.json({ account: null } satisfies AccountResponse);
    const user = await userForRequest(request);
    if (!user) return Response.json({ account: null } satisfies AccountResponse, { headers: { "cache-control": "no-store" } });
    const body: AccountResponse = { account: toAccount(user), views: { used: await viewsToday(`u:${user.id}`), limit: viewLimit(user.plan) } };
    return Response.json(body, { headers: { "cache-control": "no-store" } });
  } catch (error) { return apiError(error); }
}
