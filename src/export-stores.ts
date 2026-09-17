// Exports validated stores into the web app (web/public/sample/stores.json)
// for the Sites page, until the database exists (SEC-10).
//
//   npm run export-stores                 from seeds/stores.validated.csv
//   npm run export-stores -- --from-cache from seeds/validate-cache.json while a
//                                         validator run is still going; also
//                                         writes seeds/stores.validated.interim.csv
//
// Uses the same store rule as the validator, so an interim export can never
// show a host the validator would reject.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { guessCountry, isSpam, looksLikeStore, type PlatformInfo } from './fingerprints.js';

type Row = Record<string, string>;

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

type CachedVerdict = {
  ok: boolean;
  reason: string | null;
  finalHost: string | null;
  brand: string | null;
  title: string | null;
  description: string | null;
  info: PlatformInfo;
  apps: string[];
  signals: number;
  strong?: number;
  weak?: number;
  industry: string;
  industryScore: number;
  industryRunnerUp: string | null;
  collections: number | null;
  ts: number;
};

const HEADER = ['host', 'final_host', 'brand', 'title', 'platform', 'builder', 'theme', 'theme_version', 'currency', 'country', 'locale', 'industry',
  'industry_score', 'industry_runner_up', 'apps', 'collections', 'store_signals', 'strong_signals', 'tranco_rank', 'mentions', 'sources', 'validated_at'];

const fromCache = process.argv.includes('--from-cache');
const csvArg = process.argv.slice(2).find((a) => a.endsWith('.csv'));

let rows: Row[];
if (fromCache) {
  const cache = JSON.parse(readFileSync('seeds/validate-cache.json', 'utf8')) as Record<string, CachedVerdict>;
  const cand = new Map(parseCsv(readFileSync('seeds/candidates.csv', 'utf8')).map((r) => [r.host, r]));
  const seenFinal = new Set<string>();
  rows = [];
  let dropped = 0;
  for (const [host, v] of Object.entries(cache)) {
    if (!v.ok || typeof v.strong !== 'number') continue;
    const c = cand.get(host) || ({} as Row);
    const sources = c.sources ? c.sources.split('|') : [];
    if (!looksLikeStore(v.info.platform, { strong: v.strong, weak: v.weak ?? 0 }, v.title, v.description, sources) || isSpam(v.title, v.description)) {
      dropped++;
      continue;
    }
    const fh = v.finalHost || host;
    if (seenFinal.has(fh)) continue;
    seenFinal.add(fh);
    rows.push({
      host, final_host: v.finalHost || '', brand: v.brand || c.brand || '', title: v.title || '', platform: v.info.platform || '', builder: v.info.builder || '',
      theme: v.info.theme || '', theme_version: v.info.themeVersion || '', currency: v.info.currency || '', country: guessCountry(fh, v.info) || '',
      locale: v.info.locale || '', industry: v.industry || 'other', industry_score: String(v.industryScore ?? 0), industry_runner_up: v.industryRunnerUp || '',
      apps: (v.apps || []).join('|'), collections: v.collections == null ? '' : String(v.collections), store_signals: String(v.signals ?? 0), strong_signals: String(v.strong),
      tranco_rank: c.tranco_rank || '', mentions: c.mentions || '', sources: c.sources || '', validated_at: new Date(v.ts).toISOString().slice(0, 10),
    });
  }
  rows.sort((a, b) => (Number(a.tranco_rank) || 1e9) - (Number(b.tranco_rank) || 1e9) || (Number(b.mentions) || 0) - (Number(a.mentions) || 0));
  writeFileSync('seeds/stores.validated.interim.csv', [csvLine(HEADER), ...rows.map((r) => csvLine(HEADER.map((k) => r[k])))].join('\n') + '\n', 'utf8');
  console.log(`${rows.length} accepted stores in the cache (${dropped} no longer pass the rule) -> seeds/stores.validated.interim.csv`);
} else {
  rows = parseCsv(readFileSync(csvArg || 'seeds/stores.validated.csv', 'utf8'));
}

// Keep the brand's own domain unless the home page redirected to a different
// domain altogether (a checkout or regional subdomain is still the same store).
const displayHost = (r: Row) => (!r.final_host || r.final_host === r.host || r.final_host.endsWith(`.${r.host}`) ? r.host : r.final_host);

const stores = rows.map((r, i) => ({
  n: i + 1,
  host: displayHost(r),
  brand: r.brand || r.title || r.host,
  title: r.title || null,
  platform: r.platform || null,
  builder: r.builder || null,
  theme: r.theme || null,
  themeVersion: r.theme_version || null,
  currency: r.currency || null,
  country: r.country || null,
  industry: r.industry || 'other',
  industryScore: Number(r.industry_score) || 0,
  apps: r.apps ? r.apps.split('|') : [],
  collections: r.collections ? Number(r.collections) : null,
  rank: r.tranco_rank ? Number(r.tranco_rank) : null,
  mentions: Number(r.mentions) || 0,
  sources: r.sources ? r.sources.split('|') : [],
  validatedAt: r.validated_at || null,
}));

const outDir = path.join('web', 'public', 'sample');
mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, 'stores.json'), JSON.stringify({ generatedAt: new Date().toISOString(), stores }));
console.log(`${stores.length} stores -> ${path.join(outDir, 'stores.json')}`);
