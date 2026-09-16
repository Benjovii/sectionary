// Shopify stores publish their catalogue as public JSON. That lets us enumerate
// a store's pages (home, collections, products, cart) without crawling links.

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

export type Discovery = { shopify: boolean; urls: string[] };

async function getJson(url: string): Promise<any | null> {
  try {
    const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' }, redirect: 'follow' });
    if (!r.ok) return null;
    if (!(r.headers.get('content-type') || '').includes('json')) return null;
    return await r.json();
  } catch {
    return null;
  }
}

export async function discoverShopify(origin: string, limits = { collections: 2, products: 2 }): Promise<Discovery> {
  const products = await getJson(`${origin}/products.json?limit=${limits.products}`);
  if (!products || !Array.isArray(products.products)) return { shopify: false, urls: [`${origin}/`] };

  const urls = [`${origin}/`];
  const collections = await getJson(`${origin}/collections.json?limit=${limits.collections + 2}`);
  let added = 0;
  for (const c of (collections && collections.collections) || []) {
    if (!c.handle || c.handle === 'all' || c.handle === 'frontpage') continue;
    urls.push(`${origin}/collections/${c.handle}`);
    if (++added >= limits.collections) break;
  }
  for (const p of products.products.slice(0, limits.products)) {
    if (p.handle) urls.push(`${origin}/products/${p.handle}`);
  }
  urls.push(`${origin}/cart`);
  return { shopify: true, urls };
}
