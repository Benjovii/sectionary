// Search check (SEC-17): run the acceptance queries against a running web app
// and print the top 10 for each, so relevance can be judged by eye.
//
//   npm run search:eval                               # http://localhost:3000
//   npm run search:eval -- https://sectionary.example # any deployment
//
// "Done when": "subscription picker with savings badge" returns relevant blocks
// in the top 10. A block is flagged relevant here when its copy offers a
// subscription and a saving; that is a rough stand-in for a person's judgement
// (it cannot see the screenshot or the AI description), so read the list too.

import type { BlocksResponse } from "../../web/src/contracts/api.js";

const base = (process.argv[2] ?? process.env.SEARCH_EVAL_URL ?? "http://localhost:3000").replace(/\/$/, "");

// A subscription offer (subscribe, a plan, a delivery schedule) next to a saving.
const offersSavingSubscription = (t: string) =>
  /subscri|\bplans?\b|deliver(y|ed)? every|auto-?ship/i.test(t) && /\bsav(e|es|ings?)\b|\d+\s?% off|best value|discount/i.test(t);

const QUERIES: { q: string; relevant?: (text: string) => boolean; min?: number }[] = [
  { q: "subscription picker with savings badge", relevant: offersSavingSubscription, min: 3 },
  { q: "subscripton pickr with savngs badge", relevant: offersSavingSubscription, min: 3 },
  { q: "newsletter signup with discount" },
  { q: "product reviews with star rating" },
  { q: "size guide" },
];

let failed = 0;
for (const { q, relevant, min = 1 } of QUERIES) {
  const res = await fetch(`${base}/api/blocks?${new URLSearchParams({ q, limit: "10" })}`);
  if (!res.ok) throw new Error(`${res.status} from ${base}/api/blocks: ${await res.text()}`);
  const body = (await res.json()) as BlocksResponse;
  const semantic = res.headers.get("x-search-semantic") === "true";
  const corrected = res.headers.get("x-search-corrected");
  console.log(`\n"${q}" · ${body.total} results · ${semantic ? "full text + semantic" : "full text only (no VOYAGE_API_KEY or no embeddings)"}${corrected ? ` · corrected ${corrected}` : ""}`);

  let hits = 0;
  body.items.forEach((b, i) => {
    const text = `${b.headline ?? ""} ${b.text}`;
    const ok = relevant?.(text);
    if (ok) hits += 1;
    const mark = relevant ? (ok ? "✓" : " ") : "·";
    console.log(`  ${mark} ${String(i + 1).padStart(2)}. ${b.host} · ${b.pageType} · ${b.typeHint} · ${(b.headline ?? text).replace(/\s+/g, " ").trim().slice(0, 70)}`);
  });
  if (relevant) {
    const pass = hits >= min;
    if (!pass) failed += 1;
    console.log(`  ${pass ? "PASS" : "FAIL"}: ${hits} of the top 10 look relevant (want ${min}+)`);
  }
}
process.exitCode = failed ? 1 : 0;
