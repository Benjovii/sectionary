// Picks a small, varied set of stores out of the validated seed list, for a
// pilot run. The same input always gives the same output.
//
//   npm run sample-seeds -- --n 50 --out seeds/pilot-50.csv
//
// Why not simply the first N rows: two thirds of the list is Shopify, the easy
// case (catalogue feeds, one theme structure). A pilot is there to find
// trouble, so Shopify is capped at half, every other platform family gets a
// share by its size (at least one store each), and inside a platform the
// picks rotate through the industries, clearest store evidence first, then
// best traffic rank.
//
//   --n 50               how many stores
//   --seed <file>        default seeds/stores.validated.csv
//   --out <file>         default seeds/pilot-<n>.csv
//   --shopify-share 0.5  the cap on Shopify's share
//   --db data/queue.sqlite   stores already in this crawl queue are left out
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { parseCsv, csvLine, type Row } from './csv.js';
import { Queue } from './queue.js';

type Options = { n: number; seed: string; out: string; shopifyShare: number; db: string };

function parseArgs(argv: string[]): Options {
  const o: Options = { n: 50, seed: 'seeds/stores.validated.csv', out: '', shopifyShare: 0.5, db: 'data/queue.sqlite' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--n') o.n = Number(argv[++i]);
    else if (a === '--seed') o.seed = argv[++i];
    else if (a === '--out') o.out = argv[++i];
    else if (a === '--shopify-share') o.shopifyShare = Number(argv[++i]);
    else if (a === '--db') o.db = argv[++i];
    else {
      console.error(`Unknown argument ${a}. See the header of src/sample-seeds.ts.`);
      process.exit(1);
    }
  }
  if (!o.out) o.out = `seeds/pilot-${o.n}.csv`;
  return o;
}

// Variants of one platform count as one family.
function family(platform: string): string {
  const p = (platform || 'unknown').toLowerCase();
  if (p.startsWith('squarespace')) return 'squarespace';
  if (p.startsWith('wix')) return 'wix';
  if (p === 'wordpress') return 'woocommerce';
  return p;
}

const rankOf = (r: Row) => (r.tranco_rank ? Number(r.tranco_rank) : Infinity);
// The validator lets through sites that merely run a shop plugin (publishers,
// agencies, software vendors; WooCommerce rows above all). Traffic rank alone
// puts exactly those first, so clear store evidence comes before rank.
const evidenceTier = (r: Row) => (Number(r.strong_signals || 0) >= 3 ? 0 : Number(r.strong_signals || 0) === 2 ? 1 : 2);
const byRank = (a: Row, b: Row) =>
  evidenceTier(a) - evidenceTier(b) || rankOf(a) - rankOf(b) || Number(b.mentions || 0) - Number(a.mentions || 0) || a.host.localeCompare(b.host);

/** Shares by size with at least `min` each, fractions settled by largest remainder. */
function quotas(sizes: Map<string, number>, total: number, min = 1): Map<string, number> {
  const out = new Map<string, number>();
  const keys = [...sizes.keys()];
  if (total < keys.length * min) {
    // Not enough room for everybody: the largest families first.
    for (const k of keys.sort((a, b) => sizes.get(b)! - sizes.get(a)!).slice(0, total)) out.set(k, 1);
    return out;
  }
  // Families too small to earn `min` proportionally get exactly `min`; the rest share what is left.
  let pool = total;
  let open = keys;
  for (;;) {
    const sum = open.reduce((s, k) => s + sizes.get(k)!, 0);
    const small = open.filter((k) => (sizes.get(k)! / sum) * pool < min);
    if (!small.length) break;
    for (const k of small) out.set(k, min);
    pool -= small.length * min;
    open = open.filter((k) => !small.includes(k));
  }
  const sum = open.reduce((s, k) => s + sizes.get(k)!, 0);
  const exact = open.map((k) => ({ k, x: (sizes.get(k)! / sum) * pool }));
  for (const e of exact) out.set(e.k, Math.floor(e.x));
  let left = pool - exact.reduce((s, e) => s + Math.floor(e.x), 0);
  for (const e of exact.sort((a, b) => (b.x % 1) - (a.x % 1) || a.k.localeCompare(b.k))) {
    if (left-- <= 0) break;
    out.set(e.k, out.get(e.k)! + 1);
  }
  return out;
}

/** `count` stores from one platform, rotating through its industries (largest first), best rank first inside each. */
function pick(all: Row[], count: number): Row[] {
  // Only the clearest stores when there are enough of them; rotating through
  // industries would otherwise reach into ones where a platform has no real store.
  let rows = all.filter((r) => evidenceTier(r) === 0);
  if (rows.length < count) rows = all.filter((r) => evidenceTier(r) <= 1);
  if (rows.length < count) rows = all;
  const byIndustry = new Map<string, Row[]>();
  for (const r of rows) {
    const key = r.industry || 'other';
    byIndustry.set(key, [...(byIndustry.get(key) || []), r]);
  }
  const lanes = [...byIndustry.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0])).map(([, list]) => list.sort(byRank));
  const out: Row[] = [];
  while (out.length < count && lanes.some((l) => l.length)) {
    for (const lane of lanes) {
      const next = lane.shift();
      if (next) out.push(next);
      if (out.length >= count) break;
    }
  }
  return out;
}

function main(): void {
  const o = parseArgs(process.argv.slice(2));
  const text = readFileSync(o.seed, 'utf8');
  const header = text.slice(0, text.search(/\r?\n/)).split(',');
  let rows = parseCsv(text).filter((r) => r.host);

  if (existsSync(o.db)) {
    const q = new Queue(o.db);
    const queued = new Set(q.hosts());
    q.close();
    const before = rows.length;
    rows = rows.filter((r) => !queued.has(r.host));
    if (before !== rows.length) console.log(`${before - rows.length} store(s) already in the crawl queue left out.`);
  }

  const families = new Map<string, Row[]>();
  for (const r of rows) families.set(family(r.platform), [...(families.get(family(r.platform)) || []), r]);

  const shopify = Math.min(Math.floor(o.n * o.shopifyShare), (families.get('shopify') || []).length);
  // A family needs a handful of stores before one of them says anything about the platform.
  const others = new Map([...families.entries()].filter(([k, list]) => k !== 'shopify' && list.length >= 5).map(([k, list]) => [k, list.length]));
  const share = quotas(others, o.n - shopify);
  share.set('shopify', shopify);

  const chosen: Row[] = [];
  for (const [fam, count] of [...share.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
    const picked = pick(families.get(fam) || [], count);
    chosen.push(...picked);
    console.log(`${fam.padEnd(14)} ${String(picked.length).padStart(2)}  ${picked.map((r) => r.host).join(', ')}`);
  }
  chosen.sort(byRank);

  writeFileSync(o.out, [header.join(','), ...chosen.map((r) => csvLine(header.map((h) => r[h] ?? '')))].join('\n') + '\n', 'utf8');
  const industries = new Set(chosen.map((r) => r.industry || 'other'));
  console.log(`\n${chosen.length} store(s), ${share.size} platform families, ${industries.size} industries -> ${o.out}`);
  console.log(`Run it: npm run crawl -- --seed ${o.out}`);
}

main();
