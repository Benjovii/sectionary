import { createHash, randomBytes } from "node:crypto";
import type { Account, Plan } from "@/contracts/api";
import { database } from "@/server/db";

// Accounts and sessions (SEC-27). Supabase proves the email address (see
// supabase-auth.ts); from then on the browser holds our own session: a random
// token in an httpOnly cookie, stored here only as its SHA-256, like board
// edit tokens. Nothing in this file reads cookies, so it runs in tests too;
// auth.ts is the Next.js side.

export const SESSION_COOKIE = "sx_session";
export const SESSION_DAYS = 30;
/** last_seen_at and expires_at move at most this often, so reads stay reads. */
const SLIDE_MS = 60 * 60 * 1000;
export const TRIAL_DAYS = 7;
/** How long the step between the email link and the authenticator code lasts. */
export const PENDING_MINUTES = 10;

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
const iso = (d: unknown) => (d instanceof Date ? d.toISOString() : d == null ? null : String(d));

export type SessionUser = { id: string; email: string; plan: Plan; planStatus: string | null; seats: number;
  renewsAt: string | null; cancelAt: string | null; paddleCustomerId: string | null; paddleSubscriptionId: string | null;
  /** End of the seven-day Pro trial. */
  trialEndsAt: string | null;
  /** When two-step sign-in (authenticator app) was turned on, or null when it is off. */
  twoStepSince: string | null };

const userColumns = (sql: ReturnType<typeof database>) =>
  sql`u.id, u.email, u.plan, u.plan_status, u.plan_seats, u.plan_renews_at, u.plan_cancel_at, u.paddle_customer_id, u.paddle_subscription_id,
    u.trial_ends_at, u.totp_enabled_at`;

const toUser = (r: Record<string, unknown>): SessionUser => ({
  id: r.id as string, email: (r.email as string) ?? "", plan: r.plan as Plan, planStatus: (r.plan_status as string | null) ?? null,
  seats: Number(r.plan_seats ?? 1), renewsAt: iso(r.plan_renews_at), cancelAt: iso(r.plan_cancel_at),
  paddleCustomerId: (r.paddle_customer_id as string | null) ?? null, paddleSubscriptionId: (r.paddle_subscription_id as string | null) ?? null,
  trialEndsAt: iso(r.trial_ends_at), twoStepSince: iso(r.totp_enabled_at),
});

/** The users row for a Supabase user who just proved their address. Same id as auth.users. A new row starts the trial. */
export async function upsertUser(id: string, email: string): Promise<SessionUser> {
  const sql = database();
  const [row] = await sql`INSERT INTO users AS u (id, email, last_sign_in_at, trial_ends_at)
    VALUES (${id}, ${email.toLowerCase()}, now(), now() + make_interval(days => ${TRIAL_DAYS}))
    ON CONFLICT (id) DO UPDATE SET email=excluded.email, last_sign_in_at=now(), updated_at=now()
    RETURNING ${userColumns(sql)}`;
  return toUser(row);
}

export async function userById(id: string): Promise<SessionUser | null> {
  const sql = database();
  const [row] = await sql`SELECT ${userColumns(sql)} FROM users u WHERE u.id=${id}`;
  return row ? toUser(row) : null;
}

/**
 * A new session. `pending` is the step between the email link and the
 * authenticator code: it lasts ten minutes and signs nobody in (two-step.ts).
 */
export async function createSession(userId: string, userAgent: string | null, pending?: { next: string }): Promise<{ token: string; expires: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + (pending ? PENDING_MINUTES * 60_000 : SESSION_DAYS * 86_400_000));
  const sql = database();
  // This user's expired rows go when a new one comes, so the table does not grow forever.
  await sql`DELETE FROM sessions WHERE user_id=${userId} AND expires_at <= now()`;
  await sql`INSERT INTO sessions (token_hash, user_id, user_agent, expires_at, mfa_pending, next_path)
    VALUES (${hashToken(token)}, ${userId}, ${userAgent?.slice(0, 300) ?? null}, ${expires}, ${Boolean(pending)}, ${pending?.next ?? null})`;
  return { token, expires };
}

/**
 * The signed-in user for a session token, or null; never for a pending one.
 * Slides the expiry forward on use, at most hourly, and says when it did
 * (`renewed`) so the caller renews the cookie too: the browser drops the
 * cookie at its own Max-Age whatever the database says.
 */
export async function lookupSession(token: string | undefined | null): Promise<{ user: SessionUser; renewed: Date | null } | null> {
  if (!token || token.length > 200) return null;
  const sql = database();
  const hash = hashToken(token);
  const [row] = await sql`SELECT ${userColumns(sql)}, s.last_seen_at FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=${hash} AND s.expires_at > now() AND NOT s.mfa_pending`;
  if (!row) return null;
  let renewed: Date | null = null;
  if (Date.now() - new Date(row.last_seen_at as string).getTime() > SLIDE_MS) {
    renewed = new Date(Date.now() + SESSION_DAYS * 86_400_000);
    await sql`UPDATE sessions SET last_seen_at=now(), expires_at=${renewed} WHERE token_hash=${hash}`;
  }
  return { user: toUser(row), renewed };
}

export async function userForSession(token: string | undefined | null): Promise<SessionUser | null> {
  return (await lookupSession(token))?.user ?? null;
}

export async function endSession(token: string | undefined | null) {
  if (token) await database()`DELETE FROM sessions WHERE token_hash=${hashToken(token)}`;
}

/** Signs the user out on every device, and drops any half-finished two-step sign-in. */
export async function endAllSessions(userId: string) {
  await database()`DELETE FROM sessions WHERE user_id=${userId}`;
}

/** The Set-Cookie value for a session token, for route handlers (auth.ts sets it through next/headers). */
export function sessionCookie(token: string, expires: Date): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${token}; Path=/; Expires=${expires.toUTCString()}; Max-Age=${SESSION_DAYS * 86_400}; HttpOnly; SameSite=Lax${secure}`;
}

/** The account as the API shows it: no Paddle ids. */
export function toAccount(user: SessionUser, access: Plan): Account {
  return { id: user.id, email: user.email, plan: user.plan, planStatus: user.planStatus, seats: user.seats,
    renewsAt: user.renewsAt, cancelAt: user.cancelAt, trialEndsAt: user.trialEndsAt, access, twoStep: Boolean(user.twoStepSince) };
}

/** One cookie value out of a Cookie header, for route handlers tested outside Next.js. */
export function cookieFrom(request: Request, name: string): string | null {
  for (const part of request.headers.get("cookie")?.split(";") ?? []) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) {
      try { return decodeURIComponent(part.slice(i + 1).trim()); } catch { return null; }
    }
  }
  return null;
}

export const userForRequest = (request: Request) => userForSession(cookieFrom(request, SESSION_COOKIE));
