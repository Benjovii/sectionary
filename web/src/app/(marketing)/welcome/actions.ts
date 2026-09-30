"use server";

import { headers } from "next/headers";
import { database } from "@/server/db";

export type WaitlistState =
  | { status: "idle" }
  | { status: "joined"; email: string }
  | { status: "error"; message: string; email: string };

// Deliberately loose: one @, something either side, a dot in the domain. The
// confirmation email (later) is the real check; this only catches typos.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * SEC-25 waitlist. One row per address in `waitlist` (platform/drizzle/0002).
 * Joining twice reads as joining once, so the form never tells anyone whether
 * an address was already on the list.
 */
export async function joinWaitlist(_prev: WaitlistState, form: FormData): Promise<WaitlistState> {
  const email = String(form.get("email") ?? "").trim();
  const source = String(form.get("source") ?? "landing").slice(0, 40);

  // Honeypot: a field people never see. Bots fill it; pretend it worked.
  if (form.get("company")) return { status: "joined", email };

  if (!email) return { status: "error", message: "Enter your email address.", email };
  if (email.length > 254 || !EMAIL.test(email)) {
    return { status: "error", message: "That doesn't look like an email address. Check for a typo.", email };
  }

  const h = await headers();
  const referrer = h.get("referer")?.slice(0, 500) ?? null;
  const userAgent = h.get("user-agent")?.slice(0, 500) ?? null;

  if (!process.env.DATABASE_URL && process.env.NODE_ENV === "development") {
    // A fresh clone has no database; let the form be exercised anyway.
    console.info(`[waitlist] would add ${email} (source: ${source}); DATABASE_URL is not set`);
    return { status: "joined", email };
  }

  try {
    await database()`
      INSERT INTO waitlist (email, source, referrer, user_agent)
      VALUES (${email}, ${source}, ${referrer}, ${userAgent})
      ON CONFLICT ((lower(email))) DO NOTHING`;
    return { status: "joined", email };
  } catch (error) {
    console.error("[waitlist]", error);
    return { status: "error", message: "We couldn't save that just now. Try again in a minute.", email };
  }
}
