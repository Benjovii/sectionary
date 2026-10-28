import type { Plan, Feature } from "@/contracts/api";

// Plans (SEC-28) and the Free plan with its seven-day trial.
//
// Every account starts with Pro for seven days, no card (trial_ends_at). After
// that, unless it pays, it is Free:
//  - opens FREE_DAILY_VIEWS blocks a day (default 3);
//  - no Copy as brief, no time machine;
//  - boards are read-only: what it has stays readable, shareable and deletable,
//    but it cannot make boards or add to them;
//  - filters: Store and Block type only;
//  - no copy image, no source page link.
// Signed out: the wall only, with blurred previews; opening a block needs an account.
// Pro and Team have everything. Team is Pro billed per seat.
//
// Every gate asks `can(access, feature)`, where access is what the viewer gets
// today (accessOf). The gates are off until PLAN_GATES=on, so staging keeps
// working for the team. Turn them on at launch.

export const gatesOn = () => process.env.PLAN_GATES === "on";

/** Distinct blocks a Free viewer can open per UTC day. */
export function freeDailyViews(): number {
  const n = Number(process.env.FREE_DAILY_VIEWS);
  return Number.isInteger(n) && n > 0 ? n : 3;
}

export const isPaid = (plan: Plan | null | undefined) => plan === "pro" || plan === "team";

export const inTrial = (user: { trialEndsAt: string | null } | null | undefined, now = Date.now()) =>
  Boolean(user?.trialEndsAt && new Date(user.trialEndsAt).getTime() > now);

/** What the viewer gets today: their paid plan, Pro while the trial runs, else Free. Null when signed out. */
export function accessOf(user: { plan: Plan; trialEndsAt: string | null } | null | undefined): Plan | null {
  if (!user) return null;
  if (isPaid(user.plan)) return user.plan;
  return inTrial(user) ? "pro" : "free";
}

/** The filters Free and signed-out viewers keep: Store and Block type. */
export const FREE_FILTERS = new Set(["host", "block"]);

/** Whether `access` (from accessOf; null = signed out) may use `feature`. */
export function can(access: Plan | null, feature: Feature): boolean {
  if (!gatesOn() || isPaid(access)) return true;
  if (feature === "open") return access !== null;
  return false;
}

const FEATURES: Feature[] = ["open", "brief", "history", "boards", "filters", "copy-image", "source-link", "full-images"];
export const featuresFor = (access: Plan | null): Feature[] => FEATURES.filter((f) => can(access, f));

/** Null when the viewer has no cap. Signed-out viewers cannot open blocks at all (can(null, "open")). */
export const viewLimit = (access: Plan | null | undefined) => (!gatesOn() || isPaid(access) ? null : freeDailyViews());

export const canUseBoards = (access: Plan | null | undefined) => can(access ?? null, "boards");

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

/** The 402 every Pro-only endpoint answers for Free; 401 when signed out. */
export function planRequired(access: Plan | null, what: string) {
  return access === null
    ? Response.json({ error: `Sign in to use ${what}`, code: "SIGN_IN_REQUIRED" }, { status: 401 })
    : Response.json({ error: `${what} comes with Pro`, code: "PLAN_REQUIRED" }, { status: 402 });
}
