import { createHmac, timingSafeEqual } from "node:crypto";
import type { Plan } from "@/contracts/api";
import { database } from "@/server/db";
import { UUID } from "@/server/blocks";
import { planForPrice } from "@/server/plans";

// Paddle Billing (SEC-28). Paddle is the merchant of record: checkout runs in
// Paddle.js on the account page, and Paddle tells us what happened through
// webhooks to /api/paddle/webhook. The plan on `users` changes only here.
//
// A webhook is trusted when its Paddle-Signature header verifies against
// PADDLE_WEBHOOK_SECRET. Every event is stored in paddle_events in the same
// transaction as its effect, so a redelivery does nothing and a failure rolls
// back and is retried by Paddle.

export type PaddleEvent = { event_id: string; event_type: string; occurred_at: string; data: Record<string, unknown> };

/** Paddle's tolerance advice: reject signatures older than a few minutes (replays). */
const MAX_AGE_S = 300;

/** Checks `Paddle-Signature: ts=...;h1=...` (h1 may repeat while a secret rotates) against the raw body. */
export function verifySignature(rawBody: string, header: string | null, secret: string, nowMs = Date.now()): boolean {
  if (!header || !secret) return false;
  let ts = "";
  const signatures: string[] = [];
  for (const part of header.split(";")) {
    const [k, v] = part.split("=", 2).map((s) => s?.trim());
    if (k === "ts") ts = v ?? "";
    else if (k === "h1" && v) signatures.push(v);
  }
  if (!/^\d+$/.test(ts) || !signatures.length) return false;
  if (Math.abs(nowMs / 1000 - Number(ts)) > MAX_AGE_S) return false;
  const expected = createHmac("sha256", secret).update(`${ts}:${rawBody}`).digest();
  return signatures.some((sig) => {
    const given = Buffer.from(sig, "hex");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

/** Subscription states that keep the paid plan. past_due keeps it while Paddle retries the card. */
const KEEPS_PLAN = new Set(["active", "trialing", "past_due"]);

type Sub = {
  id?: string; status?: string; customer_id?: string; custom_data?: Record<string, unknown> | null;
  items?: { price?: { id?: string }; quantity?: number }[];
  next_billed_at?: string | null; current_billing_period?: { ends_at?: string } | null;
  scheduled_change?: { action?: string; effective_at?: string } | null; canceled_at?: string | null;
};

export type EventOutcome = "duplicate" | "ignored" | "unmatched" | "stale" | "other_subscription" | "unknown_price" | `applied:${Plan}`;

export async function handlePaddleEvent(event: PaddleEvent): Promise<EventOutcome> {
  if (!event?.event_id || !event.event_type || !event.occurred_at) throw new Error("Not a Paddle event");
  const sql = database();
  return sql.begin(async (tx) => {
    const [fresh] = await tx`INSERT INTO paddle_events (event_id, event_type, occurred_at, outcome, payload)
      VALUES (${event.event_id}, ${event.event_type}, ${event.occurred_at}, 'processing', ${tx.json(event as never)})
      ON CONFLICT (event_id) DO NOTHING RETURNING event_id`;
    if (!fresh) return "duplicate" as const;

    const finish = async (outcome: EventOutcome, userId: string | null = null) => {
      await tx`UPDATE paddle_events SET outcome=${outcome}, user_id=${userId} WHERE event_id=${event.event_id}`;
      return outcome;
    };
    if (!event.event_type.startsWith("subscription.")) return finish("ignored");

    const sub = event.data as Sub;
    if (!sub.id || !sub.status) return finish("ignored");
    const claimed = typeof sub.custom_data?.userId === "string" && UUID.test(sub.custom_data.userId) ? sub.custom_data.userId : null;
    // Who: the account that opened checkout (custom data), else whoever already holds this subscription or customer.
    const [user] = await tx`SELECT id, plan, plan_event_at, paddle_subscription_id FROM users
      WHERE id=${claimed} OR paddle_subscription_id=${sub.id} OR paddle_customer_id=${sub.customer_id ?? null}
      ORDER BY (id=${claimed}) DESC NULLS LAST, (paddle_subscription_id=${sub.id}) DESC NULLS LAST LIMIT 1 FOR UPDATE`;
    if (!user) return finish("unmatched");
    if (user.plan_event_at && new Date(event.occurred_at) < new Date(user.plan_event_at)) return finish("stale", user.id);

    const keeps = KEEPS_PLAN.has(sub.status);
    // An old subscription ending must not take away the plan a newer one pays for.
    if (!keeps && user.paddle_subscription_id && user.paddle_subscription_id !== sub.id) return finish("other_subscription", user.id);

    let plan: Plan = "free";
    let seats = 1;
    if (keeps) {
      const item = sub.items?.find((i) => planForPrice(i.price?.id));
      const paid = planForPrice(item?.price?.id);
      if (!paid) return finish("unknown_price", user.id);
      plan = paid;
      seats = paid === "team" ? Math.max(1, Number(item?.quantity) || 1) : 1;
    }
    const renewsAt = keeps ? (sub.next_billed_at ?? sub.current_billing_period?.ends_at ?? null) : null;
    const cancelAt = sub.scheduled_change?.action === "cancel" ? (sub.scheduled_change.effective_at ?? null)
      : sub.status === "canceled" ? (sub.canceled_at ?? event.occurred_at) : null;

    await tx`UPDATE users SET plan=${plan}, plan_status=${sub.status}, plan_seats=${seats},
      plan_renews_at=${renewsAt}, plan_cancel_at=${cancelAt}, plan_event_at=${event.occurred_at},
      paddle_customer_id=coalesce(${sub.customer_id ?? null}, paddle_customer_id), paddle_subscription_id=${sub.id}, updated_at=now()
      WHERE id=${user.id}`;
    return finish(`applied:${plan}`, user.id);
  });
}

const apiBase = () => (process.env.PADDLE_ENV === "production" ? "https://api.paddle.com" : "https://sandbox-api.paddle.com");

/**
 * A one-off link to Paddle's customer portal: invoices, card, plan changes and
 * cancelling. `cancel` goes straight to the cancel page of the subscription.
 */
export async function portalUrl(customerId: string, subscriptionId: string | null, target: "overview" | "cancel" = "overview"): Promise<string> {
  const key = process.env.PADDLE_API_KEY;
  if (!key) throw new Error("PADDLE_API_KEY is not configured");
  const res = await fetch(`${apiBase()}/customers/${encodeURIComponent(customerId)}/portal-sessions`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify(subscriptionId ? { subscription_ids: [subscriptionId] } : {}),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Paddle portal session failed: HTTP ${res.status}`);
  const { data } = (await res.json()) as { data: { urls: { general: { overview: string }; subscriptions?: { id: string; cancel_subscription: string }[] } } };
  const cancel = data.urls.subscriptions?.find((s) => s.id === subscriptionId)?.cancel_subscription;
  return target === "cancel" && cancel ? cancel : data.urls.general.overview;
}
