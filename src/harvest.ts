// Seed harvester (SEC-4): builds seeds/stores.csv, the 1,000 most successful
// e-commerce stores we can find, without anyone typing a list by hand.
//
//   npm run harvest                       all sources, top 1,000, merges with the previous run
//   npm run harvest -- --sources ecomm,gallery,catalog,search,lists --limit 1000
//   npm run harvest -- --no-live          skip the liveness pass (faster, rougher)
//   npm run harvest -- --fresh            ignore seeds/candidates.csv from earlier runs
//
// Where candidates come from
//   ecomm     ecomm.design's public WordPress API: 4,000+ stores with URL, brand and platform
//   gallery   stores.gallery store pages, enumerated through its sitemap
//   catalog   catalog.cool brand pages, enumerated through its sitemap
//   search    Firecrawl web search per industry -> "best stores" articles -> their outbound links
//   lists     config/list-pages.txt, hand-picked articles treated the same way
//
// How "most successful" is decided
//   Every candidate host is looked up in the Tranco top-1M list (a free, public,
//   research-grade traffic ranking refreshed daily). Stores are ordered by Tranco
//   rank first, then by how many independent sources mention them. The top N
//   alive stores become seeds/stores.csv; everything found stays in
//   seeds/candidates.csv and is merged into the next run.
//
// Every request goes through the politeness rules (robots.txt, pacing, block
// list), including requests to the galleries themselves.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import * as cheerio from 'cheerio';
import { unzipSync, strFromU8 } from 'fflate';
import { Politeness, PoliteError, botUserAgent, DESKTOP_BASE_UA, hostOf, lanes, laneFor, retryAfterMs } from './polite.js';

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
  platformHint: string | null;
};

type Live = {
  alive: boolean;
  status: number | null;
  finalHost: string | null;
  platform: string | null;
  title: string | null;
  /** Looks like a shop: an e-commerce platform, or enough cart/product signals in the HTML. */
  store: boolean;
  signals: number;
  ts: number;
};

const ECOM_PLATFORMS = new Set(['shopify', 'woocommerce', 'bigcommerce', 'magento', 'salesforce']);
const STORE_SIGNALS = [
  'add to cart', 'add-to-cart', 'addtocart', 'href="/cart', 'checkout', '"@type":"product"', '"@type": "product"', 'data-product',
  'product-form', '/products/', '/collections/', '/product/', 'buy now', 'shop now', 'shopping bag', 'shopping cart', 'your cart', 'basket',
  'free shipping', 'sold out', 'add to bag',
];

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
  'mysubscriptionaddiction.com', 'instyle.com', 'wisepops.com', 'groovecommerce.com', 'posstack.com', 'muz.li', 'storetasker.com', 'wired.com',
  'glamour.com', 'elle.com', 'harpersbazaar.com', 'goodhousekeeping.com', 'cosmopolitan.com', 'allure.com', 'refinery29.com', 'nbcnews.com', 'cnet.com',
  'openai.com', 'vimeo.com', 'discord.gg', 'discord.com', 'mozilla.org', 'theguardian.com', 'calendly.com', 'bsky.app', 'claude.ai', 'anthropic.com',
  'substack.com', 'cnbc.com', 'notion.so', 'notion.com', 'slack.com', 'zoom.us', 'spotify.com', 'netflix.com', 'twitch.tv', 'tumblr.com', 'blogspot.com',
  'typeform.com', 'patreon.com', 'eventbrite.com', 'meetup.com', 'yelp.com', 'tripadvisor.com', 'booking.com', 'airbnb.com', 'uber.com', 'doordash.com',
  'nih.gov', 'who.int', 'statista.com', 'shopifyplus.com', 'klaviyo.io', 'gumroad.com', 'producthunt.com', 'ycombinator.com', 'crunchbase.com',
]);
const JUNK_SUFFIXES = ['.myshopify.com', '.shopify.com', '.amazon.com', '.google.com', '.wordpress.com', '.wixsite.com', '.squarespace.com', '.webflow.io', '.framer.website', '.substack.com', '.blogspot.com', '.tumblr.com', '.notion.site', '.gov', '.edu'];

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

const decode = (s: string) => cheerio.load(`<x>${s}</x>`)('x').text().replace(/\s+/g, ' ').trim();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class Harvest {
  readonly candidates = new Map<string, Candidate>();
  readonly stats: Record<string, number> = {};
  constructor(readonly polite: Politeness) {}

  add(host: string, source: string, sourceUrl: string, brand: string | null = null, industryHint: string | null = null, platformHint: string | null = null) {
    if (isJunk(host)) return;
    let c = this.candidates.get(host);
    if (!c) {
      c = { host, brand, sources: new Set(), sourceUrls: new Set(), mentions: 0, industryHint, platformHint };
      this.candidates.set(host, c);
    }
    c.sources.add(source);
    if (!c.sourceUrls.has(sourceUrl)) {
      c.sourceUrls.add(sourceUrl);
      c.mentions++;
    }
    if (!c.brand && brand) c.brand = brand;
    if (!c.industryHint && industryHint) c.industryHint = industryHint;
    if (!c.platformHint && platformHint) c.platformHint = platformHint;
    this.stats[source] = (this.stats[source] || 0) + 1;
  }

  async text(url: string, accept = 'text/html,*/*'): Promise<string | null> {
    try {
      const r = await this.polite.fetch(url, { headers: { accept } });
      if (!r.ok) return null;
      return await r.text();
    } catch (e) {
      if (e instanceof PoliteError) console.log(`  refused ${url} (${e.reason})`);
      return null;
    }
  }

  sitemapUrls(xml: string, pattern: RegExp): string[] {
    const out: string[] = [];
    for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) if (pattern.test(m[1])) out.push(m[1]);
    return [...new Set(out)];
  }

  // ---- Source: ecomm.design (public WordPress REST API) ---------------------
  async ecomm(): Promise<void> {
    const platformNames = new Map<number, string>();
    const plat = await this.text('https://ecomm.design/wp-json/wp/v2/platforms?per_page=100&_fields=id,name', 'application/json');
    if (plat) {
      try {
        for (const p of JSON.parse(plat) as { id: number; name: string }[]) platformNames.set(p.id, decode(p.name));
      } catch {
        /* keep going without names */
      }
    }
    let total = 0;
    for (let page = 1; page <= 80; page++) {
      const url = `https://ecomm.design/wp-json/wp/v2/website?per_page=100&page=${page}&_fields=id,slug,title,acf`;
      const body = await this.text(url, 'application/json');
      if (!body) break;
      let items: { slug: string; title?: { rendered?: string }; acf?: { website_url?: string; platforms?: number[] } }[];
      try {
        items = JSON.parse(body);
      } catch {
        break;
      }
      if (!Array.isArray(items) || items.length === 0) break;
      for (const it of items) {
        const host = it.acf?.website_url ? normHost(it.acf.website_url) : null;
        if (!host) continue;
        const brand = it.title?.rendered ? decode(it.title.rendered) : null;
        const platform = (it.acf?.platforms || []).map((id) => platformNames.get(id)).find(Boolean) || null;
        this.add(host, 'ecomm', `https://ecomm.design/site/${it.slug}/`, brand, null, platform ? platform.toLowerCase().replace(/\s+/g, '-') : null);
        total++;
      }
      if (items.length < 100) break;
    }
    console.log(`  ecomm.design: ${total} store records read, ${this.candidates.size} candidates so far`);
  }

  // ---- Source: stores.gallery (sitemap -> store pages) ----------------------
  async gallery(): Promise<void> {
    const xml = await this.text('https://stores.gallery/sitemap.xml', 'application/xml,text/xml,*/*');
    if (!xml) return;
    const pages = this.sitemapUrls(xml, /^https:\/\/stores\.gallery\/stores\/[a-z0-9-]+$/);
    console.log(`  stores.gallery: ${pages.length} store pages to read`);
    for (const url of pages) {
      const html = await this.text(url);
      if (!html) continue;
      const m = html.match(/"url":"(https?:\/\/(?!cdn\.stores\.gallery|stores\.gallery)[^"]+)"/);
      const host = m ? normHost(m[1]) : null;
      if (host) {
        const title = decode(html.match(/<title>([^<]*)<\/title>/)?.[1] || '').split(/[|·]/)[0].trim();
        this.add(host, 'gallery', url, title || null);
      }
    }
  }

  // ---- Source: catalog.cool (sitemap -> brand pages) ------------------------
  async catalog(): Promise<void> {
    const xml = await this.text('https://catalog.cool/sitemap.xml', 'application/xml,text/xml,*/*');
    if (!xml) return;
    const pages = this.sitemapUrls(xml, /^https:\/\/catalog\.cool\/brands\/[a-z0-9-]+$/);
    console.log(`  catalog.cool: ${pages.length} brand pages to read`);
    for (const url of pages) {
      const html = await this.text(url);
      if (!html) continue;
      const $ = cheerio.load(html);
      let host: string | null = null;
      $('a[href^="http"]').each((_i, a) => {
        if (host) return;
        const h = normHost($(a).attr('href') || '');
        if (h && !isJunk(h) && !h.endsWith('catalog.cool')) host = h;
      });
      if (host) this.add(host, 'catalog', url, url.split('/').pop()!.replace(/-/g, ' '));
    }
  }

  // ---- Source: articles ("best X stores") -> outbound links ----------------
  async article(url: string, source: string, industryHint: string | null): Promise<void> {
    const html = await this.text(url);
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
    let stopped = false;
    for (const { q, industry } of queries.slice(0, maxQueries)) {
      for (let attempt = 1; attempt <= 4; attempt++) {
        try {
          const r = await fetch('https://api.firecrawl.dev/v1/search', {
            method: 'POST',
            headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: q, limit: 10 }),
            signal: AbortSignal.timeout(30_000),
          });
          if (r.status === 429 && attempt < 4) {
            console.log(`  search rate-limited, waiting 65 s (attempt ${attempt})`);
            await sleep(65_000);
            continue;
          }
          if (!r.ok) {
            console.log(`  search "${q}" -> HTTP ${r.status}, stopping search source`);
            stopped = true;
            break;
          }
          const j = (await r.json()) as { data?: { url: string }[] };
          for (const d of j.data || []) if (normHost(d.url) && !pages.has(d.url)) pages.set(d.url, industry);
          done++;
          break;
        } catch (e) {
          console.log(`  search "${q}" failed: ${(e as Error).message.split('\n')[0]}`);
          break;
        }
      }
      if (stopped) break;
      await sleep(2500);
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

// ---- CSV --------------------------------------------------------------------
const csvCell = (v: unknown) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csvLine = (cells: unknown[]) => cells.map(csvCell).join(',');

function parseCsv(text: string): Record<string, string>[] {
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

const HEADER = ['host', 'final_host', 'brand', 'title', 'platform', 'platform_hint', 'tranco_rank', 'mentions', 'sources', 'industry_hint', 'source_urls'];

// ---- Tranco ranking ---------------------------------------------------------
async function tranco(dataDir: string): Promise<Map<string, number>> {
  const dir = path.join(dataDir, 'tranco');
  const csv = path.join(dir, 'top-1m.csv');
  await mkdir(dir, { recursive: true });
  if (!existsSync(csv)) {
    console.log('  downloading Tranco top-1M list…');
    const r = await fetch('https://tranco-list.eu/top-1m.csv.zip', { redirect: 'follow', signal: AbortSignal.timeout(120_000) });
    if (!r.ok) throw new Error(`Tranco download failed: HTTP ${r.status}`);
    const files = unzipSync(new Uint8Array(await r.arrayBuffer()));
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
async function probe(host: string, platformHint: string | null = null): Promise<Live> {
  const out: Live = { alive: false, status: null, finalHost: null, platform: null, title: null, store: false, signals: 0, ts: Date.now() };
  try {
    const get = () =>
      fetch(`https://${host}/`, {
        headers: { 'user-agent': botUserAgent(DESKTOP_BASE_UA), accept: 'text/html,*/*' },
        redirect: 'follow',
        signal: AbortSignal.timeout(15_000),
      });
    const lane = laneFor(platformHint);
    let r = await lanes.run(lane, get);
    if (r.status === 429) {
      await sleep(retryAfterMs(r, 30, 60));
      r = await lanes.run(lane, get);
    }
    out.status = r.status;
    out.finalHost = hostOf(r.url);
    if (r.status === 429) {
      // Throttled twice: our doing, not the store's. Leave it uncached (ts 0)
      // so the next run asks again.
      out.ts = 0;
      return out;
    }
    if (!r.ok) return out;
    const html = (await r.text()).slice(0, 400_000);
    const low = html.toLowerCase();
    out.alive = true;
    out.title = decode(html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] || '').slice(0, 120) || null;
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
    out.signals = STORE_SIGNALS.filter((s) => low.includes(s)).length;
    out.store = (out.platform !== null && ECOM_PLATFORMS.has(out.platform)) || out.signals >= 3;
  } catch {
    /* dead or slow */
  }
  return out;
}

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
  const fresh = args.includes('--fresh');
  const dataDir = opt('--data', 'data');

  await mkdir('seeds', { recursive: true });
  const polite = await Politeness.fromConfig();
  const h = new Harvest(polite);
  const t0 = Date.now();

  // Previous runs feed this one, so sources can be re-run one at a time.
  if (!fresh && existsSync('seeds/candidates.csv')) {
    let merged = 0;
    for (const r of parseCsv(await readFile('seeds/candidates.csv', 'utf8'))) {
      if (!r.host || isJunk(r.host)) continue;
      const c: Candidate = {
        host: r.host,
        brand: r.brand || null,
        sources: new Set(r.sources ? r.sources.split('|') : []),
        sourceUrls: new Set(r.source_urls ? r.source_urls.split('|') : []),
        mentions: Number(r.mentions) || 0,
        industryHint: r.industry_hint || null,
        platformHint: r.platform_hint || null,
      };
      h.candidates.set(c.host, c);
      merged++;
    }
    console.log(`Merged ${merged} candidates from the previous run.`);
  }

  console.log('Sources:', sources.join(', '));
  if (sources.includes('ecomm')) await h.ecomm();
  if (sources.includes('gallery')) await h.gallery();
  if (sources.includes('catalog')) await h.catalog();
  if (sources.includes('lists')) await h.lists();
  if (sources.includes('search')) await h.search(maxQueries);
  console.log(`\n${h.candidates.size} candidate hosts after ${((Date.now() - t0) / 60000).toFixed(1)} min. New this run per source:`, JSON.stringify(h.stats));

  console.log('\nRanking with Tranco…');
  const ranks = await tranco(dataDir);
  const rows = [...h.candidates.values()].map((c) => ({ ...c, rank: rankOf(ranks, c.host) }));
  rows.sort((a, b) => {
    if (a.rank && b.rank) return a.rank - b.rank;
    if (a.rank) return -1;
    if (b.rank) return 1;
    return b.mentions - a.mentions || b.sources.size - a.sources.size || a.host.localeCompare(b.host);
  });
  console.log(`  ${rows.filter((r) => r.rank).length} of ${rows.length} candidates have a Tranco rank`);

  // Liveness, cached for a week so re-runs only probe what is new.
  const cachePath = 'seeds/live-cache.json';
  const liveMap = new Map<string, Live>();
  if (existsSync(cachePath)) {
    try {
      for (const [host, l] of Object.entries(JSON.parse(await readFile(cachePath, 'utf8')) as Record<string, Live>)) {
        // Entries from before the store gate existed carry no verdict: re-probe them.
        if (Date.now() - l.ts < 7 * 86_400_000 && typeof l.store === 'boolean') liveMap.set(host, l);
      }
    } catch {
      /* start fresh */
    }
  }
  if (live) {
    const toProbe = rows.slice(0, Math.max(Math.round(limit * 1.6), limit + 300)).filter((r) => !liveMap.has(r.host));
    console.log(`\nLiveness: probing ${toProbe.length} hosts (8 at a time, ${liveMap.size} cached)…`);
    let done = 0;
    await h.parallel(toProbe, 8, async (r) => {
      liveMap.set(r.host, await probe(r.host, r.platformHint));
      if (++done % 200 === 0) console.log(`  ${done}/${toProbe.length}`);
    });
    await writeFile(cachePath, JSON.stringify(Object.fromEntries(liveMap)), 'utf8');
  }

  // Merge hosts that redirect to the same final host (brand.com -> shop.brand.com).
  const seenFinal = new Set<string>();
  const chosen: typeof rows = [];
  let dead = 0;
  let notStore = 0;
  for (const r of rows) {
    const l = liveMap.get(r.host);
    if (live && (!l || !l.alive)) {
      dead++;
      continue;
    }
    if (live && l && !l.store) {
      notStore++;
      continue;
    }
    const fh = l?.finalHost || r.host;
    if (seenFinal.has(fh)) continue;
    seenFinal.add(fh);
    chosen.push(r);
    if (chosen.length >= limit) break;
  }

  const toRow = (r: (typeof rows)[number]) => {
    const l = liveMap.get(r.host);
    return csvLine([r.host, l?.finalHost || '', r.brand || '', l?.title || '', l?.platform || r.platformHint || '', r.platformHint || '', r.rank || '',
      r.mentions, [...r.sources].join('|'), r.industryHint || '', [...r.sourceUrls].slice(0, 3).join('|')]);
  };
  await writeFile('seeds/candidates.csv', [csvLine(HEADER), ...rows.map(toRow)].join('\n') + '\n', 'utf8');
  await writeFile('seeds/stores.csv', [csvLine(HEADER), ...chosen.map(toRow)].join('\n') + '\n', 'utf8');

  const platforms: Record<string, number> = {};
  for (const r of chosen) {
    const p = liveMap.get(r.host)?.platform || r.platformHint || 'unknown';
    platforms[p] = (platforms[p] || 0) + 1;
  }
  const bySource: Record<string, number> = {};
  for (const r of chosen) for (const s of r.sources) bySource[s] = (bySource[s] || 0) + 1;
  console.log(`\nseeds/stores.csv: ${chosen.length} stores, ${chosen.filter((r) => r.rank).length} with a Tranco rank` +
    (chosen.length ? `, best rank ${chosen[0].rank ?? 'n/a'}, median rank ${chosen[Math.floor(chosen.length / 2)].rank ?? 'n/a'}` : ''));
  console.log(`  platforms: ${JSON.stringify(platforms)}`);
  console.log(`  sources represented: ${JSON.stringify(bySource)}`);
  if (live) console.log(`  rejected while choosing: ${dead} dead or unprobed, ${notStore} not a store`);
  console.log(`seeds/candidates.csv: ${rows.length} candidates. Total ${((Date.now() - t0) / 60000).toFixed(1)} min.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
