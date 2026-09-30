// Holds back the rows of seeds/stores.validated.csv that are not online stores
// (SEC-51). The validator judged pages by their words, and publishers,
// agencies and software vendors that run a shop plugin have the same words.
//
//   npm run prune-seeds            apply: rewrites seeds/stores.validated.csv,
//                                  writes the held rows to seeds/stores.heldback.csv
//   npm run prune-seeds -- --dry   show what would change, write nothing
//
// A row is held back when
//   1. its host is listed in config/not-stores.txt (judged by eye, with a reason),
//   2. its title or description is hijacked-domain spam,
//   3. its home page forwards to a marketplace or a domain seller,
//   4. it says "coming soon" and shows no store evidence at all.
//
// Re-running is safe: held rows are read back in, so removing a host from
// config/not-stores.txt lets it return to the validated list on the next run.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { parseCsv, csvLine, type Row } from './csv.js';
import { isSpam } from './fingerprints.js';

const VALIDATED = 'seeds/stores.validated.csv';
const HELD = 'seeds/stores.heldback.csv';
const LIST = 'config/not-stores.txt';
const CACHE = 'seeds/validate-cache.json';

// Wording the validator's spam check does not cover (gambling spam glued into one word, Thai news farms).
const MORE_SPAM = /dagangjudi|\bjudi\b|slot ?gacor|ข่าว/i;
const MARKETPLACE = /(^|\.)(amazon\.[a-z.]{2,6}|etsy\.com|ebay\.[a-z.]{2,6}|walmart\.com|aliexpress\.com|linktr\.ee|hugedomains\.com|dan\.com|sedo\.com|afternic\.com|godaddy\.com)$/i;
const COMING_SOON = /\b(coming|opening) soon\b/i;

function readList(): Map<string, string> {
  const out = new Map<string, string>();
  if (!existsSync(LIST)) return out;
  for (const raw of readFileSync(LIST, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^(\S+)\s*(.*)$/);
    if (m) out.set(m[1].toLowerCase(), m[2] || 'listed in config/not-stores.txt');
  }
  return out;
}

function header(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  return text.slice(0, text.search(/\r?\n/)).split(',');
}

function main(): void {
  const dry = process.argv.includes('--dry');
  const list = readList();
  const cache: Record<string, { description?: string | null; finalHost?: string | null }> = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, 'utf8')) : {};
  const cols = header(VALIDATED);

  // Everything we know: the validated rows, plus rows held back by an earlier run (so a host can be let back in).
  const byHost = new Map<string, Row>();
  if (existsSync(HELD)) for (const r of parseCsv(readFileSync(HELD, 'utf8'))) if (r.host) byHost.set(r.host, r);
  for (const r of parseCsv(readFileSync(VALIDATED, 'utf8'))) if (r.host) byHost.set(r.host, r);

  const reasonFor = (r: Row): string | null => {
    const listed = list.get(r.host.toLowerCase());
    if (listed) return listed;
    const c = cache[r.host] || {};
    const text = `${r.title || ''} ${c.description || ''}`;
    if (isSpam(r.title || null, c.description || null) || MORE_SPAM.test(text)) return 'hijacked domain (spam)';
    const finalHost = (r.final_host || c.finalHost || '').replace(/^www\./, '');
    if (finalHost && MARKETPLACE.test(finalHost)) return `forwards to ${finalHost}`;
    if (COMING_SOON.test(text) && Number(r.strong_signals || 0) === 0) return 'not launched (coming soon)';
    return null;
  };

  const kept: Row[] = [];
  const held: { row: Row; reason: string }[] = [];
  for (const r of byHost.values()) {
    const reason = reasonFor(r);
    if (reason) held.push({ row: r, reason });
    else kept.push(r);
  }
  // Keep the validated file's own order (by rank, then host), as the validator wrote it.
  const rank = (r: Row) => (r.tranco_rank ? Number(r.tranco_rank) : Infinity);
  kept.sort((a, b) => rank(a) - rank(b) || a.host.localeCompare(b.host));
  held.sort((a, b) => a.reason.localeCompare(b.reason) || rank(a.row) - rank(b.row));

  const groups = new Map<string, string[]>();
  for (const h of held) {
    const key = h.reason.replace(/\s*\(.*$/, '').replace(/^forwards to .*/, 'forwards to a marketplace');
    groups.set(key, [...(groups.get(key) || []), h.row.host]);
  }
  console.log(`${byHost.size} rows: ${kept.length} kept, ${held.length} held back${dry ? ' (dry run, nothing written)' : ''}`);
  for (const [reason, hosts] of [...groups.entries()].sort((a, b) => b[1].length - a[1].length)) console.log(`  ${String(hosts.length).padStart(3)}  ${reason}: ${hosts.join(', ')}`);
  const unknown = [...list.keys()].filter((h) => !byHost.has(h));
  if (unknown.length) console.log(`  note: ${unknown.length} listed host(s) are not in the seed files: ${unknown.join(', ')}`);
  if (dry) return;

  writeFileSync(VALIDATED, [csvLine(cols), ...kept.map((r) => csvLine(cols.map((k) => r[k] ?? '')))].join('\n') + '\n', 'utf8');
  const heldCols = [...cols.filter((k) => k !== 'held_reason'), 'held_reason'];
  writeFileSync(HELD, [csvLine(heldCols), ...held.map((h) => csvLine(heldCols.map((k) => (k === 'held_reason' ? h.reason : h.row[k] ?? ''))))].join('\n') + '\n', 'utf8');
  console.log(`-> ${VALIDATED} (${kept.length} rows), ${HELD} (${held.length} rows). Next: npm run export-stores`);
}

main();
