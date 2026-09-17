// Shopify stores publish their catalogue as public JSON. That lets us enumerate
// a store's pages (home, collections, products, cart) without crawling links.
// Every request goes through the politeness rules, and the final list is
// filtered by robots.txt (Shopify's default disallows /cart, /checkout and
// /account, so those drop out on third-party stores).
import { Politeness, PoliteError } from './polite.js';

export type Discovery = {
  shopify: boolean;
  urls: string[];
  skipped: { url: string; reason: string }[];
};

async function getJson(polite: Politeness, url: string): Promise<any | null> {
  try {
    const r = await polite.fetch(url, { headers: { accept: 'application/json' } });
    if (!r.ok) return null;
    if (!(r.headers.get('content-type') || '').includes('json')) return null;
    return await r.json();
  } catch (e) {
    if (e instanceof PoliteError) throw e;
    return null;
  }
}

export async function discoverShopify(
  polite: Politeness,
  origin: string,
  limits = { collections: 2, products: 2 },
): Promise<Discovery> {
  const skipped: Discovery['skipped'] = [];
  const products = await getJson(polite, `${origin}/products.json?limit=${limits.products}`);
  const candidates: string[] = [`${origin}/`];
  let shopify = false;

  if (products && Array.isArray(products.products)) {
    shopify = true;
    const collections = await getJson(polite, `${origin}/collections.json?limit=${limits.collections + 2}`);
    let added = 0;
    for (const c of (collections && collections.collections) || []) {
      if (!c.handle || c.handle === 'all' || c.handle === 'frontpage') continue;
      candidates.push(`${origin}/collections/${c.handle}`);
      if (++added >= limits.collections) break;
    }
    for (const p of products.products.slice(0, limits.products)) {
      if (p.handle) candidates.push(`${origin}/products/${p.handle}`);
    }
    candidates.push(`${origin}/cart`);
  }

  const urls: string[] = [];
  for (const url of candidates) {
    const v = await polite.allowed(url);
    if (v.ok) urls.push(url);
    else skipped.push({ url, reason: v.reason });
  }
  return { shopify, urls, skipped };
}
