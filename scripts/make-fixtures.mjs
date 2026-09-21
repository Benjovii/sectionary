// Regenerates fixtures/ from local capture output and the web sample, so the
// platform and web lanes can work without running the crawler:
//   fixtures/manifests/<host>/<page>/manifest.json   real capture manifests (contract: manifest.ts)
//   fixtures/manifests/index.json                    what each one is, and which edge case it shows
//   fixtures/api/blocks.page1.json                   a /api/blocks response (contract: api.ts)
//   fixtures/api/stores.page1.json                   a /api/stores response
// Run from the repo root after a crawl + export:  node scripts/make-fixtures.mjs
//
// Which manifests: the fixed baseline below (tests may name these), then one
// store per platform out of data/queue.sqlite (three for Shopify, for theme
// variety) with its home, a product and a collection page, then up to two real
// examples of every awkward case an importer has to survive.
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const DATA = "data";
const BASELINE = [
  "myzoobox.com/home",
  "myzoobox.com/collections-edventures",
  "myzoobox.com/products-zoologist-club-sibling-kit-easy-reader-3-month-plan",
  "myzoobox.com/cart",
];
const PER_PLATFORM = { shopify: 3 };
const EDGE_EXAMPLES = 2;

const bareHost = (h) => h.replace(/^www\./, "");
const LOCALE_PATH = /^\/(?:[a-z]{2}(?:[-_][a-z]{2})?)(?:\/|$)/i;

/** The awkward cases, each a test over one parsed manifest. */
const EDGES = {
  "viewport-failed": (m) => Object.values(m.viewports).some((v) => "error" in v),
  "block-without-image": (m) => m.blocks.some((b) => b.file === null),
  "redirected-host": (m) => bareHost(new URL(m.site.origin).hostname) !== m.site.host,
  "region-in-path": (m) => LOCALE_PATH.test(new URL(m.page.url).pathname),
  "no-blocks": (m) => m.blocks.length === 0,
  "platform-unknown": (m) => !m.site.platform || m.site.platform === "unknown",
  "no-theme-info": (m) => m.site.platform === "shopify" && !m.site.theme,
};

// ---- Read every manifest on disk once ---------------------------------------
const all = []; // { dir, m }
for (const host of existsSync(DATA) ? readdirSync(DATA) : []) {
  const hostDir = path.join(DATA, host);
  if (host.startsWith("_") || host.startsWith(".") || !statSync(hostDir).isDirectory()) continue;
  for (const slug of readdirSync(hostDir)) {
    const file = path.join(hostDir, slug, "manifest.json");
    if (!existsSync(file)) continue;
    try {
      all.push({ dir: `${host}/${slug}`, m: JSON.parse(readFileSync(file, "utf8")) });
    } catch {
      /* half-written manifest from a killed run */
    }
  }
}

// ---- Choose -----------------------------------------------------------------
const chosen = new Map(); // dir -> Set(notes)
const add = (dir, note) => {
  if (!all.some((x) => x.dir === dir)) return false;
  if (!chosen.has(dir)) chosen.set(dir, new Set());
  if (note) chosen.get(dir).add(note);
  return true;
};

for (const dir of BASELINE) if (!add(dir, "baseline")) console.log(`skip (not captured locally): ${dir}`);

const dbFile = path.join(DATA, "queue.sqlite");
if (existsSync(dbFile)) {
  const db = new DatabaseSync(dbFile, { readOnly: true });
  const stores = db.prepare(`select host, coalesce(platform, 'unknown') platform from stores where status in ('done', 'partial') and pages_ok >= 2 order by (rank is null), rank, host`).all();
  db.close();
  const taken = {};
  for (const s of stores) {
    const limit = PER_PLATFORM[s.platform] ?? 1;
    if ((taken[s.platform] || 0) >= limit || s.host === "myzoobox.com") continue;
    const pages = all.filter((x) => x.m.site.host === s.host);
    let any = false;
    for (const type of ["home", "product", "collection"]) {
      const page = pages.find((x) => x.m.page.type === type);
      if (page) any = add(page.dir, `platform:${s.platform}`) || any;
    }
    if (any) taken[s.platform] = (taken[s.platform] || 0) + 1;
  }
}

for (const [name, test] of Object.entries(EDGES)) {
  let found = 0;
  // Prefer manifests already chosen, so the set stays small.
  for (const x of [...all.filter((x) => chosen.has(x.dir)), ...all.filter((x) => !chosen.has(x.dir))]) {
    if (found >= EDGE_EXAMPLES) break;
    let hit = false;
    try {
      hit = test(x.m);
    } catch {
      hit = false;
    }
    if (hit) {
      add(x.dir, `edge:${name}`);
      found++;
    }
  }
}

// ---- Write ------------------------------------------------------------------
const index = [];
for (const [dir, notes] of [...chosen.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  const to = path.join("fixtures", "manifests", dir, "manifest.json");
  mkdirSync(path.dirname(to), { recursive: true });
  copyFileSync(path.join(DATA, dir, "manifest.json"), to);
  const { m } = all.find((x) => x.dir === dir);
  index.push({ dir, host: m.site.host, platform: m.site.platform || "unknown", pageType: m.page.type, blocks: m.blocks.length, shows: [...notes].sort() });
}
writeFileSync(path.join("fixtures", "manifests", "index.json"), JSON.stringify(index, null, 2) + "\n");

const sample = path.join("web", "public", "sample");
const page = (items, limit) => ({ items: items.slice(0, limit), nextCursor: items.length > limit ? String(limit) : null, total: items.length });
mkdirSync(path.join("fixtures", "api"), { recursive: true });

const blocks = JSON.parse(readFileSync(path.join(sample, "blocks.json"), "utf8")).blocks;
writeFileSync(path.join("fixtures", "api", "blocks.page1.json"), JSON.stringify(page(blocks, 24), null, 2) + "\n");

const stores = JSON.parse(readFileSync(path.join(sample, "stores.json"), "utf8")).stores;
writeFileSync(path.join("fixtures", "api", "stores.page1.json"), JSON.stringify(page(stores, 25), null, 2) + "\n");

const edgeCount = (name) => index.filter((i) => i.shows.includes(`edge:${name}`)).length;
console.log(`${index.length} manifest(s) from ${new Set(index.map((i) => i.host)).size} store(s) and ${new Set(index.map((i) => i.platform)).size} platform(s) -> fixtures/manifests (see index.json)`);
console.log(`edge cases: ${Object.keys(EDGES).map((n) => `${n} ${edgeCount(n)}`).join(" · ")}`);
console.log(`blocks page (24 of ${blocks.length}), stores page (25 of ${stores.length}) -> fixtures/api`);
