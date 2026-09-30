// The crawl worker (SEC-7): point it at a list of stores and leave it.
//
//   npm run crawl -- --seed seeds/stores.validated.csv --limit 50    enqueue the top 50 and run
//   npm run crawl -- --hosts myzoobox.com,allbirds.com               enqueue these and run
//   npm run crawl                                                    carry on with whatever is queued
//   npm run crawl -- --retry-failed                                  put failed and partial stores back in line, then run
//   npm run crawl -- --hosts allbirds.com --recapture                start these stores over, every page afresh
//   npm run crawl -- --report                                        counts, failure reasons, disk, ETA; runs nothing
//   npm run crawl -- --stop                                          ask a running crawl (from any terminal) to finish its pages and stop
//
//   --parallel 3        stores captured at the same time (pages of one store always go one by one)
//   --max-attempts 2    tries per store before it is marked failed
//   --retry-delay 300   seconds a store cools off before its next try
//   --per-type 2        collection pages and product pages per store
//   --stop-after N      stop after N stores (for testing)
//   --enqueue-only      add to the queue, do not run
//   --out data          where captures go          --db data/queue.sqlite
//
// It survives: a crash or a kill (the next start resumes; pages already
// captured are not captured again), a hung page (hard time limit per
// viewport), a dead browser (relaunched), Ctrl+C (the pages in flight finish,
// then every running store is handed back to the queue). A lock file stops two
// crawls running at once, which is what gets an IP throttled.
import { chromium, type Browser } from 'playwright';
import { appendFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Queue, type SeedRow, type StoreRow, type StoreStatus } from './queue.js';
import { parseCsv } from './csv.js';
import { capturePage, DEFAULT_CAPTURE, type CaptureOptions, type PageResult } from './capture-page.js';
import { chooseFromLinks, discoverShopify } from './discover.js';
import { buildIndex } from './build-index.js';
import { Politeness, installFetchCrashGuard, laneFor } from './polite.js';

installFetchCrashGuard();

type Options = {
  seed: string | null;
  hosts: string[];
  limit: number;
  parallel: number;
  maxAttempts: number;
  retryDelayMs: number;
  perType: number;
  stopAfter: number;
  enqueueOnly: boolean;
  retryFailed: boolean;
  recapture: boolean;
  report: boolean;
  stop: boolean;
  force: boolean;
  headed: boolean;
  out: string;
  db: string;
};

function parseArgs(argv: string[]): Options {
  const o: Options = { seed: null, hosts: [], limit: Infinity, parallel: 3, maxAttempts: 2, retryDelayMs: 300_000, perType: 2, stopAfter: Infinity, enqueueOnly: false, retryFailed: false, recapture: false, report: false, stop: false, force: false, headed: false, out: 'data', db: '' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--seed') o.seed = argv[++i];
    else if (a === '--hosts') o.hosts = argv[++i].split(',').map((h) => h.trim().toLowerCase().replace(/^www\./, '')).filter(Boolean);
    else if (a === '--limit') o.limit = Number(argv[++i]);
    else if (a === '--parallel') o.parallel = Math.max(1, Number(argv[++i]));
    else if (a === '--max-attempts') o.maxAttempts = Math.max(1, Number(argv[++i]));
    else if (a === '--retry-delay') o.retryDelayMs = Math.max(0, Number(argv[++i])) * 1000;
    else if (a === '--per-type') o.perType = Math.max(0, Number(argv[++i]));
    else if (a === '--stop-after') o.stopAfter = Number(argv[++i]);
    else if (a === '--enqueue-only') o.enqueueOnly = true;
    else if (a === '--retry-failed') o.retryFailed = true;
    else if (a === '--recapture') o.recapture = true;
    else if (a === '--report') o.report = true;
    else if (a === '--stop') o.stop = true;
    else if (a === '--force') o.force = true;
    else if (a === '--headed') o.headed = true;
    else if (a === '--out') o.out = argv[++i];
    else if (a === '--db') o.db = argv[++i];
    else {
      console.error(`Unknown argument ${a}. See the header of src/crawl.ts for usage.`);
      process.exit(1);
    }
  }
  if (!o.db) o.db = path.join(o.out, 'queue.sqlite');
  return o;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ---- One crawl at a time ------------------------------------------------------
/** Old captures live beside the output folder, never inside it: the importer reads every manifest under it. */
function archiveRoot(out: string): string {
  const abs = path.resolve(out);
  return path.join(path.dirname(abs), `${path.basename(abs)}-archive`);
}

async function setAside(out: string, hosts: string[]): Promise<number> {
  const dest = path.join(archiveRoot(out), `replaced-${new Date().toISOString().slice(0, 10)}`);
  let moved = 0;
  for (const host of hosts) {
    const from = path.join(out, host);
    if (!existsSync(from)) continue;
    await mkdir(dest, { recursive: true });
    const to = path.join(dest, host);
    await rename(from, existsSync(to) ? `${to}-${Date.now()}` : to);
    moved++;
  }
  return moved;
}

function takeLock(file: string, force: boolean): void {
  if (existsSync(file)) {
    let held: { pid: number; startedAt: string } | null = null;
    try {
      held = JSON.parse(readFileSync(file, 'utf8')) as { pid: number; startedAt: string };
    } catch {
      /* unreadable lock: take over */
    }
    if (held) {
      let alive = true;
      try {
        process.kill(held.pid, 0); // signal 0 only asks "does this process exist?"
      } catch {
        alive = false;
      }
      if (alive && !force) {
        console.error(`Another crawl is running (pid ${held.pid}, started ${held.startedAt}). Two crawls from one IP get both throttled.\nIf that process is really gone, run again with --force.`);
        process.exit(1);
      }
      console.log(alive ? `--force: ignoring the lock held by pid ${held.pid}.` : `The last run (pid ${held.pid}) ended without cleaning up. Taking over.`);
    }
  }
  writeFileSync(file, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
}
function dropLock(file: string): void {
  try {
    unlinkSync(file);
  } catch {
    /* already gone */
  }
}

// ---- Report -------------------------------------------------------------------
function fmtDuration(ms: number): string {
  const m = Math.round(ms / 60000);
  return m < 90 ? `${m} min` : `${(m / 60).toFixed(1)} h`;
}
const mb = (bytes: number) => bytes / (1024 * 1024);

async function dirBytes(dir: string): Promise<number> {
  let total = 0;
  let entries: string[] = [];
  try {
    entries = await readdir(dir);
  } catch {
    return 0;
  }
  for (const name of entries) {
    const p = path.join(dir, name);
    const s = await stat(p).catch(() => null);
    if (!s) continue;
    total += s.isDirectory() ? await dirBytes(p) : s.size;
  }
  return total;
}

async function report(q: Queue, opts: Options, toFile: boolean): Promise<string> {
  const c = q.counts();
  const t = q.totals();
  const remaining = (c.pending || 0) + (c.running || 0);
  const lines: string[] = [];
  lines.push(`# Crawl report · ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`, '');
  lines.push(`Stores in the queue: ${t.stores}`);
  for (const s of ['done', 'partial', 'failed', 'skipped', 'running', 'pending']) if (c[s]) lines.push(`- ${s}: ${c[s]}`);
  lines.push('', `Pages recorded: ${t.pages} (${t.pagesCaptured} captured in full) · blocks: ${t.blocks}`);
  if (t.homeOnly) lines.push(`Stores where only the home page was found (no recognisable collection or product links): ${t.homeOnly}`);
  if (t.captured && t.bytes) lines.push(`Disk: ${mb(t.bytes).toFixed(0)} MB for ${t.captured} store(s), ${mb(t.bytes / t.captured).toFixed(0)} MB each · 1,000 stores would need about ${(mb(t.bytes / t.captured) * 1000 / 1024).toFixed(0)} GB`);
  if (t.avgStoreMs) lines.push(`Time: ${(t.avgStoreMs / 1000).toFixed(0)} s per store on average${remaining ? ` · ${remaining} left at ${opts.parallel} in parallel is about ${fmtDuration((remaining * t.avgStoreMs) / opts.parallel)}` : ''}`);
  const byPlatform = new Map<string, Record<string, number>>();
  for (const r of q.platformBreakdown()) byPlatform.set(r.platform, { ...(byPlatform.get(r.platform) || {}), [r.status]: r.n });
  if (byPlatform.size > 1) {
    lines.push('', 'By platform (done / partial / failed / skipped / still to do):');
    for (const [platform, n] of byPlatform) lines.push(`- ${platform}: ${n.done || 0} / ${n.partial || 0} / ${n.failed || 0} / ${n.skipped || 0} / ${(n.pending || 0) + (n.running || 0)}`);
  }
  const reasons = q.reasons();
  if (reasons.length) {
    lines.push('', 'Why things failed or were skipped:');
    for (const r of reasons) lines.push(`- ${r.scope}: ${r.reason} × ${r.n}`);
  }
  const failed = q.list('failed', 15);
  if (failed.length) {
    lines.push('', 'Failed stores (first 15 by rank):');
    for (const f of failed) lines.push(`- ${f.host} (${f.platform || 'unknown'}, ${f.attempts} attempt(s)): ${f.reason}`);
  }
  const text = lines.join('\n') + '\n';
  if (toFile) await writeFile(path.join(opts.out, 'crawl-report.md'), text, 'utf8');
  return text;
}

// ---- One store ----------------------------------------------------------------
type Ctx = { q: Queue; polite: Politeness; opts: Options; capture: CaptureOptions; browser: () => Promise<Browser>; log: (e: Record<string, unknown>) => Promise<void>; stopping: () => boolean };
type Outcome = { status: StoreStatus; pages: number; blocks: number; ms: number; reason: string | null };

// Marketplaces, social profiles and domain sellers: a store domain that forwards to one of these has no site of its own to capture.
const ELSEWHERE = /(^|\.)(amazon\.[a-z.]{2,6}|etsy\.com|ebay\.[a-z.]{2,6}|walmart\.com|aliexpress\.com|linktr\.ee|facebook\.com|instagram\.com|tiktok\.com|hugedomains\.com|dan\.com|sedo\.com|afternic\.com|godaddy\.com)$/i;
const BROWSER_GONE =/browser:|has been closed|Target closed|Browser closed|disconnected|crashed/i;
// Worth a second try after a cool-off. A bot wall (403) or a missing page (404) is not.
// "dead" (DNS failed) is here on purpose: on the full run four household names
// came back "dead" and answered a minute later. A domain that is really gone
// fails again after the cool-off and is then marked failed.
const TRANSIENT = /^dead$|robots-unreachable|page-timeout|ERR_TIMED_OUT|ERR_NETWORK|ERR_CONNECTION_RESET|ERR_CONNECTION_TIMED_OUT|ERR_NAME_NOT_RESOLVED|ERR_HTTP2_PROTOCOL_ERROR|ERR_ABORTED|ERR_INTERNET_DISCONNECTED|http-429|http-5\d\d|Timeout \d+ms exceeded|browser:|has been closed|crashed/i;

/** One page, tried again once when the browser (not the site) was the problem. `ctx.browser()` starts a new browser if the old one died. */
async function captureResilient(ctx: Ctx, url: string, extra: Partial<CaptureOptions>): Promise<PageResult> {
  const o = { ...ctx.capture, ...extra };
  let r = await capturePage(await ctx.browser(), url, o, ctx.polite);
  if (r.status === 'failed' && r.reason && BROWSER_GONE.test(r.reason) && !ctx.stopping()) r = await capturePage(await ctx.browser(), url, o, ctx.polite);
  // A page that loaded fine but has nothing to cut up: a geo-block ("you cannot
  // visit our store from your location"), a bot wall answering 200, an empty
  // shell. Useless to a block library, so it is a failure with the page's own
  // words as the reason, and its files do not stay around to be imported.
  if ((r.status === 'captured' || r.status === 'partial') && r.blocks === 0) {
    await rm(path.join(o.out, r.host, r.slug), { recursive: true, force: true }).catch(() => {});
    r.status = 'failed';
    r.reason = r.emptyText !== null ? `no-content: "${r.emptyText.slice(0, 120)}"` : 'no block could be captured';
  }
  return r;
}

async function processStore(ctx: Ctx, s: StoreRow): Promise<Outcome> {
  const { q, polite, opts } = ctx;
  const t0 = Date.now();
  const home = `https://${s.host}/`;
  // Every page files under the store's own name, even when the site redirects to a regional host.
  const extra: Partial<CaptureOptions> = { host: s.host, lane: laneFor(s.platform) };
  const record = async (r: PageResult) => {
    q.recordPage(s.host, { url: r.url, type: r.type, status: r.status, reason: r.reason, blocks: r.blocks, desktopMs: r.ms.desktop ?? null, mobileMs: r.ms.mobile ?? null });
    await ctx.log({ host: s.host, url: r.url, action: r.status, reason: r.reason, blocks: r.blocks, ms: r.ms });
  };

  if (polite.isBlocked(s.host)) {
    q.finish(s.host, { status: 'skipped', reason: 'blocklist', pagesTotal: 0, pagesOk: 0, blocks: 0, ms: 0 });
    return { status: 'skipped', pages: 0, blocks: 0, ms: 0, reason: 'blocklist' };
  }
  if (s.attempts > 1) await polite.forgetFailure(home);

  let pagesOk = 0;
  let blocks = 0;
  const problems: string[] = [];
  let urls: string[];
  let robotsRetried = false;

  // A resumed store whose home page is safely on disk keeps its page list: no second visit just to rediscover it.
  const homeDone = q.pageCaptured(s.host, home);
  const plan = s.plan ? (JSON.parse(s.plan) as string[]) : null;
  if (homeDone && plan) {
    urls = plan;
    pagesOk = 1;
    blocks = homeDone.blocks;
  } else {
    // Home first: it proves a real browser gets in, tells us the platform, and
    // carries the links we need when there is no catalogue feed.
    const homeRes = await captureResilient(ctx, home, { ...extra, wantLinks: true });
    // A Shopify store behind its password page (closed, or not launched yet) has nothing to show, and must not reach the library.
    if (homeRes.finalUrl && /^\/password\/?$/.test(new URL(homeRes.finalUrl).pathname)) {
      await rm(path.join(opts.out, s.host, 'home'), { recursive: true, force: true }).catch(() => {});
      homeRes.status = 'skipped';
      homeRes.reason = 'password-page';
      homeRes.blocks = 0;
    }
    // The brand gave up its own shop: the domain now forwards to a marketplace
    // storefront (britishknights.com -> amazon.com) or to a domain seller.
    const landedOn = homeRes.finalUrl ? new URL(homeRes.finalUrl).hostname : '';
    if (ELSEWHERE.test(landedOn) && !ELSEWHERE.test(s.host)) {
      await rm(path.join(opts.out, s.host, 'home'), { recursive: true, force: true }).catch(() => {});
      homeRes.status = 'skipped';
      homeRes.reason = `redirects-to: ${landedOn.replace(/^www\./, '')}`;
      homeRes.blocks = 0;
    }
    await record(homeRes);
    if (homeRes.status === 'skipped' || homeRes.status === 'failed') {
      const reason = homeRes.reason || 'home page failed';
      const ms = Date.now() - t0;
      if (TRANSIENT.test(reason)) return { status: q.retryOrFail(s.host, reason, opts.maxAttempts, opts.retryDelayMs), pages: 0, blocks: 0, ms, reason };
      const status: StoreStatus = homeRes.status === 'skipped' && reason !== 'dead' ? 'skipped' : 'failed';
      q.finish(s.host, { status, reason, pagesTotal: 1, pagesOk: 0, blocks: 0, ms });
      return { status, pages: 0, blocks: 0, ms, reason };
    }
    pagesOk = 1;
    blocks = homeRes.blocks;
    if (homeRes.status === 'partial' && homeRes.reason) problems.push(`home: ${homeRes.reason}`);
    if (homeRes.site && homeRes.site.platform !== 'unknown') q.setPlatform(s.host, homeRes.site.platform);

    // Which other pages: the collections and products the store features on its
    // own home page first. On Shopify the catalogue feeds fill the gaps (and add
    // the cart); elsewhere the links are all there is.
    const origin = new URL(homeRes.finalUrl || home).origin;
    const limits = { collections: opts.perType, products: opts.perType };
    const fromLinks = opts.perType > 0 ? chooseFromLinks(homeRes.links, limits) : [];
    urls = [];
    if (opts.perType > 0 && (homeRes.site?.platform === 'shopify' || /shopify/i.test(s.platform || ''))) {
      try {
        const d = await discoverShopify(polite, origin, limits, fromLinks);
        if (d.shopify) urls = d.urls.filter((u) => new URL(u).pathname !== '/');
      } catch {
        /* feed refused: fall back to the links */
      }
    }
    if (!urls.length) urls = fromLinks;
    urls = [...new Set(urls)];
    q.setPlan(s.host, urls);
  }

  for (const url of urls) {
    if (ctx.stopping()) {
      q.release(s.host, Date.now() - t0);
      return { status: 'pending', pages: pagesOk, blocks, ms: Date.now() - t0, reason: 'stopped, will resume' };
    }
    const already = q.pageCaptured(s.host, url);
    if (already) {
      pagesOk++;
      blocks += already.blocks;
      continue;
    }
    let r = await captureResilient(ctx, url, extra);
    // robots.txt did not answer (often the www or regional host the store
    // redirected to). That is a hiccup, not a "no": one more try after a pause,
    // and if it still fails the store ends "partial" so --retry-failed returns to it.
    if (r.status === 'skipped' && r.reason === 'robots-unreachable' && !robotsRetried) {
      robotsRetried = true;
      await sleep(15_000);
      await polite.forgetFailure(url);
      r = await captureResilient(ctx, url, extra);
    }
    await record(r);
    if (r.status === 'captured' || r.status === 'partial') {
      pagesOk++;
      blocks += r.blocks;
    }
    if (r.status === 'partial' || r.status === 'failed' || (r.status === 'skipped' && r.reason === 'robots-unreachable')) problems.push(`${r.type}: ${r.reason}`);
  }

  const status: StoreStatus = problems.length === 0 ? 'done' : 'partial';
  const reason = problems.length ? problems.slice(0, 3).join(' | ').slice(0, 300) : null;
  const ms = Date.now() - t0;
  q.finish(s.host, { status, reason, pagesTotal: 1 + urls.length, pagesOk, blocks, ms, bytes: await dirBytes(path.join(opts.out, s.host)) });
  return { status, pages: pagesOk, blocks, ms, reason };
}

// ---- Main ---------------------------------------------------------------------
async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  await mkdir(opts.out, { recursive: true });
  const lock = path.join(opts.out, 'crawl.lock');
  // Ctrl+C only reaches a crawl in the same terminal (and on Windows not at
  // all when it runs in the background), hence a flag file as the second way.
  const stopFile = path.join(opts.out, 'crawl.stop');
  if (opts.stop) {
    if (!existsSync(lock)) console.log('No crawl is running here.');
    else {
      writeFileSync(stopFile, new Date().toISOString());
      console.log('Asked the running crawl to stop. It finishes the pages in flight first (up to a few minutes).');
    }
    return;
  }
  const q = new Queue(opts.db);

  if (opts.report) {
    console.log(await report(q, opts, false));
    q.close();
    return;
  }

  // Enqueue
  const seeds: SeedRow[] = [];
  if (opts.seed) {
    for (const r of parseCsv(await readFile(opts.seed, 'utf8'))) {
      if (!r.host) continue;
      if (opts.hosts.length && !opts.hosts.includes(r.host)) continue;
      seeds.push({ host: r.host, finalHost: r.final_host || null, brand: r.brand || null, platform: r.platform || null, rank: r.tranco_rank ? Number(r.tranco_rank) : null });
      if (seeds.length >= opts.limit) break;
    }
  }
  for (const h of opts.hosts) if (!seeds.some((s) => s.host === h)) seeds.push({ host: h });
  if (seeds.length) {
    const e = q.enqueue(seeds);
    console.log(`Enqueued ${e.added} new store(s); ${e.existing} already in the queue.`);
  }
  if (opts.recapture) {
    if (!seeds.length) {
      console.error('--recapture needs to know which stores: add --hosts a.com,b.com or --seed <file>.');
      q.close();
      process.exit(1);
    }
    console.log(`Starting ${q.reset(seeds.map((s) => s.host))} store(s) over.`);
  }
  if (opts.retryFailed) console.log(`Put ${q.requeue(['failed', 'partial'])} failed or partial store(s) back in line.`);
  if (opts.enqueueOnly) {
    console.log(await report(q, opts, false));
    q.close();
    return;
  }

  takeLock(lock, opts.force);
  dropLock(stopFile); // a stop request left over from an earlier run
  // A store started over keeps nothing of its last capture in the output: its
  // page plan can differ this time, and leftover page folders would be imported
  // beside the new ones. They move to <out>-archive/, nothing is deleted.
  if (opts.recapture) {
    const moved = await setAside(opts.out, seeds.map((s) => s.host));
    if (moved) console.log(`Moved the old captures of ${moved} store(s) to ${archiveRoot(opts.out)}.`);
  }
  // Chromium's scratch profile goes next to the captures, not on the system
  // drive. A killed run leaves one behind, so the folder is cleared first.
  const tmp = path.resolve(opts.out, '.tmp');
  await rm(tmp, { recursive: true, force: true }).catch(() => {});
  await mkdir(tmp, { recursive: true });
  process.env.TEMP = process.env.TMP = process.env.TMPDIR = tmp;
  const resumed = q.resetRunning();
  if (resumed) console.log(`Resuming: ${resumed} store(s) were mid-capture when the last run ended.`);

  const polite = await Politeness.fromConfig();
  const logFile = path.join(opts.out, 'crawl-log.jsonl');
  const log = (e: Record<string, unknown>) => appendFile(logFile, JSON.stringify({ ts: new Date().toISOString(), ...e }) + '\n');

  // One browser for the run, replaced when it dies. Playwright's own Ctrl+C
  // handling is off: it would kill the browser under the pages in flight.
  let browser: Browser | null = null;
  let launching: Promise<Browser> | null = null;
  const getBrowser = async (): Promise<Browser> => {
    if (browser && browser.isConnected()) return browser;
    if (!launching) {
      if (browser) console.log('  the browser went away, starting a new one…');
      const dead = browser;
      browser = null;
      launching = (async () => {
        await dead?.close().catch(() => {});
        const b = await chromium.launch({ headless: !opts.headed, handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false });
        browser = b;
        launching = null;
        return b;
      })().catch((e) => {
        launching = null;
        throw e;
      });
    }
    return launching;
  };

  let stopping = false;
  let stops = 0;
  const announceStop = () => console.log('\nStopping: the pages in flight finish first, then the stores go back to the queue. Ctrl+C again to quit now.');
  const isStopping = () => {
    if (!stopping && existsSync(stopFile)) {
      stopping = true;
      announceStop();
    }
    return stopping;
  };
  const onStop = () => {
    stops++;
    if (stops === 1) {
      stopping = true;
      announceStop();
    } else {
      dropLock(lock);
      process.exit(130);
    }
  };
  process.on('SIGINT', onStop);
  process.on('SIGTERM', onStop);

  const ctx: Ctx = { q, polite, opts, capture: { ...DEFAULT_CAPTURE, out: opts.out }, browser: getBrowser, log, stopping: isStopping };
  const todo = q.counts().pending || 0;
  console.log(`${todo} store(s) to capture, ${opts.parallel} at a time -> ${opts.out}/`);

  let claimed = 0;
  let finished = 0;
  let announcedWait = false;
  const t0 = Date.now();
  const worker = async () => {
    while (!isStopping() && claimed < opts.stopAfter) {
      const s = q.claim();
      if (!s) {
        // Nothing to pick up right now. Done, unless a store is cooling off before its retry.
        const due = q.nextDueInMs();
        if (due === null) return;
        if (!announcedWait) {
          announcedWait = true;
          console.log(`  waiting ${Math.ceil(due / 1000)} s: a store is cooling off before its retry`);
        }
        await sleep(Math.min(due + 250, 5_000));
        continue;
      }
      announcedWait = false;
      claimed++;
      let r: Outcome;
      try {
        r = await processStore(ctx, s);
      } catch (e) {
        const reason = `worker error: ${(e as Error).message.split('\n')[0]}`;
        r = { status: q.retryOrFail(s.host, reason, opts.maxAttempts, opts.retryDelayMs), pages: 0, blocks: 0, ms: 0, reason };
      }
      finished++;
      const left = Math.max(0, todo - finished);
      const eta = finished >= 3 && left ? ` · about ${fmtDuration(((Date.now() - t0) / finished) * left)} left` : '';
      const retry = r.status === 'pending' && r.reason !== 'stopped, will resume' ? ` (retry in ${Math.round(opts.retryDelayMs / 1000)} s)` : '';
      console.log(`[${finished}/${todo}] ${s.host} · ${r.status}${retry} · ${r.pages} page(s) · ${r.blocks} blocks · ${(r.ms / 1000).toFixed(0)}s${r.reason ? ' · ' + r.reason.slice(0, 120) : ''}${eta}`);
    }
  };

  try {
    await getBrowser();
    await Promise.all(Array.from({ length: opts.parallel }, worker));
  } finally {
    await (browser as Browser | null)?.close().catch(() => {});
    dropLock(lock);
    dropLock(stopFile);
  }

  await buildIndex(opts.out).catch(() => 0);
  console.log('\n' + (await report(q, opts, true)));
  if (stopping) console.log('Stopped on request. Run `npm run crawl` to carry on from here.');
  console.log(`Report: ${path.join(opts.out, 'crawl-report.md')} · browse the captures with: npm run viewer`);
  q.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
