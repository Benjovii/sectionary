// npm test: the relevance judge behind the search acceptance queries.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ACCEPTANCE_QUERIES, offersSavingSubscription } from "./search-queries.js";

test("a purchase option that saves on a recurring delivery is relevant", () => {
  for (const text of [
    "One-time purchase $39.99 Subscribe & Save 20% $31.99 Deliver every 30 days",
    "Subscribe and save 15% on every order. Ships every 4 weeks, cancel anytime",
    "Auto-ship: save 10% and get free shipping",
    "Subscription price $24 (save $6) Delivery frequency: every 2 months",
  ]) assert.equal(offersSavingSubscription({ text }), true, text);
});

test("newsletters, menus and FAQs that merely mention subscribing are not", () => {
  for (const [headline, text] of [
    ["Sign up to the Penguin Newsletter", "For latest offers + 10% off your first order. Subscribe"],
    [null, "Get Your First Box for Free with code FREEBOX Subscriptions Gifting School Orders"],
    ["FAQs", "Does Nanit require a subscription? How much is Nanit Insights per month?"],
    ["Not ready to commit?", "No subscription needed. Try a single animal EDventure, one-time purchase."],
    ["Join our pack!", "Exclusive deals for pet parents. Enter your email address. Save 10%. Subscribe and save on emails"],
  ] as [string | null, string][]) assert.equal(offersSavingSubscription({ headline, text }), false, text);
});

test("both spellings of the acceptance query are judged the same way and need 3 of the top 10", () => {
  const scored = ACCEPTANCE_QUERIES.filter((q) => q.relevant);
  assert.deepEqual(scored.map((q) => q.q), ["subscription picker with savings badge", "subscripton pickr with savngs badge"]);
  for (const q of scored) {
    assert.equal(q.relevant, offersSavingSubscription);
    assert.equal(q.min, 3);
  }
});
