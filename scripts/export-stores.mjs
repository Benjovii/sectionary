// Exports seeds/stores.validated.csv into the web app as web/public/sample/stores.json
// for the Sites page, until the database exists (SEC-10).
//   node scripts/export-stores.mjs [seeds/stores.validated.csv]
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const file = process.argv[2] || "seeds/stores.validated.csv";
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

const stores = parseCsv(text).map((r, i) => ({
  n: i + 1,
  host: r.final_host || r.host,
  brand: r.brand || r.title || r.host,
  title: r.title || null,
  platform: r.platform || null,
  builder: r.builder || null,
  theme: r.theme || null,
  themeVersion: r.theme_version || null,
  currency: r.currency || null,
  country: r.country || null,
  industry: r.industry || "other",
  industryScore: Number(r.industry_score) || 0,
  apps: r.apps ? r.apps.split("|") : [],
  collections: r.collections ? Number(r.collections) : null,
  rank: r.tranco_rank ? Number(r.tranco_rank) : null,
  mentions: Number(r.mentions) || 0,
  sources: r.sources ? r.sources.split("|") : [],
  validatedAt: r.validated_at || null,
}));

const outDir = path.join("web", "public", "sample");
mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, "stores.json"), JSON.stringify({ generatedAt: new Date().toISOString(), stores }));
console.log(`${stores.length} stores -> ${path.join(outDir, "stores.json")}`);
