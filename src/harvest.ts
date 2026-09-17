// Seed harvester (SEC-4): builds seeds/stores.csv, the 1,000 most successful
// e-commerce stores we can find, without anyone typing a list by hand.
//
//   npm run harvest                       all sources, top 1,000
//   npm run harvest -- --sources ecomm,gallery,catalog,search,lists --limit 1000
//   npm run harvest -- --no-live          skip the liveness pass (faster, rougher)
//
// Where candidates come from
//   ecomm     ecomm.design platform listings (server-rendered outbound links)
//   gallery   stores.gallery store pages
//   catalog   catalog.cool brand pages
//   search    Firecrawl web search per industry -> "best stores" articles -> their outbound links
//   lists     config/list-pages.txt, hand-picked articles treated the same way
//
// How "most successful" is decided
//   Every candidate host is looked up in the Tranco top-1M list (a free, public,
//   research-grade traffic ranking). Stores are ordered by Tranco rank first,
//   then by how many independent sources mention them. The top N alive stores
//   become seeds/stores.csv; everything found is kept in seeds/candidates.csv.
//
// Every request goes through the politeness rules (robots.txt, pacing, block
// list), including requests to the galleries themselves.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import * as cheerio from 'cheerio';
import { unzipSync, strFromU8 } from 'fflate';
import { Politeness, PoliteError, botUserAgent, DESKTOP_BASE_UA, hostOf } from './polite.js';

// Minimal .env loader (FIRECRAWL_API_KEY lives there, git-ignored).
try {
  const { readFileSync } = await import('node:fs');
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch {
  /* no .env */
}

type Candidate = {
  host: string;
  brand: string | null;
  sources: Set<string>;
  sourceUrls: Set<string>;
  mentions: number;
  industryHint: string | null;
};

type Live = { alive: boolean; status: number | null; finalHost: string | null; platform: string | null; title: string | null };

const INDUSTRIES = [
  'fashion and apparel', 'beauty and skincare', 'food and drink', 'supplements and wellness', 'subscription boxes',
  'kids and baby', 'pet products', 'home and furniture', 'jewellery and watches', 'sports and outdoor',
  'tech accessories and gadgets', 'gifts and stationery',
];

const QUERY_TEMPLATES = [
  'best {industry} shopify stores',
  'top {industry} dtc brands online store',
  'best {industry} ecommerce website design examples',
];

// Hosts that show up in every "best stores" article but are not stores we
// want: marketplaces, platforms, tools, media, socials. The validator (SEC-5)
// catches what slips through.
const JUNK = new Set([
  'amazon.com', 'amazon.co.uk', 'ebay.com', 'etsy.com', 'walmart.com', 'target.com', 'aliexpress.com', 'alibaba.com', 'temu.com', 'shein.com',
  'shopify.com', 'myshopify.com', 'bigcommerce.com', 'woocommerce.com', 'wordpress.com', 'wordpress.org', 'wix.com', 'squarespace.com', 'webflow.com',
  'framer.com', 'magento.com', 'adobe.com', 'salesforce.com', 'google.com', 'facebook.com', 'instagram.com', 'tiktok.com', 'youtube.com', 'youtu.be',
  'pinterest.com', 'twitter.com', 'x.com', 'linkedin.com', 'reddit.com', 'medium.com', 'wikipedia.org', 'apple.com', 'microsoft.com', 'github.com',
  'klaviyo.com', 'gorgias.com', 'recharge.com', 'rechargepayments.com', 'yotpo.com', 'judge.me', 'okendo.io', 'loox.io', 'stamped.io', 'rebuyengine.com',
  'hubspot.com', 'mailchimp.com', 'canva.com', 'figma.com', 'dribbble.com', 'behance.net', 'awwwards.com', 'land-book.com', 'ecomm.design',
  'stores.gallery', 'catalog.cool', 'commercecream.com', 'baymard.com', 'similarweb.com', 'builtwith.com', 'storeleads.app', 'semrush.com', 'ahrefs.com',
  'trustpilot.com', 'g2.com', 'capterra.com', 'forbes.com', 'businessinsider.com', 'nytimes.com', 'theverge.com', 'techcrunch.com', 'vogue.com',
  'cnn.com', 'bbc.co.uk', 'bbc.com', 'buzzfeed.com', 'oberlo.com', 'printful.com', 'printify.com', 'cratejoy.com', 'kickstarter.com', 'indiegogo.com',
  'paypal.com', 'stripe.com', 'klarna.com', 'afterpay.com', 'sezzle.com', 'affirm.com', 'shop.app', 'linktr.ee', 'bit.ly', 'goo.gl', 'w3.org', 'schema.org',
  'cloudflare.com', 'vercel.com', 'netlify.com', 'imgix.net', 'cloudinary.com', 'jsdelivr.net', 'unpkg.com', 'gstatic.com', 'googleapis.com',
  'shopify.dev', 'help.shopify.com', 'apps.shopify.com', 'themes.shopify.com', 'shopify.pxf.io', 'cdn.shopify.com', 'shopifycdn.com',
]);
const JUNK_SUFFIXES = ['.myshopify.com', '.shopify.com', '.amazon.com', '.google.com', '.wordpress.com', '.wixsite.com', '.squarespace.com', '.webflow.io', '.framer.website', '.gov', '.edu'];

function isJunk(host: string): boolean {
  if (!host.includes('.')) return true;
  if (JUNK.has(host)) return true;
  const parts = host.split('.');
  for (let i = 1; i < parts.length - 1; i++) if (JUNK.has(parts.slice(i).join('.'))) return true;
  return JUNK_SUFFIXES.some((s) => host.endsWith(s));
}

function normHost(raw: string): string | null {
  try {
    const u = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
    if (!['http:', 'https:'].includes(u.protocol)) return null;
    const h = u.hostname.toLowerCase().replace(/^www\./, '');
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(h)) return null;
    return h;
  } catch {
    return null;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class Harvest {
  readonly candidates = new Map<string, Candidate>();
  readonly stats: Record<string, number> = {};
  constructor(readonly polite: Politeness) {}

  add(host: string, source: string, sourceUrl: string, brand: string | null = null, industryHint: string | null = null) {
    if (isJunk(host)) return;
    let c = this.candidates.get(host);
    if (!c) {
      c = { host, brand, sources: new Set(), sourceUrls: new Set(), mentions: 0, industryHint };
      this.candidates.set(host, c);
    }
    c.sources.add(source);
    if (!c.sourceUrls.has(sourceUrl)) {
      c.sourceUrls.add(sourceUrl);
      c.mentions++;
    }
    if (!c.brand && brand) c.brand = brand;
    if (!c.industryHint && industryHint) c.industryHint = industryHint;
    this.stats[source] = (this.stats[source] || 0) + 1;
  }

  async html(url: string): Promise<string | null> {
    try {
      const r = await this.polite.fetch(url, { headers: { accept: 'text/html,*/*' } });
      if (!r.ok) return null;
      return await r.text();
    } catch (e) {
      if (e instanceof PoliteError) console.log(`  refused ${url} (${e.reason})`);
      return null;
    }
  }

  // ---- Source: ecomm.design ------------------------------------------------
  async ecomm(): Promise<void> {
    const listings = ['https://ecomm.design/platform/shopify-stores/', 'https://ecomm.design/platform/woocommerce-stores/',
      'https://ecomm.design/platform/bigcommerce-stores/', 'https://ecomm.design/platform/magento-stores/', 'https://ecomm.design/ecommerce-websites/'];
    for (const listing of listings) {
      let empty = 0;
      for (let n = 1; n <= 150; n++) {
        const url = n === 1 ? listing : `${listing}page/${n}/`;
        const html = await this.html(url);
        if (!html) break;
        const $ = cheerio.load(html);
        let found = 0;
        $('a[href*="?ref=ecommdesign"]').each((_i, a) => {
          const href = $(a).attr('href') || '';
          const host = normHost(href.replace(/\?ref=ecommdesign.*$/, ''));
          if (!host) return;
          const brand = $(a).attr('title') || $(a).text().trim() || null;
          const before = this.candidates.size;
          this.add(host, 'ecomm', url, brand && brand.length < 80 ? brand : null);
          if (this.candidates.size > before) found++;
        });
        if (found === 0 && ++empty >= 2) break;
        if (found > 0) empty = 0;
      }
      console.log(`  ecomm.design ${listing.split('/').filter(Boolean).pop()}: ${this.candidates.size} candidates so far`);
    }
  }

  // ---- Source: stores.gallery ----------------------------------------------
  async gallery(): Promise<void> {
    const slugs = new Set<string>();
    for (let n = 1; n <= 40; n++) {
      const url = n === 1 ? 'https://stores.gallery/stores' : `https://stores.gallery/stores?page=${n}`;
      const html = await this.html(url);
      if (!html) break;
      const before = slugs.size;
      for (const m of html.matchAll(/href="\/stores\/([a-z0-9-]+)"/g)) slugs.add(m[1]);
      if (slugs.size === before) break;
    }
    console.log(`  stores.gallery: ${slugs.size} store pages to read`);
    for (const slug of slugs) {
      const url = `https://stores.gallery/stores/${slug}`;
      const html = await this.html(url);
      if (!html) continue;
      const m = html.match(/"url":"(https?:\/\/(?!cdn\.stores\.gallery|stores\.gallery)[^"]+)"/);
      const host = m ? normHost(m[1]) : null;
      if (host) {
        const title = (html.match(/<title>([^<]*)<\/title>/)?.[1] || '').split(/[|·-]/)[0].trim();
        this.add(host, 'gallery', url, title || null);
      }
    }
  }

  // ---- Source: catalog.cool ------------------------------------------------
  async catalog(): Promise<void> {
    const slugs = new Set<string>();
    for (const url of ['https://catalog.cool/', 'https://catalog.cool/brands']) {
      const html = await this.html(url);
      if (!html) continue;
      for (const m of html.matchAll(/href="\/brands\/([a-z0-9-]+)"/g)) slugs.add(m[1]);
    }
    for (let n = 2; n <= 30; n++) {
      const html = await this.html(`https://catalog.cool/brands?page=${n}`);
      if (!html) break;
      const before = slugs.size;
      for (const m of html.matchAll(/href="\/brands\/([a-z0-9-]+)"/g)) slugs.add(m[1]);
      if (slugs.size === before) break;
    }
    console.log(`  catalog.cool: ${slugs.size} brand pages to read`);
    for (const slug of slugs) {
      const url = `https://catalog.cool/brands/${slug}`;
      const html = await this.html(url);
      if (!html) continue;
      const $ = cheerio.load(html);
      let host: string | null = null;
      $('a[href^="http"]').each((_i, a) => {
        if (host) return;
        const h = normHost($(a).attr('href') || '');
        if (h && !isJunk(h) && !h.endsWith('catalog.cool')) host = h;
      });
      if (host) this.add(host, 'catalog', url, slug.replace(/-/g, ' '));
    }
  }

  // ---- Source: articles ("best X stores") -> outbound links ----------------
  async article(url: string, source: string, industryHint: string | null): Promise<void> {
    const html = await this.html(url);
    if (!html) return;
    const $ = cheerio.load(html);
    const pageHost = normHost(url);
    const seen = new Set<string>();
    $('a[href^="http"]').each((_i, a) => {
      const h = normHost($(a).attr('href') || '');
      if (!h || h === pageHost || (pageHost && h.endsWith('.' + pageHost)) || isJunk(h) || seen.has(h)) return;
      seen.add(h);
      const text = $(a).text().trim();
      this.add(h, source, url, text && text.length < 60 && !/^https?:/.test(text) ? text : null, industryHint);
    });
  }

  async lists(file = 'config/list-pages.txt'): Promise<void> {
    let text = '';
    try {
      text = await readFile(file, 'utf8');
    } catch {
      console.log('  no config/list-pages.txt, skipping');
      return;
    }
    const urls = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
    console.log(`  lists: ${urls.length} article(s)`);
    await this.parallel(urls, 4, (u) => this.article(u, 'lists', null));
  }

  async search(maxQueries = Infinity): Promise<void> {
    const key = process.env.FIRECRAWL_API_KEY;
    if (!key) {
      console.log('  no FIRECRAWL_API_KEY in .env, skipping search');
      return;
    }
    const queries: { q: string; industry: string }[] = [];
    for (const industry of INDUSTRIES) for (const t of QUERY_TEMPLATES) queries.push({ q: t.replace('{industry}', industry), industry });
    const pages = new Map<string, string>();
    let done = 0;
    for (const { q, industry } of queries.slice(0, maxQueries)) {
      try {
        const r = await fetch('https://api.firecrawl.dev/v1/search', {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: q, limit: 10 }),
          signal: AbortSignal.timeout(30_000),
        });
        if (!r.ok) {
          console.log(`  search "${q}" -> HTTP ${r.status}, stopping search source`);
          break;
        }
        const j = (await r.json()) as { data?: { url: string }[] };
        for (const d of j.data || []) {
          const h = normHost(d.url);
          if (!h) continue;
          // A result that IS a store (not an article) counts as a candidate too.
          if (!pages.has(d.url)) pages.set(d.url, industry);
        }
        done++;
        await sleep(400);
      } catch (e) {
        console.log(`  search "${q}" failed: ${(e as Error).message.split('\n')[0]}`);
      }
    }
    console.log(`  search: ${done} queries, ${pages.size} result pages to read`);
    await this.parallel([...pages.entries()], 4, async ([u, industry]) => {
      const h = normHost(u);
      if (h && !isJunk(h)) this.add(h, 'search-result', u, null, industry);
      await this.article(u, 'search', industry);
    });
  }

  async parallel<T>(items: T[], workers: number, fn: (item: T) => Promise<void>): Promise<void> {
    let i = 0;
    await Promise.all(Array.from({ length: workers }, async () => {
      while (i < items.length) {
        const item = items[i++];
        await fn(item);
      }
    }));
  }
}

// ---- Tranco ranking ---------------------------------------------------------
async function tranco(dataDir: string): Promise<Map<string, number>> {
  const dir = path.join(dataDir, 'tranco');
  const csv = path.join(dir, 'top-1m.csv');
  await mkdir(dir, { recursive: true });
  if (!existsSync(csv)) {
    console.log('  downloading Tranco top-1M list…');
    const r = await fetch('https://tranco-list.eu/top-1m.csv.zip', { redirect: 'follow', signal: AbortSignal.timeout(120_000) });
    if (!r.ok) throw new Error(`Tranco download failed: HTTP ${r.status}`);
    const zip = new Uint8Array(await r.arrayBuffer());
    const files = unzipSync(zip);
    const name = Object.keys(files).find((n) => n.endsWith('.csv'));
    if (!name) throw new Error('Tranco zip had no csv');
    await writeFile(csv, strFromU8(files[name]));
  }
  const map = new Map<string, number>();
  for (const line of (await readFile(csv, 'utf8')).split('\n')) {
    const i = line.indexOf(',');
    if (i < 0) continue;
    map.set(line.slice(i + 1).trim().toLowerCase(), Number(line.slice(0, i)));
  }
  return map;
}

function rankOf(map: Map<string, number>, host: string): number | null {
  const parts = host.split('.');
  for (let i = 0; i < parts.length - 1; i++) {
    const r = map.get(parts.slice(i).join('.'));
    if (r) return r;
  }
  return null;
}

// ---- Liveness ---------------------------------------------------------------
async function probe(host: string): Promise<Live> {
  const out: Live = { alive: false, status: null, finalHost: null, platform: null, title: null };
  try {
    const r = await fetch(`https://${host}/`, {
      headers: { 'user-agent': botUserAgent(DESKTOP_BASE_UA), accept: 'text/html,*/*' },
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000),
    });
    out.status = r.status;
    out.finalHost = hostOf(r.url);
    if (!r.ok) return out;
    const html = (await r.text()).slice(0, 400_000);
    const low = html.toLowerCase();
    out.alive = true;
    out.title = (html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] || '').replace(/\s+/g, ' ').trim().slice(0, 120) || null;
    if (low.includes('cdn.shopify.com') || low.includes('shopify.theme')) out.platform = 'shopify';
    else if (low.includes('woocommerce')) out.platform = 'woocommerce';
    else if (low.includes('/wp-content/')) out.platform = 'wordpress';
    else if (low.includes('bigcommerce.com')) out.platform = 'bigcommerce';
    else if (low.includes('data-wf-site')) out.platform = 'webflow';
    else if (low.includes('squarespace')) out.platform = 'squarespace';
    else if (low.includes('wixstatic.com')) out.platform = 'wix';
    else if (low.includes('demandware')) out.platform = 'salesforce';
    else if (low.includes('/static/version') && low.includes('mage/')) out.platform = 'magento';
    else if (low.includes('/_next/')) out.platform = 'nextjs';
  } catch {
    /* dead or slow */
  }
  return out;
}

// ---- CSV --------------------------------------------------------------------
const csvCell = (v: unknown) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csvLine = (cells: unknown[]) => cells.map(csvCell).join(',');

// ---- Main -------------------------------------------------------------------
async function main() {
  const args = process.argv.slice(2);
  const opt = (name: string, def: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : def;
  };
  const sources = opt('--sources', 'ecomm,gallery,catalog,search,lists').split(',');
  const limit = Number(opt('--limit', '1000'));
  const maxQueries = Number(opt('--queries', '999'));
  const live = !args.includes('--no-live');
  const dataDir = opt('--data', 'data');

  await mkdir('seeds', { recursive: true });
  const polite = await Politeness.fromConfig();
  const h = new Harvest(polite);
  const t0 = Date.now();

  console.log('Sources:', sources.join(', '));
  if (sources.includes('ecomm')) await h.ecomm();
  if (sources.includes('gallery')) await h.gallery();
  if (sources.includes('catalog')) await h.catalog();
  if (sources.includes('lists')) await h.lists();
  if (sources.includes('search')) await h.search(maxQueries);
  console.log(`\n${h.candidates.size} candidate hosts after ${((Date.now() - t0) / 60000).toFixed(1)} min. Per source:`, JSON.stringify(h.stats));

  console.log('\nRanking with Tranco…');
  const ranks = await tranco(dataDir);
  const rows = [...h.candidates.values()].map((c) => ({ ...c, rank: rankOf(ranks, c.host) }));
  rows.sort((a, b) => {
    if (a.rank && b.rank) return a.rank - b.rank;
    if (a.rank) return -1;
    if (b.rank) return 1;
    return b.mentions - a.mentions || b.sources.size - a.sources.size || a.host.localeCompare(b.host);
  });
  const ranked = rows.filter((r) => r.rank).length;
  console.log(`  ${ranked} of ${rows.length} candidates have a Tranco rank`);

  const liveMap = new Map<string, Live>();
  if (live) {
    const toProbe = rows.slice(0, Math.max(limit * 1.5, limit + 200));
    console.log(`\nLiveness: probing ${toProbe.length} hosts (8 at a time)…`);
    let done = 0;
    await h.parallel(toProbe, 8, async (r) => {
      liveMap.set(r.host, await probe(r.host));
      if (++done % 100 === 0) console.log(`  ${done}/${toProbe.length}`);
    });
  }

  // Merge hosts that redirect to the same final host (brand.com -> shop.brand.com).
  const seenFinal = new Set<string>();
  const chosen: typeof rows = [];
  for (const r of rows) {
    const l = liveMap.get(r.host);
    if (live && (!l || !l.alive)) continue;
    const fh = l?.finalHost || r.host;
    if (seenFinal.has(fh)) continue;
    seenFinal.add(fh);
    chosen.push(r);
    if (chosen.length >= limit) break;
  }

  const header = ['host', 'final_host', 'brand', 'title', 'platform', 'tranco_rank', 'mentions', 'sources', 'industry_hint', 'source_urls'];
  const toRow = (r: (typeof rows)[number]) => {
    const l = liveMap.get(r.host);
    return csvLine([r.host, l?.finalHost || '', r.brand || '', l?.title || '', l?.platform || '', r.rank || '', r.mentions,
      [...r.sources].join('|'), r.industryHint || '', [...r.sourceUrls].slice(0, 3).join('|')]);
  };
  await writeFile('seeds/candidates.csv', [csvLine(header), ...rows.map(toRow)].join('\n') + '\n', 'utf8');
  await writeFile('seeds/stores.csv', [csvLine(header), ...chosen.map(toRow)].join('\n') + '\n', 'utf8');

  const platforms: Record<string, number> = {};
  for (const r of chosen) {
    const p = liveMap.get(r.host)?.platform || 'unknown';
    platforms[p] = (platforms[p] || 0) + 1;
  }
  console.log(`\nseeds/stores.csv: ${chosen.length} stores (${chosen.filter((r) => r.rank).length} with a Tranco rank). Platforms: ${JSON.stringify(platforms)}`);
  console.log(`seeds/candidates.csv: ${rows.length} candidates. Total ${((Date.now() - t0) / 60000).toFixed(1)} min.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
