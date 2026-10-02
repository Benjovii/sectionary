// The search acceptance queries (SEC-17) and how a result is judged relevant.
// Shared by search-eval.ts (against a running app) and the deterministic
// acceptance check (web/scripts/search-acceptance.mts, against a local
// database built from the committed fixtures).
//
// A judge reads a result's headline and its whole stored copy, which is what
// search indexes (the API returns only the first 400 characters, so search:eval
// over HTTP under-counts). It is deliberately strict: a "subscription picker
// with savings badge" is a purchase option that offers a recurring delivery AND
// a saving for it. A newsletter sign-up promising 10% off is not one, and
// neither is a menu with a "Subscriptions" link.

export interface Judged { headline?: string | null; text: string }
export interface AcceptanceQuery {
  q: string;
  /** Relevance judge; queries without one are listed for reading, not scored. */
  relevant?: (b: Judged) => boolean;
  /** Relevant results wanted in the top 10. */
  min?: number;
}

const flat = (b: Judged) => `${b.headline ?? ""} ${b.text}`.replace(/\s+/g, " ");

/** Buying on repeat: subscribe & save, one-time vs subscription, a delivery cadence. */
const RECURRING_PURCHASE = /subscribe\s*(?:&|and|\+|n)\s*save|one[- ]time\s+purchase|(?:deliver(?:y|ed|s)?|ships?|shipped|send)\s+every\s+\d*\s*(?:days?|weeks?|months?)|every\s+\d+\s+(?:days?|weeks?|months?)|auto-?ship|auto-?renew|subscription\s+(?:price|plan|option|frequency)|(?:monthly|recurring)\s+subscription|subscribe\s+(?:&|and)\s+get|delivery\s+frequency/i;
/** A saving on it. */
const SAVING = /\bsav(?:e|es|ings?)\b|\d+\s?%\s?off|best\s+value|discount|\bfree\s+shipping\b/i;
/** Sign-up forms are their own block type (newsletter), never a subscription picker. */
const NEWSLETTER = /newsletter|email\s+address|sign\s*up\s+(?:for|to)\s+(?:our|the)\s+(?:emails?|newsletter|list)|unsubscribe/i;

export const offersSavingSubscription = (b: Judged) => {
  const t = flat(b);
  return RECURRING_PURCHASE.test(t) && SAVING.test(t) && !NEWSLETTER.test(t);
};

export const ACCEPTANCE_QUERIES: AcceptanceQuery[] = [
  { q: "subscription picker with savings badge", relevant: offersSavingSubscription, min: 3 },
  { q: "subscripton pickr with savngs badge", relevant: offersSavingSubscription, min: 3 },
  { q: "newsletter signup with discount" },
  { q: "product reviews with star rating" },
  { q: "size guide" },
];
