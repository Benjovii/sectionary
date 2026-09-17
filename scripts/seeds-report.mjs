// Summarises seeds/stores.csv (and the liveness cache) so a harvest run can be
// judged at a glance:  node scripts/seeds-report.mjs [seeds/stores.csv]
import { readFileSync, existsSync } from "node:fs";

const file = process.argv[2] || "seeds/stores.csv";
const text = readFileSync(file, "utf8");

function parseCsv(t) {
  const rows = [];
  let row = [], cell = "", q = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) {
      if (ch === '"' && t[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && t[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((c) => c !== "")) rows.push(row);
      row = [];
    } else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  const [h, ...b] = rows;
  return b.map((r) => Object.fromEntries(h.map((k, i) => [k, r[i] ?? ""])));
}

const rows = parseCsv(text);
const cache = existsSync("seeds/live-cache.json") ? JSON.parse(readFileSync("seeds/live-cache.json", "utf8")) : {};
const count = (key) => {
  const m = {};
  for (const r of rows) for (const v of String(r[key] || "").split("|")) m[v || "(none)"] = (m[v || "(none)"] || 0) + 1;
  return Object.entries(m).sort((a, b) => b[1] - a[1]);
};
const ranked = rows.filter((r) => r.tranco_rank);
const ranks = ranked.map((r) => Number(r.tranco_rank)).sort((a, b) => a - b);
const pct = (n) => `${Math.round((100 * n) / rows.length)}%`;

console.log(`${file}: ${rows.length} stores`);
console.log(`  with a Tranco rank: ${ranked.length} (${pct(ranked.length)}); best ${ranks[0] ?? "-"}, median ${ranks[Math.floor(ranks.length / 2)] ?? "-"}, worst ${ranks[ranks.length - 1] ?? "-"}`);
console.log(`  within Tranco top 100k: ${ranks.filter((r) => r <= 100_000).length}, top 500k: ${ranks.filter((r) => r <= 500_000).length}`);
console.log("  platforms:", count("platform").map(([k, v]) => `${k} ${v} (${pct(v)})`).join(", "));
console.log("  sources:", count("sources").map(([k, v]) => `${k} ${v}`).join(", "));
console.log("  with brand:", rows.filter((r) => r.brand).length, "· with industry hint:", rows.filter((r) => r.industry_hint).length);
const multi = rows.filter((r) => Number(r.mentions) >= 2).length;
console.log(`  mentioned by 2+ sources/pages: ${multi}`);
const weak = rows.filter((r) => { const l = cache[r.host]; return l && !["shopify", "woocommerce", "bigcommerce", "magento", "salesforce"].includes(l.platform || "") && (l.signals || 0) < 5; });
console.log(`  weak store evidence (no e-com platform, under 5 signals): ${weak.length}`);
console.log("\n  top 30 by rank:");
for (const r of rows.slice(0, 30)) console.log(`   ${String(r.tranco_rank || "-").padStart(7)}  ${r.host.padEnd(32)} ${(r.platform || "?").padEnd(12)} ${(r.brand || r.title || "").slice(0, 40)}`);
if (weak.length) {
  console.log("\n  weakest evidence (first 15):");
  for (const r of weak.slice(0, 15)) console.log(`   ${r.host.padEnd(32)} ${(r.platform || "?").padEnd(12)} signals=${cache[r.host]?.signals ?? "?"}  ${(r.title || "").slice(0, 50)}`);
}
