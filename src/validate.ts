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
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import * as cheerio from 'cheerio';
import { Politeness, PoliteError, hostOf, lanes, laneFor, retryAfterMs, installFetchCrashGuard, type Lane } from './polite.js';

installFetchCrashGuard();
import { classifyIndustry, detectApps, detectPlatform, ECOM_PLATFORMS, guessCountry, isAdult, isParked, storeSignals, type PlatformInfo } from './fingerprints.js';

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
async function validateHost(polite: Politeness, host: string, platformHint: string | null): Promise<Verdict> {
  const v: Verdict = {
    ok: false, reason: null, status: null, finalHost: null, brand: null, title: null, description: null, info: { ...EMPTY_INFO },
    apps: [], signals: 0, industry: 'other', industryScore: 0, industryRunnerUp: null, country: null, collections: null, products: null, ts: Date.now(),
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
      v.reason = 'dead';
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
  v.signals = storeSignals(html);
  v.country = guessCountry(v.finalHost || host, v.info);

  const parked = isParked(html);
  if (parked || html.length < 1500) {
    v.reason = 'parked';
    return v;
  }
  const isEcom = v.info.platform !== null && ECOM_PLATFORMS.has(v.info.platform);

  // Shopify: the catalogue feeds confirm the store and name its categories.
  let collectionTitles: string[] = [];
  if (v.info.platform === 'shopify') {
    try {
      const origin = `https://${v.finalHost || host}`;
      const r = await laneFetch(polite, 'shopify', `${origin}/collections.json?limit=50`, 'application/json');
      if (r.ok && (r.headers.get('content-type') || '').includes('json')) {
        const j = (await r.json()) as { collections?: { title?: string; handle?: string }[] };
        const cols = j.collections || [];
        v.collections = cols.length;
        collectionTitles = cols.map((c) => `${c.title || ''} ${(c.handle || '').replace(/-/g, ' ')}`);
      }
    } catch {
      /* fine, the home page still counts */
    }
  }

  if (!isEcom && v.signals < 3) {
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
  const guess = classifyIndustry([
    { text: meta, weight: 3 },
    { text: collectionTitles.join(' '), weight: 2 },
    { text: navText, weight: 2 },
    { text: headings, weight: 1.5 },
    { text: body, weight: 0.5 },
  ]);
  v.industry = guess.industry;
  v.industryScore = Math.round(guess.score * 10) / 10;
  v.industryRunnerUp = guess.runnerUp;
  v.ok = true;
  return v;
}

// ---- Main -------------------------------------------------------------------
const HEADER = ['host', 'final_host', 'brand', 'title', 'platform', 'builder', 'theme', 'theme_version', 'currency', 'country', 'locale', 'industry',
  'industry_score', 'industry_runner_up', 'apps', 'collections', 'store_signals', 'tranco_rank', 'mentions', 'sources', 'validated_at'];

async function main() {
  const args = process.argv.slice(2);
  const opt = (name: string, def: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : def;
  };
  const input = opt('--in', 'seeds/stores.csv');
  const target = Number(opt('--target', '1000'));
  const topup = !args.includes('--no-topup');
  const workers = Number(opt('--workers', '8'));

  await mkdir('seeds', { recursive: true });
  const polite = await Politeness.fromConfig();
  const t0 = Date.now();

  // Queue: the input rows first, then (if topping up) the rest of the
  // candidates in their harvest order, which is Tranco rank then mentions.
  const seen = new Set<string>();
  const queue: Row[] = [];
  for (const r of parseCsv(await readFile(input, 'utf8'))) if (r.host && !seen.has(r.host)) { seen.add(r.host); queue.push(r); }
  if (topup && existsSync('seeds/candidates.csv')) {
    for (const r of parseCsv(await readFile('seeds/candidates.csv', 'utf8'))) if (r.host && !seen.has(r.host)) { seen.add(r.host); queue.push(r); }
  }
  console.log(`${queue.length} hosts queued (${input} first, then candidates). Target: ${target} validated stores.`);

  const cachePath = 'seeds/validate-cache.json';
  const cache = new Map<string, Verdict>();
  if (existsSync(cachePath)) {
    try {
      for (const [h, v] of Object.entries(JSON.parse(await readFile(cachePath, 'utf8')) as Record<string, Verdict>)) {
        // Throttling and unreachable robots are about the moment, not the
        // store: never trust them from the cache.
        const transient = v.status === 429 || v.reason === 'rate-limited' || v.reason === 'robots-unreachable';
        if (!transient && Date.now() - v.ts < 7 * 86_400_000) cache.set(h, v);
      }
    } catch {
      /* start fresh */
    }
  }
  const saveCache = () => writeFile(cachePath, JSON.stringify(Object.fromEntries(cache)), 'utf8');

  const accepted: { row: Row; v: Verdict }[] = [];
  const rejected: { row: Row; v: Verdict }[] = [];
  const finalHosts = new Set<string>();
  let next = 0;
  let processed = 0;
  const workerLoop = async () => {
    while (next < queue.length && accepted.length < target) {
      const row = queue[next++];
      let v = cache.get(row.host);
      if (!v) {
        v = await validateHost(polite, row.host, (row.platform || row.platform_hint || '').toLowerCase() || null);
        if (v.reason !== 'rate-limited' && v.reason !== 'robots-unreachable' && v.status !== 429) cache.set(row.host, v);
      }
      // Duplicate detection needs the run's own state, so it lives outside the cache.
      const fh = v.finalHost || row.host;
      if (v.ok && finalHosts.has(fh)) {
        rejected.push({ row, v: { ...v, ok: false, reason: 'duplicate' } });
      } else if (v.ok) {
        finalHosts.add(fh);
        accepted.push({ row, v });
      } else {
        rejected.push({ row, v });
      }
      if (++processed % 50 === 0) {
        console.log(`  ${processed} checked, ${accepted.length} accepted, ${rejected.length} rejected (${((Date.now() - t0) / 60000).toFixed(1)} min)`);
        await saveCache();
      }
    }
  };
  await Promise.all(Array.from({ length: workers }, workerLoop));
  await saveCache();

  // Keep the harvest order (rank, then mentions) in the output.
  const order = new Map(queue.map((r, i) => [r.host, i]));
  accepted.sort((a, b) => (order.get(a.row.host) ?? 0) - (order.get(b.row.host) ?? 0));

  // Country is derived at output time from the raw signals, so a better rule
  // applies to cached verdicts too.
  const toLine = ({ row, v }: { row: Row; v: Verdict }) =>
    csvLine([row.host, v.finalHost || '', v.brand || row.brand || '', v.title || '', v.info.platform || '', v.info.builder || '', v.info.theme || '',
      v.info.themeVersion || '', v.info.currency || '', guessCountry(v.finalHost || row.host, v.info) || '', v.info.locale || '', v.industry, v.industryScore, v.industryRunnerUp || '',
      v.apps.join('|'), v.collections ?? '', v.signals, row.tranco_rank || '', row.mentions || '', row.sources || '', new Date(v.ts).toISOString().slice(0, 10)]);
  await writeFile('seeds/stores.validated.csv', [csvLine(HEADER), ...accepted.map(toLine)].join('\n') + '\n', 'utf8');
  await writeFile(
    'seeds/rejected.csv',
    [csvLine(['host', 'reason', 'status', 'final_host', 'platform', 'store_signals', 'title']),
      ...rejected.map(({ row, v }) => csvLine([row.host, v.reason || '', v.status ?? '', v.finalHost || '', v.info.platform || '', v.signals, v.title || '']))].join('\n') + '\n',
    'utf8',
  );

  const tally = (items: { v: Verdict }[], pick: (v: Verdict) => string) => {
    const m: Record<string, number> = {};
    for (const { v } of items) m[pick(v)] = (m[pick(v)] || 0) + 1;
    return Object.entries(m).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ');
  };
  console.log(`\nseeds/stores.validated.csv: ${accepted.length} stores (${processed} checked, ${((Date.now() - t0) / 60000).toFixed(1)} min)`);
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
