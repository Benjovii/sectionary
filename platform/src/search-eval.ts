// Search check (SEC-17) against a running web app: the acceptance queries,
// the top 10 for each, and whether enough of them are relevant.
//
//   npm run search:eval                               # http://localhost:3000
//   npm run search:eval -- https://sectionary.example # any deployment
//
// This measures a live database, whose contents change. The deterministic
// acceptance check, which builds its own database from the committed fixtures,
// is `npm run search:acceptance` in web/. Queries and judges: search-queries.ts.

import type { BlocksResponse } from "../../web/src/contracts/api.js";
import { ACCEPTANCE_QUERIES } from "./search-queries.js";

const base = (process.argv[2] ?? process.env.SEARCH_EVAL_URL ?? "http://localhost:3000").replace(/\/$/, "");

let failed = 0;
for (const { q, relevant, min = 1 } of ACCEPTANCE_QUERIES) {
  const res = await fetch(`${base}/api/blocks?${new URLSearchParams({ q, limit: "10" })}`);
  if (!res.ok) throw new Error(`${res.status} from ${base}/api/blocks: ${await res.text()}`);
  const body = (await res.json()) as BlocksResponse;
  const semantic = res.headers.get("x-search-semantic") === "true";
  const corrected = res.headers.get("x-search-corrected");
  console.log(`\n"${q}" · ${body.total} results · ${semantic ? "full text + semantic" : "full text only (no VOYAGE_API_KEY or no embeddings)"}${corrected ? ` · corrected ${corrected}` : ""}`);

  let hits = 0;
  body.items.forEach((b, i) => {
    const text = `${b.headline ?? ""} ${b.text}`;
    const ok = relevant?.(b);
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
