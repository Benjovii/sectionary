import type { ViewCheck } from "@/contracts/api";
import { apiError } from "@/server/db";
import { userForRequest } from "@/server/accounts";
import { accessOf, can, viewLimit } from "@/server/plans";
import { checkView } from "@/server/views";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/views · { blockId } in, ViewCheck out. See the contract. With the
 * gates on, signed-out viewers cannot open blocks (reason SIGN_IN_REQUIRED),
 * Free counts against its daily cap, the trial and paid plans are not counted.
 */
export async function POST(request: Request) {
  try {
    const { blockId } = (await request.json().catch(() => ({}))) as { blockId?: unknown };
    const user = await userForRequest(request);
    const access = accessOf(user);
    const headers = { "cache-control": "no-store" };
    if (viewLimit(access) === null) return Response.json({ allowed: true, used: 0, limit: null, plan: access } satisfies ViewCheck, { headers });
    if (!user || !can(access, "open")) {
      return Response.json({ allowed: false, used: 0, limit: viewLimit(access), plan: null, reason: "SIGN_IN_REQUIRED" } satisfies ViewCheck, { headers });
    }
    const result = await checkView(`u:${user.id}`, typeof blockId === "string" ? blockId : "", access);
    return Response.json(result.allowed ? result : { ...result, reason: "LIMIT" }, { headers });
  } catch (error) { return apiError(error); }
}
