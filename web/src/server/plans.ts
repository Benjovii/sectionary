import type { Plan } from "@/contracts/api";

// Plans (SEC-28). Free browses with a daily cap on block detail views and has
// no boards; Pro and Team have both without limits. Team is Pro billed per seat
// (inviting the other seats is a later task).
//
// The gates are off until PLAN_GATES=on, so turning on auth and billing does
// not lock the team out of boards on staging. Turn them on at launch.

export const gatesOn = () => process.env.PLAN_GATES === "on";

/** Distinct blocks a Free viewer can open per UTC day. */
export function freeDailyViews(): number {
  const n = Number(process.env.FREE_DAILY_VIEWS);
  return Number.isInteger(n) && n > 0 ? n : 25;
}

export const isPaid = (plan: Plan | null | undefined) => plan === "pro" || plan === "team";

/** Null when the viewer has no cap. */
export const viewLimit = (plan: Plan | null | undefined) => (!gatesOn() || isPaid(plan) ? null : freeDailyViews());

export const canUseBoards = (plan: Plan | null | undefined) => !gatesOn() || isPaid(plan);

export type Interval = "month" | "year";
export type PriceIds = Record<"pro" | "team", Partial<Record<Interval, string>>>;

/** Paddle price ids from the environment (pri_...). Missing ones are simply not offered. */
export function priceIds(): PriceIds {
  const env = (k: string) => process.env[k]?.trim() || undefined;
  return {
    pro: { month: env("PADDLE_PRICE_PRO_MONTH"), year: env("PADDLE_PRICE_PRO_YEAR") },
    team: { month: env("PADDLE_PRICE_TEAM_MONTH"), year: env("PADDLE_PRICE_TEAM_YEAR") },
  };
}

/** Which plan a Paddle price buys, or null for a price this app does not know. */
export function planForPrice(priceId: string | null | undefined): "pro" | "team" | null {
  if (!priceId) return null;
  const ids = priceIds();
  for (const plan of ["team", "pro"] as const) {
    if (Object.values(ids[plan]).includes(priceId)) return plan;
  }
  return null;
}
