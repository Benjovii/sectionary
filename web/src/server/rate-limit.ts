import { createHash } from "node:crypto";
import { database } from "@/server/db";

// Rate limits for whatever costs us or a person something when repeated:
// sign-in emails and codes, two-step codes, AI briefs. A counter per key and
// fixed window in Postgres (rate_limits, platform/drizzle/0011), so every
// server instance shares it, on Vercel and on AWS alike.
//
// Supabase limits sign-in emails and code checks per IP too, but every
// request reaches it from our server's IP, so its limits are one quota for
// all our users. These are per person and per visitor IP, in front of it.

export class RateLimitError extends Error {
  readonly code = "RATE_LIMITED";
  readonly retryAfter: number;
  constructor(message: string, retryAfter: number) {
    super(message);
    this.retryAfter = retryAfter;
  }
}

export type Limit = { key: string; max: number; windowSeconds: number };

/** Keys hold no email addresses or IPs in the clear, only a short hash. */
export const limitKey = (kind: string, value: string) =>
  `${kind}:${createHash("sha256").update(value.trim().toLowerCase()).digest("base64url").slice(0, 22)}`;

/**
 * Counts one hit against each limit and throws RateLimitError when any is over.
 * Without a database (a fresh clone, mock data) nothing is limited.
 */
export async function hit(limits: Limit[], message = "Too many attempts. Wait a few minutes, then try again."): Promise<void> {
  if (!process.env.DATABASE_URL) return;
  const sql = database();
  for (const { key, max, windowSeconds } of limits) {
    const [row] = await sql`INSERT INTO rate_limits AS r (key, window_start, hits)
      VALUES (${key}, to_timestamp(floor(extract(epoch FROM now())::float8 / ${windowSeconds}::int) * ${windowSeconds}::int), 1)
      ON CONFLICT (key, window_start) DO UPDATE SET hits = r.hits + 1
      RETURNING hits, extract(epoch FROM (r.window_start + make_interval(secs => ${windowSeconds}::int) - now()))::int AS left_s`;
    if (Number(row.hits) > max) throw new RateLimitError(message, Math.max(1, Number(row.left_s)));
  }
  // Windows that ended a day ago go now and then, so the table stays small.
  if (Math.random() < 0.01) await sql`DELETE FROM rate_limits WHERE window_start < now() - interval '1 day'`;
}

/**
 * The visitor's IP from X-Forwarded-For. Each proxy appends the address it
 * saw, so the trustworthy entry is the one added by our own outermost proxy:
 * TRUSTED_PROXY_HOPS from the end (default 1: Vercel, or one AWS load
 * balancer; 2 for CloudFront in front of a load balancer). Anything left of it
 * was sent by the client and can be made up.
 */
export function clientIp(headers: Headers): string {
  const hops = Math.max(1, Number(process.env.TRUSTED_PROXY_HOPS) || 1);
  const chain = (headers.get("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (chain.length) return chain[Math.max(0, chain.length - hops)];
  return headers.get("x-real-ip")?.trim() || "unknown";
}
