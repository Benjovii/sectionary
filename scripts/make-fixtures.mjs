// Regenerates fixtures/ from local capture output and the web sample, so the
// platform and web lanes can work without running the crawler:
//   fixtures/manifests/<host>/<page>/manifest.json   real capture manifests (contract: manifest.ts)
//   fixtures/api/blocks.page1.json                   a /api/blocks response (contract: api.ts)
//   fixtures/api/stores.page1.json                   a /api/stores response
// Run from the repo root after a capture + export:  node scripts/make-fixtures.mjs
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const PAGES = [
  "myzoobox.com/home",
  "myzoobox.com/collections-edventures",
  "myzoobox.com/products-zoologist-club-sibling-kit-easy-reader-3-month-plan",
  "myzoobox.com/cart",
];

let manifests = 0;
for (const p of PAGES) {
  const from = path.join("data", p, "manifest.json");
  if (!existsSync(from)) {
    console.log(`skip (not captured locally): ${p}`);
    continue;
  }
  const to = path.join("fixtures", "manifests", p, "manifest.json");
  mkdirSync(path.dirname(to), { recursive: true });
  copyFileSync(from, to);
  manifests++;
}

const sample = path.join("web", "public", "sample");
const page = (items, limit) => ({ items: items.slice(0, limit), nextCursor: items.length > limit ? String(limit) : null, total: items.length });
mkdirSync(path.join("fixtures", "api"), { recursive: true });

const blocks = JSON.parse(readFileSync(path.join(sample, "blocks.json"), "utf8")).blocks;
writeFileSync(path.join("fixtures", "api", "blocks.page1.json"), JSON.stringify(page(blocks, 24), null, 2) + "\n");

const stores = JSON.parse(readFileSync(path.join(sample, "stores.json"), "utf8")).stores;
writeFileSync(path.join("fixtures", "api", "stores.page1.json"), JSON.stringify(page(stores, 25), null, 2) + "\n");

console.log(`${manifests} manifest(s), blocks page (24 of ${blocks.length}), stores page (25 of ${stores.length}) -> fixtures/`);
