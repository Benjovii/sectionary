import { randomUUID } from "node:crypto";
import type { ViewCheck } from "@/contracts/api";
import { apiError } from "@/server/db";
import { cookieFrom, userForRequest } from "@/server/accounts";
import { viewLimit } from "@/server/plans";
import { checkView } from "@/server/views";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Signed-out viewers are counted by a random id in this cookie (a year). */
const VIEWER_COOKIE = "sx_viewer";

/** POST /api/views · { blockId } in, ViewCheck out. See the contract. */
export async function POST(request: Request) {
  try {
    const { blockId } = (await request.json().catch(() => ({}))) as { blockId?: unknown };
    const user = await userForRequest(request);
    if (viewLimit(user?.plan ?? null) === null) return Response.json({ allowed: true, used: 0, limit: null, plan: user?.plan ?? null } satisfies ViewCheck);

    let anon = cookieFrom(request, VIEWER_COOKIE);
    const fresh = !anon || !/^[0-9a-f-]{36}$/.test(anon);
    if (fresh) anon = randomUUID();
    const result = await checkView(user ? `u:${user.id}` : `a:${anon}`, typeof blockId === "string" ? blockId : "", user?.plan ?? null);
    const headers = new Headers({ "cache-control": "no-store" });
    if (fresh && !user) {
      const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
      headers.append("set-cookie", `${VIEWER_COOKIE}=${anon}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax${secure}`);
    }
    return Response.json(result, { headers });
  } catch (error) { return apiError(error); }
}
