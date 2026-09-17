// Store validator and enricher (SEC-5).
//
//   npm run validate                        validate seeds/stores.csv, top up from candidates to 1,000
//   npm run validate -- --target 1000 --in seeds/candidates.csv
//   npm run validate -- --no-topup          only the rows of the input file
//
// For every host: one polite fetch of the home page (robots, pacing, bot UA),
// and for Shopify stores one more for /collections.json (industry words).
// Outputs:
//   seeds/stores.validated.csv   the stores that passed, enriched
//   seeds/rejected.csv           every drop with its reason
//   seeds/validate-cache.json    per-host results, reused for 7 days
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import * as cheerio from 'cheerio';
import { Politeness, PoliteError, hostOf, lanes, laneFor, retryAfterMs, installFetchCrashGuard, type Lane } from './polite.js';

installFetchCrashGuard();
import { classifyIndustry, detectApps, detectPlatform, guessCountry, isAdult, isParked, isSpam, looksLikeStore, storeSignals, type PlatformInfo, type Signals } from './fingerprints.js';

type Row = Record<string, string>;

type Verdict = {
  ok: boolean;
  reason: string | null; // dead | not-html | parked | adult | not-store | robots | blocklist | error
  status: number | null;
  finalHost: string | null;
  brand: string | null;
  title: string | null;
  description: string | null;
  info: PlatformInfo;
  apps: string[];
  signals: number;
  strong: number;
  weak: number;
  industry: string;
  industryScore: number;
  industryRunnerUp: string | null;
  country: string | null;
  collections: number | null;
  products: number | null;
  ts: number;
};

const EMPTY_INFO: PlatformInfo = { platform: null, builder: null, theme: null, themeVersion: null, currency: null, country: null, locale: null };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Fetch through the politeness rules (which take the platform lane); retries a 429 twice. */
async function laneFetch(polite: Politeness, lane: Lane, url: string, accept: string): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    const r = await polite.fetch(url, { headers: { accept } }, lane);
    if (r.status !== 429 || attempt >= 3) return r;
    await sleep(retryAfterMs(r));
  }
}

// ---- CSV (same dialect as harvest.ts) --------------------------------------
function parseCsv(text: string): Row[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      if (row.some((c) => c !== '')) rows.push(row);
      row = [];
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const [header, ...body] = rows;
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}
const csvCell = (v: unknown) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csvLine = (cells: unknown[]) => cells.map(csvCell).join(',');

const decode = (s: string) => cheerio.load(`<x>${s}</x>`)('x').text().replace(/\s+/g, ' ').trim();

// ---- One host ---------------------------------------------------------------
async function validateHost(polite: Politeness, host: string, platformHint: string | null, sources: string[]): Promise<Verdict> {
  const v: Verdict = {
    ok: false, reason: null, status: null, finalHost: null, brand: null, title: null, description: null, info: { ...EMPTY_INFO },
    apps: [], signals: 0, strong: 0, weak: 0, industry: 'other', industryScore: 0, industryRunnerUp: null, country: null, collections: null, products: null, ts: Date.now(),
  };
  let html = '';
  const lane = laneFor(platformHint);
  try {
    const r = await laneFetch(polite, lane, `https://${host}/`, 'text/html,*/*');
    v.status = r.status;
    v.finalHost = hostOf(r.url);
    if (r.status === 429) {
      // Still throttled after the retries: our problem, not the store's.
      // Not cached, so the next run tries again.
      v.reason = 'rate-limited';
      v.ts = 0;
      return v;
    }
    if (!r.ok) {
      // 401/403/503 from a live site is bot protection, not a dead store: the
      // real-browser crawler gets another go at these later.
      v.reason = [401, 403, 503].includes(r.status) ? 'blocked' : 'dead';
      return v;
    }
    const ct = r.headers.get('content-type') || '';
    if (!ct.includes('html')) {
      v.reason = 'not-html';
      return v;
    }
    html = (await r.text()).slice(0, 800_000);
  } catch (e) {
    v.reason = e instanceof PoliteError ? e.reason : 'dead';
    return v;
  }

  const $ = cheerio.load(html);
  v.title = decode($('title').first().text()).slice(0, 160) || null;
  v.description = ($('meta[name="description"]').attr('content') || $('meta[property="og:description"]').attr('content') || '').replace(/\s+/g, ' ').trim().slice(0, 300) || null;
  v.brand = ($('meta[property="og:site_name"]').attr('content') || '').trim().slice(0, 80) || (v.title ? v.title.split(/[|–—·:-]/)[0].trim().slice(0, 80) : null);
  v.info = detectPlatform(html);
  v.apps = detectApps(html);
  const sig = storeSignals(html);
  v.strong = sig.strong;
  v.weak = sig.weak;
  v.signals = sig.strong + sig.weak;
  v.country = guessCountry(v.finalHost || host, v.info);
  if (isSpam(v.title, v.description)) {
    v.reason = 'spam';
    return v;
  }

  const parked = isParked(html);
  if (parked || html.length < 1500) {
    v.reason = 'parked';
    return v;
  }
  if (!looksLikeStore(v.info.platform, sig, v.title, v.description, sources)) {
    v.reason = 'not-store';
    return v;
  }

  const navText = $('header a, nav a, [class*="menu"] a, footer a').map((_i, a) => $(a).text()).get().join(' ');
  const headings = $('h1, h2, h3').map((_i, h) => $(h).text()).get().join(' ');
  const body = $('body').text().replace(/\s+/g, ' ').slice(0, 20_000);
  const meta = [v.title || '', v.description || '', $('meta[name="keywords"]').attr('content') || ''].join(' ');
  const adult = isAdult(`${meta} ${navText}`);
  if (adult) {
    v.reason = 'adult';
    return v;
  }
  const buckets = [
    { text: meta, weight: 3 },
    { text: navText, weight: 2 },
    { text: headings, weight: 1.5 },
    { text: body, weight: 0.5 },
  ];
  let guess = classifyIndustry(buckets);

  // Shopify: when the home page alone gives a weak industry guess, the
  // catalogue feed names the categories outright. One extra request, only
  // when it can change the answer.
  if (v.info.platform === 'shopify' && guess.score < 8) {
    try {
      const origin = `https://${v.finalHost || host}`;
      const r = await laneFetch(polite, 'shopify', `${origin}/collections.json?limit=50`, 'application/json');
      if (r.ok && (r.headers.get('content-type') || '').includes('json')) {
        const j = (await r.json()) as { collections?: { title?: string; handle?: string }[] };
        const cols = j.collections || [];
        v.collections = cols.length;
        const titles = cols.map((c) => `${c.title || ''} ${(c.handle || '').replace(/-/g, ' ')}`).join(' ');
        guess = classifyIndustry([...buckets, { text: titles, weight: 2 }]);
      }
    } catch {
      /* fine, the home page still counts */
    }
  }
  v.industry = guess.industry;
  v.industryScore = Math.round(guess.score * 10) / 10;
  v.industryRunnerUp = guess.runnerUp;
  v.ok = true;
  return v;
}

// ---- Main -------------------------------------------------------------------
export const HEADER = ['host', 'final_host', 'brand', 'title', 'platform', 'builder', 'theme', 'theme_version', 'currency', 'country', 'locale', 'industry',
  'industry_score', 'industry_runner_up', 'apps', 'collections', 'store_signals', 'strong_signals', 'tranco_rank', 'mentions', 'sources', 'validated_at'];

async function main() {
  const args = process.argv.slice(2);
  const opt = (name: string, def: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : def;
  };
  const input = opt('--in', 'seeds/stores.csv');
  const target = Number(opt('--target', '1000'));
  const topup = !args.includes('--no-topup');
  const workers = Number(opt('--workers', '12'));

  await mkdir('seeds', { recursive: true });
  const polite = await Politeness.fromConfig();
  const t0 = Date.now();

  // Queue: the input rows first, then (if topping up) the rest of the
  // candidates. Among those, hosts that a store gallery listed come before
  // hosts only ever seen as a link in an article: a ranked candidate from an
  // article is usually a publisher or a tool, a gallery entry is a shop.
  // Within each group the harvest order (Tranco rank, then mentions) holds.
  const seen = new Set<string>();
  const queue: Row[] = [];
  for (const r of parseCsv(await readFile(input, 'utf8'))) if (r.host && !seen.has(r.host)) { seen.add(r.host); queue.push(r); }
  // The harvester's liveness probe already visited the ranked candidates:
  // a host it saw answer 404 or a server error is dead, no need to ask again.
  // (403, 429 and timeouts stay in: those can be the moment, not the store.)
  const harvestDead = new Set<string>();
  if (existsSync('seeds/live-cache.json')) {
    try {
      for (const [h, l] of Object.entries(JSON.parse(await readFile('seeds/live-cache.json', 'utf8')) as Record<string, { alive: boolean; status: number | null }>)) {
        if (!l.alive && l.status && (l.status === 404 || l.status === 410 || l.status >= 500)) harvestDead.add(h);
      }
    } catch {
      /* no harvest cache */
    }
  }
  if (topup && existsSync('seeds/candidates.csv')) {
    const rest = parseCsv(await readFile('seeds/candidates.csv', 'utf8')).filter((r) => r.host && !seen.has(r.host) && !harvestDead.has(r.host));
    const fromStoreSource = (r: Row) => /\b(ecomm|gallery|catalog)\b/.test(r.sources || '');
    const ranked = (r: Row) => Boolean(r.tranco_rank);
    // Gallery-listed stores the harvester never probed (unranked) pass at the
    // highest rate; gallery-listed ranked hosts were mostly probed and
    // rejected already; article-only hosts come last.
    const tier = (r: Row) => (fromStoreSource(r) && !ranked(r) ? 0 : fromStoreSource(r) ? 1 : ranked(r) ? 2 : 3);
    rest.sort((a, b) => tier(a) - tier(b));
    for (const r of rest) { seen.add(r.host); queue.push(r); }
    if (harvestDead.size) console.log(`Skipping ${harvestDead.size} host(s) the harvester saw answer 404 or a server error.`);
  }
  console.log(`${queue.length} hosts queued (${input} first, then candidates). Target: ${target} validated stores.`);

  const cachePath = 'seeds/validate-cache.json';
  const cache = new Map<string, Verdict>();
  if (existsSync(cachePath)) {
    try {
      const srcOf = new Map(queue.map((r) => [r.host, r.sources ? r.sources.split('|') : []]));
      for (const [h, cached] of Object.entries(JSON.parse(await readFile(cachePath, 'utf8')) as Record<string, Verdict>)) {
        let v = cached;
        // Throttling and unreachable robots are about the moment, not the
        // store: never trust them from the cache.
        const transient = v.status === 429 || v.reason === 'rate-limited' || v.reason === 'robots-unreachable';
        if (transient || Date.now() - v.ts >= 7 * 86_400_000) continue;
        // Verdicts from before strong/weak signals were split carry no
        // breakdown: re-validate those in full.
        if (typeof v.strong !== 'number') continue;
        const sig: Signals = { strong: v.strong, weak: v.weak };
        const passes = looksLikeStore(v.info.platform, sig, v.title, v.description, srcOf.get(h) || []);
        // Re-judge with the current rule in both directions: an old "not a
        // store" that now passes is dropped so the host is validated in full;
        // an old pass that now fails becomes a rejection from cached facts.
        if (v.reason === 'not-store' && passes) continue;
        if (v.ok && !passes) v = { ...v, ok: false, reason: isSpam(v.title, v.description) ? 'spam' : 'not-store' };
        if (v.reason === 'dead' && v.status && [401, 403, 503].includes(v.status)) v.reason = 'blocked';
        cache.set(h, v);
      }
    } catch {
      /* start fresh */
    }
  }
  const saveCache = () => writeFile(cachePath, JSON.stringify(Object.fromEntries(cache)), 'utf8');

  const accepted: { row: Row; v: Verdict }[] = [];
  const rejected: { row: Row; v: Verdict }[] = [];
  const transient: Row[] = [];
  const finalHosts = new Set<string>();
  const isTransient = (v: Verdict) => v.reason === 'rate-limited' || v.reason === 'robots-unreachable' || v.status === 429;
  let processed = 0;
  let transientCount = 0;

  const judge = (row: Row, v: Verdict) => {
    // Duplicate detection needs the run's own state, so it lives outside the cache.
    const fh = v.finalHost || row.host;
    if (v.ok && finalHosts.has(fh)) rejected.push({ row, v: { ...v, ok: false, reason: 'duplicate' } });
    else if (v.ok) {
      finalHosts.add(fh);
      accepted.push({ row, v });
    } else rejected.push({ row, v });
  };

  const runQueue = async (items: Row[], n: number, label: string) => {
    let next = 0;
    const loop = async () => {
      while (next < items.length && accepted.length < target) {
        const row = items[next++];
        let v = cache.get(row.host);
        if (!v) {
          v = await validateHost(polite, row.host, (row.platform || row.platform_hint || '').toLowerCase() || null, row.sources ? row.sources.split('|') : []);
          if (isTransient(v)) {
            // Our throttling, not the store's fault: keep for the second pass.
            transientCount++;
            await appendFile('seeds/transient.log', `${new Date().toISOString()}\t${label}\t${row.host}\t${v.reason}\t${v.status ?? ''}\n`).catch(() => {});
            if (label === 'main') {
              transient.push(row);
              continue;
            }
          } else cache.set(row.host, v);
        }
        judge(row, v);
        if (++processed % 50 === 0) {
          console.log(`  ${processed} checked, ${accepted.length} accepted, ${rejected.length} rejected, ${transientCount} transient (${((Date.now() - t0) / 60000).toFixed(1)} min)`);
          await saveCache();
        }
      }
    };
    await Promise.all(Array.from({ length: n }, loop));
  };

  await runQueue(queue, workers, 'main');
  if (transient.length && accepted.length < target) {
    console.log(`\nSecond pass: ${transient.length} host(s) were throttled or had unreachable robots; retrying slowly…`);
    await sleep(30_000);
    await runQueue(transient, 3, 'retry');
  }
  await saveCache();

  // Keep the harvest order (rank, then mentions) in the output.
  const order = new Map(queue.map((r, i) => [r.host, i]));
  accepted.sort((a, b) => (order.get(a.row.host) ?? 0) - (order.get(b.row.host) ?? 0));

  // Country is derived at output time from the raw signals, so a better rule
  // applies to cached verdicts too.
  const toLine = ({ row, v }: { row: Row; v: Verdict }) =>
    csvLine([row.host, v.finalHost || '', v.brand || row.brand || '', v.title || '', v.info.platform || '', v.info.builder || '', v.info.theme || '',
      v.info.themeVersion || '', v.info.currency || '', guessCountry(v.finalHost || row.host, v.info) || '', v.info.locale || '', v.industry, v.industryScore, v.industryRunnerUp || '',
      v.apps.join('|'), v.collections ?? '', v.signals, v.strong, row.tranco_rank || '', row.mentions || '', row.sources || '', new Date(v.ts).toISOString().slice(0, 10)]);
  await writeFile('seeds/stores.validated.csv', [csvLine(HEADER), ...accepted.map(toLine)].join('\n') + '\n', 'utf8');
  await writeFile(
    'seeds/rejected.csv',
    [csvLine(['host', 'reason', 'status', 'final_host', 'platform', 'store_signals', 'strong_signals', 'title']),
      ...rejected.map(({ row, v }) => csvLine([row.host, v.reason || '', v.status ?? '', v.finalHost || '', v.info.platform || '', v.signals, v.strong ?? '', v.title || '']))].join('\n') + '\n',
    'utf8',
  );

  const tally = (items: { v: Verdict }[], pick: (v: Verdict) => string) => {
    const m: Record<string, number> = {};
    for (const { v } of items) m[pick(v)] = (m[pick(v)] || 0) + 1;
    return Object.entries(m).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ');
  };
  console.log(`\nseeds/stores.validated.csv: ${accepted.length} stores (${processed} checked, ${transientCount} transient, ${((Date.now() - t0) / 60000).toFixed(1)} min)`);
  console.log(`  platforms: ${tally(accepted, (v) => v.info.platform || 'unknown')}`);
  console.log(`  industries: ${tally(accepted, (v) => v.industry)}`);
  console.log(`  countries: ${tally(accepted, (v) => guessCountry(v.finalHost || '', v.info) || '?')}`);
  console.log(`  with theme name: ${accepted.filter((a) => a.v.info.theme).length}, with currency: ${accepted.filter((a) => a.v.info.currency).length}`);
  console.log(`seeds/rejected.csv: ${rejected.length} (${tally(rejected, (v) => v.reason || '?')})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
