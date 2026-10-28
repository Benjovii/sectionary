import type { AccountResponse } from "@/contracts/api";
import { apiError } from "@/server/db";
import { cookieFrom, lookupSession, SESSION_COOKIE, sessionCookie, toAccount } from "@/server/accounts";
import { accessOf, featuresFor, gatesOn, viewLimit } from "@/server/plans";
import { viewsToday } from "@/server/views";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/account · the signed-in account, today's views and what this
 * viewer may use, or { account: null } with the signed-out features. Every
 * page asks once, so this is also where the session cookie is renewed when
 * the session slid forward: the browser goes by the cookie's own expiry.
 */
export async function GET(request: Request) {
  try {
    if (!process.env.DATABASE_URL) return Response.json({ account: null, gates: false } satisfies AccountResponse);
    const token = cookieFrom(request, SESSION_COOKIE);
    const session = await lookupSession(token);
    const headers = new Headers({ "cache-control": "no-store" });
    if (!session) return Response.json({ account: null, gates: gatesOn(), features: featuresFor(null) } satisfies AccountResponse, { headers });
    const { user, renewed } = session;
    if (renewed && token) headers.append("set-cookie", sessionCookie(token, renewed));
    const access = accessOf(user);
    const body: AccountResponse = {
      account: toAccount(user, access ?? "free"),
      views: { used: await viewsToday(`u:${user.id}`), limit: viewLimit(access) },
      gates: gatesOn(),
      features: featuresFor(access),
    };
    return Response.json(body, { headers });
  } catch (error) { return apiError(error); }
}
