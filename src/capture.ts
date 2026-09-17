// Phase 0 capture CLI.
//
//   npm run capture -- myzoobox.com --discover
//   npm run capture -- https://sisterlylab.com/products/some-product --only mobile
//   npm run capture -- --seeds seeds/phase0.txt --discover
//
// For every page it opens a real Chromium at desktop (1440px) and mobile (390px),
// scrolls the page so lazy images load, closes obvious popups, takes a full-page
// screenshot, cuts the page into blocks (Shopify sections when available,
// semantic <section>/<header>/<footer> otherwise), screenshots each block, and
// writes data/<host>/<page>/manifest.json. Finally it rebuilds data/index.js
// for viewer/index.html.

import { chromium, type Browser, type Page } from 'playwright';
import { mkdir, writeFile, readFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { collectBlocks, detectSite, pageMeta, type BlockInfo, type SiteInfo, type PageMeta } from './page-script.js';
import { discoverShopify } from './discover.js';
import { buildIndex } from './build-index.js';
import { Politeness, PoliteError, botUserAgent, hostOf, DESKTOP_BASE_UA, MOBILE_BASE_UA } from './polite.js';

type ViewportName = 'desktop' | 'mobile';

// The real browser UA plus our bot token, so site owners can see who we are.
const VIEWPORTS: Record<ViewportName, { width: number; height: number; deviceScaleFactor: number; isMobile: boolean; hasTouch: boolean; userAgent: string }> = {
  desktop: { width: 1440, height: 900, deviceScaleFactor: 1, isMobile: false, hasTouch: false, userAgent: botUserAgent(DESKTOP_BASE_UA) },
  mobile: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: botUserAgent(MOBILE_BASE_UA) },
};

type Options = {
  urls: string[];
  discover: boolean;
  seeds: string | null;
  out: string;
  only: ViewportName | null;
  maxBlocks: number;
  minHeight: number;
  quality: number;
  headed: boolean;
};

type CapturedBlock = BlockInfo & { viewport: ViewportName; file: string | null; error?: string };

type ViewportResult =
  | { ok: true; status: number | null; site: SiteInfo; meta: PageMeta; strategy: string; fullFile: string; fullHeight: number; blocks: CapturedBlock[]; ms: number }
  | { ok: false; status: number | null; error: string; ms: number };

function usage(): never {
  console.log(`Usage: npm run capture -- <url|host> [...] [--discover] [--seeds file] [--only desktop|mobile]
                          [--out data] [--max-blocks 40] [--min-height 80] [--quality 88] [--headed]

  --discover     for a bare host, enumerate Shopify pages via /products.json and /collections.json
  --seeds file   read hosts/urls from a text file (one per line, # comments)
  --only         capture a single viewport instead of both
  --headed       show the browser window while capturing`);
  process.exit(1);
}

function parseArgs(argv: string[]): Options {
  const o: Options = { urls: [], discover: false, seeds: null, out: 'data', only: null, maxBlocks: 40, minHeight: 80, quality: 88, headed: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--discover') o.discover = true;
    else if (a === '--headed') o.headed = true;
    else if (a === '--seeds') o.seeds = argv[++i];
    else if (a === '--out') o.out = argv[++i];
    else if (a === '--only') o.only = argv[++i] as ViewportName;
    else if (a === '--max-blocks') o.maxBlocks = Number(argv[++i]);
    else if (a === '--min-height') o.minHeight = Number(argv[++i]);
    else if (a === '--quality') o.quality = Number(argv[++i]);
    else if (a === '--help' || a === '-h') usage();
    else if (a.startsWith('--')) { console.error(`Unknown flag ${a}`); usage(); }
    else o.urls.push(a);
  }
  if (o.only && o.only !== 'desktop' && o.only !== 'mobile') { console.error('--only must be desktop or mobile'); usage(); }
  return o;
}

function normalizeUrl(input: string): string {
  let u = input.trim();
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  return new URL(u).toString();
}

function isBareHost(input: string): boolean {
  const u = new URL(normalizeUrl(input));
  return (u.pathname === '/' || u.pathname === '') && !u.search;
}

export function pageType(url: URL): string {
  const p = url.pathname.replace(/\/+$/, '') || '/';
  if (p === '/') return 'home';
  if (/^\/collections\/[^/]+\/products\/[^/]+/.test(p)) return 'product';
  if (/^\/products?\/[^/]+/.test(p)) return 'product';
  if (/^\/collections\/[^/]+/.test(p) || /^\/(product-category|category|shop|collection)(\/|$)/.test(p)) return 'collection';
  if (p === '/collections') return 'collection-list';
  if (/^\/cart/.test(p)) return 'cart';
  if (/checkout/.test(p)) return 'checkout';
  if (/^\/search/.test(p)) return 'search';
  if (/^\/account/.test(p)) return 'account';
  if (/^\/blogs\/[^/]+\/[^/]+/.test(p) || /^\/blog\/[^/]+/.test(p)) return 'article';
  if (/^\/blogs?(\/|$)/.test(p) || /^\/news(\/|$)/.test(p)) return 'blog';
  if (/^\/pages\//.test(p)) return 'page';
  return 'other';
}

function pageSlug(url: URL): string {
  const p = url.pathname.replace(/^\/+|\/+$/g, '');
  let slug = p ? p.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() : 'home';
  if (url.search) slug += '-' + createHash('sha1').update(url.search).digest('hex').slice(0, 6);
  return slug.slice(0, 80) || 'home';
}

function slugify(s: string): string {
  return s.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'block';
}

async function dismissOverlays(page: Page): Promise<void> {
  await page.keyboard.press('Escape').catch(() => {});
  await page
    .evaluate(() => {
      // Close (never accept) newsletter popups, modals and cookie banners.
      const sels = [
        '[role="dialog"] button[aria-label*="close" i]',
        '[role="dialog"] [class*="close" i]',
        '.klaviyo-close-form',
        '[class*="klaviyo"] [aria-label*="close" i]',
        '[class*="popup" i] [class*="close" i]',
        '[class*="modal" i] [class*="close" i]',
        '[id*="popup" i] [class*="close" i]',
        '[class*="newsletter" i] [class*="close" i]',
        'button[aria-label="Close"]',
        'button[aria-label="Close dialog"]',
        '[data-testid="close"]',
        '#onetrust-reject-all-handler',
        '#CybotCookiebotDialogBodyButtonDecline',
        '.cc-btn.cc-dismiss',
        '[class*="cookie" i] button[class*="decline" i]',
        '[class*="cookie" i] button[class*="reject" i]',
      ];
      let clicked = 0;
      for (const s of sels) {
        for (const el of Array.from(document.querySelectorAll<HTMLElement>(s))) {
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.height > 0 && clicked < 4) {
            el.click();
            clicked++;
          }
        }
      }
      return clicked;
    })
    .catch(() => 0);
}

async function autoScroll(page: Page): Promise<void> {
  await page
    .evaluate(async () => {
      const step = Math.max(300, Math.floor(window.innerHeight * 0.8));
      const limit = Math.min(document.documentElement.scrollHeight, 60000);
      for (let y = 0; y < limit; y += step) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 160));
      }
      window.scrollTo(0, document.documentElement.scrollHeight);
      await new Promise((r) => setTimeout(r, 400));
      window.scrollTo(0, 0);
    })
    .catch(() => {});
}

async function captureViewport(browser: Browser, url: string, vp: ViewportName, pageDir: string, opts: Options, polite: Politeness): Promise<ViewportResult> {
  const v = VIEWPORTS[vp];
  const context = await browser.newContext({
    viewport: { width: v.width, height: v.height },
    deviceScaleFactor: v.deviceScaleFactor,
    isMobile: v.isMobile,
    hasTouch: v.hasTouch,
    userAgent: v.userAgent,
    locale: 'en-US',
    colorScheme: 'light',
    reducedMotion: 'reduce',
    ignoreHTTPSErrors: true,
  });
  // tsx/esbuild wraps inner functions in a __name() helper that only exists in
  // Node. Functions we ship into the page via page.evaluate still contain the
  // call, so define a no-op shim in the page before any script runs.
  await context.addInitScript('globalThis.__name = globalThis.__name || ((f) => f);');
  const page = await context.newPage();
  page.setDefaultTimeout(45_000);
  const t0 = Date.now();
  let status: number | null = null;
  try {
    // One navigation per second per host (or the site's Crawl-delay).
    await polite.waitFor(url);
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    status = resp ? resp.status() : null;
    await page.waitForLoadState('load', { timeout: 20_000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
    await page
      .addStyleTag({ content: '*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;transition-duration:0s!important;scroll-behavior:auto!important}' })
      .catch(() => {});
    await page.waitForTimeout(1200);
    await dismissOverlays(page);
    await autoScroll(page);
    await page.waitForTimeout(600);
    await dismissOverlays(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(500);

    const site = await page.evaluate(detectSite);
    const meta = await page.evaluate(pageMeta);
    const collected = await page.evaluate(collectBlocks, { minHeight: opts.minHeight, maxBlocks: opts.maxBlocks });

    const fullFile = `${vp}.jpg`;
    let fullHeight = collected.docHeight;
    try {
      await page.screenshot({ path: path.join(pageDir, fullFile), fullPage: true, type: 'jpeg', quality: opts.quality });
    } catch (e) {
      console.warn(`  full-page screenshot failed (${vp}): ${(e as Error).message.split('\n')[0]}`);
      await page.screenshot({ path: path.join(pageDir, fullFile), type: 'jpeg', quality: opts.quality }).catch(() => {});
      fullHeight = VIEWPORTS[vp].height;
    }

    await mkdir(path.join(pageDir, 'blocks'), { recursive: true });
    const blocks: CapturedBlock[] = [];
    for (const b of collected.blocks) {
      const file = `blocks/${vp[0]}-${String(b.index).padStart(2, '0')}-${slugify(b.typeHint)}.jpg`;
      const loc = page.locator(`[data-secref="${b.ref}"]`).first();
      try {
        await loc.scrollIntoViewIfNeeded({ timeout: 10_000 });
        await page.waitForTimeout(120);
        await loc.screenshot({ path: path.join(pageDir, file), type: 'jpeg', quality: opts.quality, animations: 'disabled', timeout: 30_000 });
        blocks.push({ ...b, viewport: vp, file });
      } catch (e) {
        blocks.push({ ...b, viewport: vp, file: null, error: (e as Error).message.split('\n')[0] });
      }
    }
    return { ok: true, status, site, meta, strategy: collected.strategy, fullFile, fullHeight, blocks, ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, status, error: (e as Error).message.split('\n')[0], ms: Date.now() - t0 };
  } finally {
    await context.close();
  }
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const inputs = [...opts.urls];
  if (opts.seeds) {
    const txt = await readFile(opts.seeds, 'utf8');
    for (const line of txt.split(/\r?\n/)) {
      const l = line.trim();
      if (l && !l.startsWith('#')) inputs.push(l);
    }
  }
  if (!inputs.length) usage();

  const polite = await Politeness.fromConfig();
  await mkdir(opts.out, { recursive: true });
  const crawlLog = path.join(opts.out, 'crawl-log.jsonl');
  const log = (entry: Record<string, unknown>) => appendFile(crawlLog, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n');

  const targets: string[] = [];
  for (const input of inputs) {
    const url = normalizeUrl(input);
    if (polite.isBlocked(hostOf(url))) {
      console.log(`${url}: on the block list, skipped`);
      await log({ url, action: 'skipped', reason: 'blocklist' });
      continue;
    }
    if (opts.discover && isBareHost(input)) {
      const origin = new URL(url).origin;
      try {
        const d = await discoverShopify(polite, origin);
        console.log(`${origin}: ${d.shopify ? 'Shopify store, discovered' : 'not Shopify, using'} ${d.urls.length} page(s)` +
          (d.skipped.length ? `, skipped ${d.skipped.map((s) => new URL(s.url).pathname + ' (' + s.reason + ')').join(', ')}` : ''));
        for (const s of d.skipped) await log({ url: s.url, action: 'skipped', reason: s.reason });
        targets.push(...d.urls);
      } catch (e) {
        const reason = e instanceof PoliteError ? e.reason : String(e);
        console.log(`${origin}: discovery refused (${reason})`);
        await log({ url: origin, action: 'skipped', reason });
      }
    } else {
      targets.push(url);
    }
  }
  const uniq = [...new Set(targets)];
  const vps: ViewportName[] = opts.only ? [opts.only] : ['desktop', 'mobile'];
  console.log(`Capturing ${uniq.length} page(s) x ${vps.length} viewport(s) -> ${opts.out}/`);

  const browser = await chromium.launch({ headless: !opts.headed });
  try {
    for (const url of uniq) {
      const u = new URL(url);
      const host = u.hostname.replace(/^www\./, '');
      const verdict = await polite.allowed(url);
      if (!verdict.ok) {
        console.log(`\n${url}  skipped (${verdict.reason})`);
        await log({ url, host, action: 'skipped', reason: verdict.reason });
        continue;
      }
      const slug = pageSlug(u);
      const pageDir = path.join(opts.out, host, slug);
      await mkdir(pageDir, { recursive: true });
      console.log(`\n${url}  [${pageType(u)}]`);

      const manifest: {
        site: { host: string; origin: string } & Partial<SiteInfo>;
        page: { url: string; type: string; slug: string; capturedAt: string } & Partial<PageMeta>;
        viewports: Record<string, unknown>;
        blocks: CapturedBlock[];
      } = {
        site: { host, origin: u.origin },
        page: { url, type: pageType(u), slug, capturedAt: new Date().toISOString() },
        viewports: {},
        blocks: [],
      };

      for (const vp of vps) {
        const r = await captureViewport(browser, url, vp, pageDir, opts, polite);
        if (!r.ok) {
          console.log(`  ${vp}: FAILED ${r.error}`);
          manifest.viewports[vp] = { error: r.error, status: r.status };
          await log({ url, host, action: 'failed', viewport: vp, reason: r.error });
          continue;
        }
        await log({ url, host, action: 'captured', viewport: vp, blocks: r.blocks.length, ms: r.ms });
        const okBlocks = r.blocks.filter((b) => b.file).length;
        const themeName = r.site.theme && (r.site.theme as { name?: string }).name;
        console.log(`  ${vp}: ${r.site.platform}${themeName ? ' / ' + themeName : ''} · ${okBlocks}/${r.blocks.length} blocks (${r.strategy}) · ${(r.ms / 1000).toFixed(1)}s`);
        manifest.viewports[vp] = { file: r.fullFile, width: VIEWPORTS[vp].width, fullHeight: r.fullHeight, strategy: r.strategy, status: r.status, ms: r.ms };
        if (!manifest.site.platform) Object.assign(manifest.site, r.site);
        if (!manifest.page.title) Object.assign(manifest.page, r.meta);
        manifest.blocks.push(...r.blocks);
      }
      await writeFile(path.join(pageDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
    }
  } finally {
    await browser.close();
  }

  const n = await buildIndex(opts.out);
  console.log(`\nIndex rebuilt: ${n} page(s). Open viewer/index.html to browse.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
