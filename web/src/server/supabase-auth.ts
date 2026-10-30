// Supabase Auth over its REST API (GoTrue), with no Supabase client library,
// like the rest of the app. Supabase sends the email and checks the link; we
// only need the user's id and address back.
//
// The token-hash pattern (the one Next Level uses): the email template links
// to our own /auth/confirm?token_hash=...&type=email instead of Supabase's
// redirect with a PKCE code. A PKCE code only works in the browser that asked
// for it, so a link requested in Chrome on a laptop and opened in Mail on a
// phone, or in Safari after the in-app browser, fails. A token hash works in
// any browser. The same email carries the six-digit code ({{ .Token }}) for
// people who read mail on one device and sign in on another.
// The templates to paste into Supabase are in docs/AUTH-AND-BILLING.md.

type AuthErrorCode = "NOT_CONFIGURED" | "RATE_LIMITED" | "INVALID" | "EXPIRED" | "UPSTREAM";
export class AuthError extends Error {
  readonly code: AuthErrorCode;
  constructor(message: string, code: AuthErrorCode) {
    super(message);
    this.code = code;
  }
}

export type VerifiedUser = { id: string; email: string };

function config() {
  const url = process.env.SUPABASE_URL?.replace(/\/+$/, "");
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new AuthError("Sign-in is not configured yet (SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY).", "NOT_CONFIGURED");
  return { url, key };
}

export const authConfigured = () => Boolean(process.env.SUPABASE_URL && (process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY));

async function gotrue(path: string, body: unknown) {
  const { url, key } = config();
  let res: Response;
  try {
    res = await fetch(`${url}/auth/v1/${path}`, {
      method: "POST",
      // apikey only: a publishable key (sb_publishable_...) is not a JWT and is refused as a Bearer token.
      headers: { apikey: key, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    console.error("[auth]", error);
    throw new AuthError("We couldn't reach the sign-in service. Try again in a minute.", "UPSTREAM");
  }
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.ok) return json;
  const code = String(json.error_code ?? json.code ?? "");
  const message = String(json.msg ?? json.message ?? json.error_description ?? "");
  if (res.status === 429 || code.includes("rate_limit")) {
    throw new AuthError("Too many sign-in emails for now. Wait a minute, then try again.", "RATE_LIMITED");
  }
  if (code === "otp_expired" || /expired|invalid/i.test(message)) {
    throw new AuthError("That link or code has expired or was already used. Ask for a new one.", "EXPIRED");
  }
  console.error("[auth]", res.status, code, message);
  throw new AuthError("Sign-in failed. Ask for a new link and try again.", "UPSTREAM");
}

/**
 * Sends the magic link (and code). Creates the Supabase user on first sign-in.
 * `redirectTo` is where Supabase's own default email link lands after it
 * verifies (our /auth/callback); it must be in Supabase's Redirect URLs, or
 * Supabase falls back to the Site URL. Our template's link does not use it.
 */
export async function sendMagicLink(email: string, redirectTo?: string) {
  await gotrue(redirectTo ? `otp?redirect_to=${encodeURIComponent(redirectTo)}` : "otp", { email, create_user: true });
}

/**
 * Supabase's default email (the one sent until custom SMTP lets us change the
 * template) links to Supabase, which verifies it and redirects to
 * /auth/callback#access_token=... . The token is a Supabase JWT; asking
 * Supabase who it belongs to (GET /user) is what proves it. We keep nothing
 * of it but the id and address, then start our own session as usual.
 */
export async function userFromAccessToken(accessToken: string): Promise<VerifiedUser> {
  const { url, key } = config();
  if (!accessToken || accessToken.length > 4000) throw new AuthError("This sign-in link is incomplete. Ask for a new one.", "INVALID");
  let res: Response;
  try {
    res = await fetch(`${url}/auth/v1/user`, {
      headers: { apikey: key, authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    console.error("[auth]", error);
    throw new AuthError("We couldn't reach the sign-in service. Try again in a minute.", "UPSTREAM");
  }
  if (res.status === 401 || res.status === 403) throw new AuthError("That link has expired or was already used. Ask for a new one.", "EXPIRED");
  const json = (await res.json().catch(() => ({}))) as { id?: string; email?: string };
  if (!res.ok || !json.id || !json.email) {
    console.error("[auth] /user", res.status);
    throw new AuthError("Sign-in failed. Ask for a new link and try again.", "UPSTREAM");
  }
  return { id: json.id, email: json.email };
}

function userFrom(json: Record<string, unknown>): VerifiedUser {
  const user = json.user as { id?: string; email?: string } | undefined;
  if (!user?.id || !user.email) throw new AuthError("Sign-in failed. Ask for a new link and try again.", "UPSTREAM");
  return { id: user.id, email: user.email };
}

/** Link types Supabase puts in {{ .TokenHash }} links for an email sign-in. */
const LINK_TYPES = new Set(["email", "magiclink", "signup"]);

export async function verifyTokenHash(tokenHash: string, type: string): Promise<VerifiedUser> {
  if (!tokenHash || tokenHash.length > 200 || !LINK_TYPES.has(type)) throw new AuthError("This sign-in link is incomplete. Ask for a new one.", "INVALID");
  return userFrom(await gotrue("verify", { type, token_hash: tokenHash }));
}

export async function verifyCode(email: string, code: string): Promise<VerifiedUser> {
  const token = code.replace(/\s+/g, "");
  if (!/^\d{6,10}$/.test(token)) throw new AuthError("Enter the code from the email: six digits.", "INVALID");
  return userFrom(await gotrue("verify", { type: "email", email, token }));
}
