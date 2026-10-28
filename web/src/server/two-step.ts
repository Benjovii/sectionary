import { database } from "@/server/db";
import { hashToken } from "@/server/accounts";
import { hashRecovery, matchStep, newRecoveryCodes, newSecret, normaliseRecovery, openSecret, sealSecret } from "@/server/totp";

// Two-step sign-in, the database side (totp.ts makes and checks the codes).
//
// Turning it on: begin() keeps a new secret as totp_pending_secret, the app
// shows it as a QR code, and confirm() with a code from the app moves it to
// totp_secret and hands back ten recovery codes (shown once, stored hashed).
//
// Signing in with it on: after the email link the browser gets a *pending*
// session (accounts.createSession with pending) instead of a real one, and
// finish() swaps it for a real session once the code checks out. Five wrong
// codes end the pending session; the person starts again from the email.

export const MAX_ATTEMPTS = 5;

export class TwoStepCodeError extends Error {
  readonly code: "INVALID" | "LOCKED" | "EXPIRED" | "NOT_ON";
  constructor(message: string, code: TwoStepCodeError["code"]) {
    super(message);
    this.code = code;
  }
}

/** Starts setup: a new secret, not active until confirmed. Returns it for the QR code. */
export async function beginSetup(userId: string): Promise<string> {
  const secret = newSecret();
  await database()`UPDATE users SET totp_pending_secret=${sealSecret(secret)} WHERE id=${userId}`;
  return secret;
}

/** The secret being set up, so the setup screen survives a reload. */
export async function pendingSetupSecret(userId: string): Promise<string | null> {
  const [row] = await database()`SELECT totp_pending_secret FROM users WHERE id=${userId}`;
  return row?.totp_pending_secret ? openSecret(row.totp_pending_secret as string) : null;
}

async function replaceRecoveryCodes(tx: ReturnType<typeof database>, userId: string): Promise<string[]> {
  const codes = newRecoveryCodes();
  await tx`DELETE FROM recovery_codes WHERE user_id=${userId}`;
  for (const code of codes) await tx`INSERT INTO recovery_codes (user_id, code_hash) VALUES (${userId}, ${hashRecovery(code)})`;
  return codes;
}

/** Finishes setup with a code from the app. Returns the recovery codes, or throws. */
export async function confirmSetup(userId: string, code: string): Promise<string[]> {
  const sql = database();
  return sql.begin(async (tx) => {
    const [row] = await tx`SELECT totp_pending_secret FROM users WHERE id=${userId} FOR UPDATE`;
    if (!row?.totp_pending_secret) throw new TwoStepCodeError("Start again: press Turn on.", "EXPIRED");
    const secret = openSecret(row.totp_pending_secret as string);
    const step = matchStep(secret, code, null);
    if (step === null) throw new TwoStepCodeError("That code didn't match. Check the app shows Sectionary and try the newest code.", "INVALID");
    await tx`UPDATE users SET totp_secret=totp_pending_secret, totp_pending_secret=NULL, totp_enabled_at=now(), totp_last_step=${step} WHERE id=${userId}`;
    return replaceRecoveryCodes(tx as unknown as ReturnType<typeof database>, userId);
  }) as Promise<string[]>;
}

/** Checks a code (app or recovery) for a user who has two-step on; records it so it cannot be used again. */
async function useCode(tx: ReturnType<typeof database>, userId: string, code: string): Promise<boolean> {
  const [row] = await tx`SELECT totp_secret, totp_last_step FROM users WHERE id=${userId} FOR UPDATE`;
  if (!row?.totp_secret) throw new TwoStepCodeError("Two-step sign-in is not on for this account.", "NOT_ON");
  const plain = code.trim();
  if (/^\d[\d\s]*$/.test(plain)) {
    const step = matchStep(openSecret(row.totp_secret as string), plain, row.totp_last_step == null ? null : Number(row.totp_last_step));
    if (step === null) return false;
    await tx`UPDATE users SET totp_last_step=${step} WHERE id=${userId}`;
    return true;
  }
  if (normaliseRecovery(plain).length !== 12) return false;
  const used = await tx`UPDATE recovery_codes SET used_at=now() WHERE user_id=${userId} AND code_hash=${hashRecovery(plain)} AND used_at IS NULL RETURNING 1`;
  return used.length > 0;
}

/** Turns two-step off, or makes new recovery codes; both need a current code. */
export async function disable(userId: string, code: string) {
  const sql = database();
  await sql.begin(async (tx) => {
    const t = tx as unknown as ReturnType<typeof database>;
    if (!(await useCode(t, userId, code))) throw new TwoStepCodeError("That code didn't match.", "INVALID");
    await tx`UPDATE users SET totp_secret=NULL, totp_pending_secret=NULL, totp_enabled_at=NULL, totp_last_step=NULL WHERE id=${userId}`;
    await tx`DELETE FROM recovery_codes WHERE user_id=${userId}`;
  });
}

export async function regenerateRecoveryCodes(userId: string, code: string): Promise<string[]> {
  const sql = database();
  return sql.begin(async (tx) => {
    const t = tx as unknown as ReturnType<typeof database>;
    if (!(await useCode(t, userId, code))) throw new TwoStepCodeError("That code didn't match.", "INVALID");
    return replaceRecoveryCodes(t, userId);
  }) as Promise<string[]>;
}

export async function recoveryCodesLeft(userId: string): Promise<number> {
  const [{ n }] = await database()`SELECT count(*)::int AS n FROM recovery_codes WHERE user_id=${userId} AND used_at IS NULL`;
  return n;
}

/** The pending session behind a token, if it is still good: who is signing in and where they were going. */
export async function pendingSignIn(token: string | null | undefined): Promise<{ userId: string; email: string; next: string } | null> {
  if (!token || token.length > 200) return null;
  const [row] = await database()`SELECT s.user_id, s.next_path, u.email FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=${hashToken(token)} AND s.mfa_pending AND s.expires_at > now()`;
  return row ? { userId: row.user_id as string, email: (row.email as string) ?? "", next: (row.next_path as string | null) ?? "/account" } : null;
}

/**
 * The code for a pending sign-in. On success the pending session is gone and
 * the caller makes a real one; on a wrong code the attempt is counted, and the
 * fifth ends the pending session.
 */
export async function finishSignIn(token: string, code: string): Promise<{ userId: string; next: string }> {
  const sql = database();
  const hash = hashToken(token);
  const outcome = await sql.begin(async (tx) => {
    const t = tx as unknown as ReturnType<typeof database>;
    const [s] = await tx`SELECT user_id, next_path, mfa_attempts FROM sessions
      WHERE token_hash=${hash} AND mfa_pending AND expires_at > now() FOR UPDATE`;
    if (!s) return { error: new TwoStepCodeError("This sign-in timed out. Start again with a new email link.", "EXPIRED") };
    if (await useCode(t, s.user_id as string, code)) {
      await tx`DELETE FROM sessions WHERE token_hash=${hash}`;
      return { userId: s.user_id as string, next: (s.next_path as string | null) ?? "/account" };
    }
    const attempts = Number(s.mfa_attempts) + 1;
    if (attempts >= MAX_ATTEMPTS) {
      await tx`DELETE FROM sessions WHERE token_hash=${hash}`;
      return { error: new TwoStepCodeError("Too many wrong codes. Start again with a new email link.", "LOCKED") };
    }
    await tx`UPDATE sessions SET mfa_attempts=${attempts} WHERE token_hash=${hash}`;
    const left = MAX_ATTEMPTS - attempts;
    return { error: new TwoStepCodeError(`That code didn't match. ${left} ${left === 1 ? "try" : "tries"} left.`, "INVALID") };
  });
  // Thrown outside the transaction, so the attempt count is committed, not rolled back.
  if ("error" in outcome && outcome.error) throw outcome.error;
  return outcome as { userId: string; next: string };
}
