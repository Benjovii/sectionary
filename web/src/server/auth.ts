import { cookies, headers } from "next/headers";
import { createSession, endSession, SESSION_COOKIE, SESSION_DAYS, upsertUser, userForSession, type SessionUser } from "@/server/accounts";
import type { VerifiedUser } from "@/server/supabase-auth";

// The Next.js side of accounts: the session cookie. Lax so the click from the
// email arrives signed in on the next request; httpOnly so page scripts never
// see it; Secure in production only, because Safari will not store a Secure
// cookie on http://localhost or a phone opening the dev server by IP.

const secure = () => process.env.NODE_ENV === "production";

export async function currentUser(): Promise<SessionUser | null> {
  if (!process.env.DATABASE_URL) return null;
  return userForSession((await cookies()).get(SESSION_COOKIE)?.value);
}

/** After Supabase verified the address: the users row, a session, the cookie. */
export async function startSession(verified: VerifiedUser) {
  const user = await upsertUser(verified.id, verified.email);
  const { token, expires } = await createSession(user.id, (await headers()).get("user-agent"));
  (await cookies()).set(SESSION_COOKIE, token, { httpOnly: true, secure: secure(), sameSite: "lax", path: "/", expires, maxAge: SESSION_DAYS * 86_400 });
  return user;
}

export async function signOut() {
  const jar = await cookies();
  await endSession(jar.get(SESSION_COOKIE)?.value);
  jar.delete(SESSION_COOKIE);
}

/** Where to go after signing in: a path on this site, never another origin. */
export function safeNext(next: unknown, fallback = "/account"): string {
  return typeof next === "string" && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next.slice(0, 500) : fallback;
}

export const NEXT_COOKIE = "sx_next";
export const EMAIL_COOKIE = "sx_signin_email";

/** Remembered across the trip to the inbox, on this device only (10 minutes). */
export async function rememberSignIn(email: string, next: string) {
  const jar = await cookies();
  const opts = { httpOnly: true, secure: secure(), sameSite: "lax" as const, path: "/", maxAge: 600 };
  jar.set(EMAIL_COOKIE, email, opts);
  jar.set(NEXT_COOKIE, next, opts);
}

/** The path saved by rememberSignIn, cleared once used. */
export async function takeNext(): Promise<string> {
  const jar = await cookies();
  const next = safeNext(jar.get(NEXT_COOKIE)?.value);
  jar.delete(NEXT_COOKIE);
  jar.delete(EMAIL_COOKIE);
  return next;
}
