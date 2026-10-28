import { cookies, headers } from "next/headers";
import { createSession, endAllSessions, endSession, lookupSession, SESSION_COOKIE, SESSION_DAYS, upsertUser, userById, type SessionUser } from "@/server/accounts";
import { PENDING_MINUTES } from "@/server/accounts";
import type { VerifiedUser } from "@/server/supabase-auth";
import { finishSignIn } from "@/server/two-step";

// The Next.js side of accounts: the session cookie. Lax so the click from the
// email arrives signed in on the next request; httpOnly so page scripts never
// see it; Secure in production only, because Safari will not store a Secure
// cookie on http://localhost or a phone opening the dev server by IP.

const secure = () => process.env.NODE_ENV === "production";

/** The half-signed-in cookie between the email link and the authenticator code. */
export const PENDING_COOKIE = "sx_two_step";

export async function currentUser(): Promise<SessionUser | null> {
  if (!process.env.DATABASE_URL) return null;
  return (await lookupSession((await cookies()).get(SESSION_COOKIE)?.value))?.user ?? null;
}

async function setSessionCookie(userId: string) {
  const { token, expires } = await createSession(userId, (await headers()).get("user-agent"));
  (await cookies()).set(SESSION_COOKIE, token, { httpOnly: true, secure: secure(), sameSite: "lax", path: "/", expires, maxAge: SESSION_DAYS * 86_400 });
}

/**
 * After Supabase verified the address: the users row, then either a session
 * and its cookie, or, with two-step on, a ten-minute pending session that only
 * /auth/two-step can finish. Says which, so the caller knows where to go.
 */
export async function startSession(verified: VerifiedUser, next: string): Promise<{ user: SessionUser; twoStep: boolean }> {
  const user = await upsertUser(verified.id, verified.email);
  const jar = await cookies();
  if (user.twoStepSince) {
    const { token, expires } = await createSession(user.id, (await headers()).get("user-agent"), { next });
    jar.set(PENDING_COOKIE, token, { httpOnly: true, secure: secure(), sameSite: "lax", path: "/", expires, maxAge: PENDING_MINUTES * 60 });
    return { user, twoStep: true };
  }
  await setSessionCookie(user.id);
  return { user, twoStep: false };
}

/** The authenticator (or recovery) code for a pending sign-in. Returns where to go next; throws TwoStepCodeError. */
export async function finishTwoStep(code: string): Promise<string> {
  const jar = await cookies();
  const token = jar.get(PENDING_COOKIE)?.value ?? "";
  try {
    const { userId, next } = await finishSignIn(token, code);
    if (!(await userById(userId))) throw new Error("user vanished");
    await setSessionCookie(userId);
    jar.delete(PENDING_COOKIE);
    return next;
  } catch (error) {
    // A locked or timed-out pending sign-in is gone; so is its cookie.
    if ((error as { code?: string }).code === "LOCKED" || (error as { code?: string }).code === "EXPIRED") jar.delete(PENDING_COOKIE);
    throw error;
  }
}

export async function signOut() {
  const jar = await cookies();
  await endSession(jar.get(SESSION_COOKIE)?.value);
  jar.delete(SESSION_COOKIE);
}

/** Every device, this one included. */
export async function signOutEverywhere(userId: string) {
  await endAllSessions(userId);
  (await cookies()).delete(SESSION_COOKIE);
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
