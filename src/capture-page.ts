// Capturing one page: both viewports, full-page and per-block screenshots,
// the manifest. Used by the one-off CLI (capture.ts) and by the crawl worker
// (crawl.ts). The manifest it writes is a cross-lane contract:
// web/src/contracts/manifest.ts, guarded by src/contract-check.ts.
import type { Browser, BrowserContext, Page } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { collectBlocks, collectLinks, detectSite, pageMeta, type BlockInfo, type SiteInfo, type PageMeta } from './page-script.js';
import { Politeness, botUserAgent, DESKTOP_BASE_UA, MOBILE_BASE_UA, type Lane } from './polite.js';

export type ViewportName = 'desktop' | 'mobile';

// The real browser UA plus our bot token, so site owners can see who we are.
export const VIEWPORTS: Record<ViewportName, { width: number; height: number; deviceScaleFactor: number; isMobile: boolean; hasTouch: boolean; userAgent: string }> = {
  desktop: { width: 1440, height: 900, deviceScaleFactor: 1, isMobile: false, hasTouch: false, userAgent: botUserAgent(DESKTOP_BASE_UA) },
  mobile: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: botUserAgent(MOBILE_BASE_UA) },
};

export type CaptureOptions = {
  out: string;
  only: ViewportName | null;
  maxBlocks: number;
  minHeight: number;
  quality: number;
  /** Hard ceiling for one viewport of one page; a hung site must not stall a night's run. */
  viewportTimeoutMs: number;
  /** Also return the page's same-origin links (from the first successful viewport). */
  wantLinks: boolean;
  /** The store this page belongs to. A store that redirects to a regional host (us.brand.com) still files under its own name. Default: the URL's host without www. */
  host?: string;
  /** Platform lane for the robots.txt request (Shopify throttles per IP across stores). */
  lane?: Lane;
};

export const DEFAULT_CAPTURE: CaptureOptions = { out: 'data', only: null, maxBlocks: 40, minHeight: 80, quality: 88, viewportTimeoutMs: 150_000, wantLinks: false };

export type CapturedBlock = BlockInfo & { viewport: ViewportName; file: string | null; error?: string };

type ViewportResult =
  | { ok: true; status: number | null; site: SiteInfo; meta: PageMeta; strategy: string; fullFile: string; fullHeight: number; blocks: CapturedBlock[]; links: string[]; finalUrl: string; ms: number }
  | { ok: false; status: number | null; error: string; ms: number };

export type PageResult = {
  url: string;
  host: string;
  slug: string;
  type: string;
  /** captured = every requested viewport worked; partial = some did; failed = none; skipped = never requested. */
  status: 'captured' | 'partial' | 'failed' | 'skipped';
  reason: string | null;
  blocks: number;
  ms: Partial<Record<ViewportName, number>>;
  site: SiteInfo | null;
  links: string[];
  /** Where the browser ended up (brand.com often lands on www.brand.com or a regional host). */
  finalUrl: string | null;
  lines: string[];
};

// A leading language or region segment: /gl, /en-us, /us/en, /en_GB.
const LOCALE_PREFIX = /^\/(?:[a-z]{2}(?:[-_][a-z]{2})?)(?:\/(?:[a-z]{2}(?:[-_][a-z]{2})?))?(?=\/|$)/i;

export function pageType(url: URL): string {
  const p = url.pathname.replace(/\/+$/, '') || '/';
  const t = typeOfPath(p);
  // International stores put the region first (/gl/product/P006524). Only when
  // the path means nothing as it stands, so /dp/B00X stays a product.
  if (t === 'other' && LOCALE_PREFIX.test(p)) return typeOfPath(p.replace(LOCALE_PREFIX, '') || '/');
  return t;
}

function typeOfPath(p: string): string {
  if (p === '/') return 'home';
  if (/^\/collections\/[^/]+\/products\/[^/]+/.test(p)) return 'product';
  if (/^\/products?\/[^/]+/.test(p)) return 'product';
  if (/^\/(p|item|shop\/p|dp)\/[^/]+/.test(p)) return 'product';
  if (/^\/collections\/[^/]+/.test(p) || /^\/(product-category|category|categories|shop|collection|c)(\/[^/]+)+$/.test(p)) return 'collection';
  if (p === '/collections' || p === '/shop' || p === '/store') return 'collection-list';
  if (/^\/cart/.test(p) || /^\/(basket|bag)(\/|$)/.test(p) || /(^|\/)checkout\/cart(\/|$)/.test(p)) return 'cart'; // /checkout/cart is Magento's cart
  if (/checkout/.test(p)) return 'checkout';
  if (/^\/search/.test(p)) return 'search';
  if (/^\/(account|login|signin|register)/.test(p)) return 'account';
  if (/^\/blogs\/[^/]+\/[^/]+/.test(p) || /^\/blog\/[^/]+/.test(p)) return 'article';
  if (/^\/blogs?(\/|$)/.test(p) || /^\/news(\/|$)/.test(p)) return 'blog';
  if (/^\/pages\//.test(p)) return 'page';
  return 'other';
}

export function pageSlug(url: URL): string {
  const p = url.pathname.replace(/^\/+|\/+$/g, '');
  let slug = p ? p.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() : 'home';
  if (url.search) slug += '-' + createHash('sha1').update(url.search).digest('hex').slice(0, 6);
  return slug.slice(0, 80) || 'home';
}

function slugify(s: string): string {
  return s.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'block';
}

// Consent dialogs are hidden, never clicked. A bot cannot give consent, and
// "decline" is a different button on every tool (some offer none on the first
// screen). Hiding leaves no consent on record, keeps the dialog out of every
// screenshot, and as a style rule it also covers dialogs that show up late.
const HIDE_CONSENT_CSS = `
#CybotCookiebotDialog, #CybotCookiebotDialogBodyUnderlay,
#onetrust-consent-sdk, #onetrust-banner-sdk, .onetrust-pc-dark-filter,
#usercentrics-root, #usercentrics-cmp-ui, #uc-center-container,
#didomi-host, #didomi-notice, .didomi-popup-backdrop,
#truste-consent-track, .truste_overlay, .truste_box_overlay, #consent_blackbar, #teconsent,
#shopify-pc__banner, .shopify-pc__banner__dialog,
#iubenda-cs-banner,
.cky-consent-container, .cky-overlay,
#cmplz-cookiebanner-container, .cmplz-cookiebanner,
#termly-code-snippet-support,
#qc-cmp2-container, .qc-cmp2-container,
[id^="sp_message_container"],
#cookiescript_injected, #cookiescript_injected_wrapper,
#BorlabsCookieBox,
#axeptio_overlay, .axeptio_mount,
.osano-cm-window, .osano-cm-dialog,
#klaro, .klaro,
#cookie-law-info-bar, .cli-modal-backdrop,
#hs-eu-cookie-confirmation,
#pandectes-banner, .pandectes-cookie-banner,
#cookie-notice, #cookieConsent, #cookie-consent, #cookie-banner, #cookiebanner, #cookie-bar,
.cookie-banner, .cookie-consent, .cookie-notice, .cookie-bar, .cc-window, .cc-banner,
#gdpr-cookie-message, .gdpr-cookie-notice
{ display: none !important; visibility: hidden !important; }
`;

async function dismissOverlays(page: Page): Promise<void> {
  // A hidden consent dialog can leave the page scroll-locked; without scrolling nothing lazy-loads.
  await page
    .evaluate(() => {
      for (const el of [document.documentElement, document.body]) {
        if (el && getComputedStyle(el).overflowY === 'hidden' && el.scrollHeight > window.innerHeight * 1.5) el.style.setProperty('overflow-y', 'auto', 'important');
      }
    })
    .catch(() => {});
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

async function captureViewportInner(context: BrowserContext, url: string, vp: ViewportName, pageDir: string, opts: CaptureOptions, polite: Politeness): Promise<ViewportResult> {
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
    await polite.waitFor(url, opts.lane);
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    status = resp ? resp.status() : null;
    // A bot wall or a dead page is not a capture. 404 and friends fail fast.
    if (status !== null && status >= 400) return { ok: false, status, error: `http-${status}`, ms: Date.now() - t0 };
    await page.waitForLoadState('load', { timeout: 20_000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
    await page
      .addStyleTag({ content: '*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;transition-duration:0s!important;scroll-behavior:auto!important}' + HIDE_CONSENT_CSS })
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
    const links = opts.wantLinks ? await page.evaluate(collectLinks, 400).catch(() => [] as string[]) : [];
    const collected = await page.evaluate(collectBlocks, { minHeight: opts.minHeight, maxBlocks: opts.maxBlocks });

    const fullFile = `${vp}.jpg`;
    let fullHeight = collected.docHeight;
    try {
      await page.screenshot({ path: path.join(pageDir, fullFile), fullPage: true, type: 'jpeg', quality: opts.quality });
    } catch {
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
    return { ok: true, status, site, meta, strategy: collected.strategy, fullFile, fullHeight, blocks, links, finalUrl: page.url(), ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, status, error: (e as Error).message.split('\n')[0], ms: Date.now() - t0 };
  }
}

/** One viewport with a hard ceiling: when time runs out the context is closed, which unblocks anything still waiting on the page. */
async function captureViewport(browser: Browser, url: string, vp: ViewportName, pageDir: string, opts: CaptureOptions, polite: Politeness): Promise<ViewportResult> {
  const v = VIEWPORTS[vp];
  const t0 = Date.now();
  let context: BrowserContext;
  try {
    context = await browser.newContext({
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
  } catch (e) {
    return { ok: false, status: null, error: `browser: ${(e as Error).message.split('\n')[0]}`, ms: Date.now() - t0 };
  }
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<ViewportResult>((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, status: null, error: 'page-timeout', ms: Date.now() - t0 }), opts.viewportTimeoutMs);
  });
  try {
    return await Promise.race([captureViewportInner(context, url, vp, pageDir, opts, polite), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
    await context.close().catch(() => {});
  }
}

/** Capture one page at the requested viewports and write its manifest. Never throws. */
export async function capturePage(browser: Browser, url: string, opts: CaptureOptions, polite: Politeness): Promise<PageResult> {
  const u = new URL(url);
  const host = opts.host || u.hostname.replace(/^www\./, '');
  const slug = pageSlug(u);
  const type = pageType(u);
  const result: PageResult = { url, host, slug, type, status: 'failed', reason: null, blocks: 0, ms: {}, site: null, links: [], finalUrl: null, lines: [] };

  const verdict = await polite.allowed(url, opts.lane);
  if (!verdict.ok) {
    result.status = 'skipped';
    result.reason = verdict.reason;
    return result;
  }

  const pageDir = path.join(opts.out, host, slug);
  await mkdir(pageDir, { recursive: true });
  const manifest: {
    site: { host: string; origin: string } & Partial<SiteInfo>;
    page: { url: string; type: string; slug: string; capturedAt: string } & Partial<PageMeta>;
    viewports: Record<string, unknown>;
    blocks: CapturedBlock[];
  } = { site: { host, origin: u.origin }, page: { url, type, slug, capturedAt: new Date().toISOString() }, viewports: {}, blocks: [] };

  const vps: ViewportName[] = opts.only ? [opts.only] : ['desktop', 'mobile'];
  let okCount = 0;
  const errors: string[] = [];
  for (const vp of vps) {
    const r = await captureViewport(browser, url, vp, pageDir, opts, polite);
    result.ms[vp] = r.ms;
    if (!r.ok) {
      manifest.viewports[vp] = { error: r.error, status: r.status };
      errors.push(`${vp}: ${r.error}`);
      result.lines.push(`  ${vp}: FAILED ${r.error}`);
      // A 4xx/5xx or a dead page will not improve at another width.
      if (/^http-|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION/.test(r.error)) break;
      continue;
    }
    okCount++;
    const okBlocks = r.blocks.filter((b) => b.file).length;
    const themeName = r.site.theme && (r.site.theme as { name?: string }).name;
    result.lines.push(`  ${vp}: ${r.site.platform}${themeName ? ' / ' + themeName : ''} · ${okBlocks}/${r.blocks.length} blocks (${r.strategy}) · ${(r.ms / 1000).toFixed(1)}s`);
    manifest.viewports[vp] = { file: r.fullFile, width: VIEWPORTS[vp].width, fullHeight: r.fullHeight, strategy: r.strategy, status: r.status, ms: r.ms };
    if (!manifest.site.platform) Object.assign(manifest.site, r.site);
    if (!manifest.page.title) Object.assign(manifest.page, r.meta);
    if (!result.site) result.site = r.site;
    if (!result.links.length) result.links = r.links;
    if (!result.finalUrl) result.finalUrl = r.finalUrl;
    manifest.blocks.push(...r.blocks);
    result.blocks += okBlocks;
  }

  if (okCount > 0) await writeFile(path.join(pageDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  // Kept so page discovery can be improved and re-run later without visiting the store again.
  if (opts.wantLinks && result.links.length) await writeFile(path.join(pageDir, 'links.json'), JSON.stringify(result.links, null, 1), 'utf8');
  result.status = okCount === vps.length ? 'captured' : okCount > 0 ? 'partial' : 'failed';
  result.reason = errors.length ? errors.join('; ') : null;
  return result;
}
