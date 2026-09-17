// Node-side fingerprints for the validator (SEC-5). page-script.ts carries a
// copy of the app list for the in-page detector; the two must stay in step
// (page-script functions cannot import, they are serialised into the page).

export type PlatformInfo = {
  platform: string | null;
  builder: string | null;
  theme: string | null;
  themeVersion: string | null;
  currency: string | null;
  country: string | null;
  locale: string | null;
};

export const ECOM_PLATFORMS = new Set(['shopify', 'woocommerce', 'bigcommerce', 'magento', 'salesforce', 'prestashop', 'shopware', 'squarespace-commerce', 'wix-stores']);

export function detectPlatform(html: string): PlatformInfo {
  const low = html.toLowerCase();
  const has = (s: string) => low.includes(s);
  const out: PlatformInfo = { platform: null, builder: null, theme: null, themeVersion: null, currency: null, country: null, locale: null };

  if (has('cdn.shopify.com') || has('shopify.theme') || has('myshopify.com')) {
    out.platform = 'shopify';
    // window.Shopify.theme = {"name":"Impact","id":123,"schema_name":"Impact","schema_version":"5.2.0",...}
    const t = html.match(/Shopify\.theme\s*=\s*(\{[^;]*\})\s*;/);
    if (t) {
      try {
        const j = JSON.parse(t[1]) as { name?: string; schema_name?: string; schema_version?: string };
        out.theme = j.schema_name || j.name || null;
        out.themeVersion = j.schema_version || null;
      } catch {
        const n = t[1].match(/"(?:schema_name|name)":"([^"]+)"/);
        out.theme = n ? n[1] : null;
        const v = t[1].match(/"schema_version":"([^"]+)"/);
        out.themeVersion = v ? v[1] : null;
      }
    }
    const cur = html.match(/Shopify\.currency\s*=\s*\{"active":"([A-Z]{3})"/);
    if (cur) out.currency = cur[1];
    const country = html.match(/Shopify\.country\s*=\s*"([A-Z]{2})"/);
    if (country) out.country = country[1];
    const locale = html.match(/Shopify\.locale\s*=\s*"([a-z]{2}(?:-[A-Za-z]{2})?)"/);
    if (locale) out.locale = locale[1];
    if (has('gempages')) out.builder = 'gempages';
    else if (has('pagefly')) out.builder = 'pagefly';
    else if (has('getshogun')) out.builder = 'shogun';
    else if (has('replo')) out.builder = 'replo';
    else if (has('hydrogen')) out.builder = 'hydrogen';
  } else if (has('woocommerce')) {
    out.platform = 'woocommerce';
  } else if (has('bigcommerce.com') || has('bigcommerce')) {
    out.platform = 'bigcommerce';
  } else if (has('demandware') || has('salesforce-commerce') || has('/on/demandware.store/')) {
    out.platform = 'salesforce';
  } else if ((has('/static/version') && has('mage/')) || has('magento')) {
    out.platform = 'magento';
  } else if (has('prestashop')) {
    out.platform = 'prestashop';
  } else if (has('shopware')) {
    out.platform = 'shopware';
  } else if (has('squarespace')) {
    out.platform = has('sqs-cart') || has('products/') ? 'squarespace-commerce' : 'squarespace';
  } else if (has('wixstatic.com') || has('parastorage.com')) {
    out.platform = has('wixstores') || has('wix-stores') ? 'wix-stores' : 'wix';
  } else if (has('data-wf-site') || has('webflow')) {
    out.platform = 'webflow';
  } else if (has('framerusercontent.com')) {
    out.platform = 'framer';
  } else if (has('/_next/')) {
    out.platform = 'nextjs';
  } else if (has('__nuxt')) {
    out.platform = 'nuxt';
  } else if (has('/wp-content/')) {
    out.platform = 'wordpress';
  }
  if (out.platform === 'wordpress' || out.platform === 'woocommerce') {
    const m = low.match(/\/wp-content\/themes\/([a-z0-9_-]+)\//);
    if (m) out.theme = m[1];
    if (has('elementor')) out.builder = 'elementor';
  }
  if (!out.currency) {
    const ld = html.match(/"priceCurrency"\s*:\s*"([A-Z]{3})"/);
    if (ld) out.currency = ld[1];
  }
  if (!out.locale) {
    const lang = html.match(/<html[^>]*\slang="([a-zA-Z]{2}(?:-[a-zA-Z]{2})?)"/);
    if (lang) out.locale = lang[1];
  }
  return out;
}

export const APPS: Array<[string, RegExp]> = [
  ['Klaviyo', /klaviyo|_learnq/i],
  ['Recharge', /rechargepayments|rechargeapps/i],
  ['Skio', /skio\.com|skio-subscriptions|getskio/i],
  ['Loop Subscriptions', /loopwork\.co|loopsubscriptions/i],
  ['Rebuy', /rebuyengine/i],
  ['Gorgias', /gorgias/i],
  ['Judge.me', /judge\.me|judgeme/i],
  ['Loox', /loox\.io/i],
  ['Okendo', /okendo/i],
  ['Yotpo', /yotpo/i],
  ['Stamped', /stamped\.io/i],
  ['Junip', /junip\.co/i],
  ['Hotjar', /hotjar/i],
  ['Microsoft Clarity', /clarity\.ms/i],
  ['Google Tag Manager', /googletagmanager\.com\/gtm\.js/i],
  ['Google Analytics', /gtag\/js|google-analytics\.com|googletagmanager\.com\/gtag/i],
  ['Meta Pixel', /connect\.facebook\.net|fbq\(/i],
  ['TikTok Pixel', /analytics\.tiktok\.com|ttq\./i],
  ['Pinterest Tag', /pintrk|ct\.pinterest\.com/i],
  ['Snap Pixel', /sc-static\.net|snaptr\(/i],
  ['Attentive', /attn\.tv|attentivemobile/i],
  ['Postscript', /postscript\.io/i],
  ['Privy', /privy\.com|privymktg/i],
  ['Justuno', /justuno/i],
  ['Shopify Inbox', /shopify-chat|inbox\.shopify/i],
  ['Intelligems', /intelligems/i],
  ['Triple Whale', /triplewhale/i],
  ['Northbeam', /northbeam/i],
  ['Elevar', /elevar/i],
  ['Wishlist Plus', /swymrelay|swym/i],
  ['Klarna', /klarna/i],
  ['Afterpay', /afterpay/i],
  ['Sezzle', /sezzle/i],
  ['Shop Pay', /shop\.app|shopifypay|shop-pay/i],
  ['PayPal', /paypal\.com/i],
  ['Tolstoy', /gotolstoy/i],
  ['Vimeo', /player\.vimeo\.com/i],
  ['YouTube', /youtube\.com\/embed|youtube-nocookie/i],
  ['Typeform', /typeform/i],
  ['HubSpot', /hs-scripts\.com|hsforms|hubspot/i],
  ['Mailchimp', /chimpstatic|mailchimp|list-manage/i],
  ['ActiveCampaign', /activehosted|activecampaign/i],
  ['Zendesk', /zendesk|zdassets/i],
  ['Intercom', /intercom/i],
  ['Tidio', /tidio/i],
  ['Crisp', /crisp\.chat/i],
  ['Cookie consent (OneTrust)', /onetrust|cookielaw\.org/i],
  ['Cookie consent (Cookiebot)', /cookiebot/i],
  ['Cookie consent (Pandectes)', /pandectes/i],
  ['Weglot', /weglot/i],
  ['Smile.io', /smile\.io/i],
  ['LoyaltyLion', /loyaltylion/i],
  ['Bold', /boldapps|boldcommerce/i],
  ['Globo', /globosoftware/i],
  ['Fera', /fera\.ai/i],
  ['Searchanise', /searchanise/i],
  ['Boost Commerce', /boostcommerce|boost-pfs/i],
  ['Algolia', /algolia/i],
  ['Nosto', /nosto\.com/i],
  ['Dynamic Yield', /dynamicyield/i],
  ['Optimizely', /optimizely/i],
  ['VWO', /visualwebsiteoptimizer/i],
  ['Segment', /cdn\.segment\.com/i],
  ['Sentry', /sentry\.io|sentry-cdn/i],
  ['Cloudflare', /cloudflareinsights|cdn-cgi/i],
];

export function detectApps(html: string): string[] {
  return APPS.filter(([, re]) => re.test(html)).map(([n]) => n);
}

export const STORE_SIGNALS = [
  'add to cart', 'add-to-cart', 'addtocart', 'href="/cart', 'checkout', '"@type":"product"', '"@type": "product"', 'data-product',
  'product-form', '/products/', '/collections/', '/product/', 'buy now', 'shop now', 'shopping bag', 'shopping cart', 'your cart', 'basket',
  'free shipping', 'sold out', 'add to bag', 'pricecurrency', 'itemlistelement', 'shop all',
];

export function storeSignals(html: string): number {
  const low = html.toLowerCase();
  return STORE_SIGNALS.filter((s) => low.includes(s)).length;
}

const PARKED = ['this domain is for sale', 'domain for sale', 'buy this domain', 'sedoparking', 'hugedomains', 'afternic', 'dan.com', 'parked free', 'domain is parked', 'godaddy.com/domainsearch', 'namecheap.com/domains', 'coming soon', 'under construction', 'website is temporarily unavailable', 'account suspended'];
export function isParked(html: string): string | null {
  const low = html.toLowerCase();
  const hit = PARKED.find((p) => low.includes(p));
  if (!hit) return null;
  // "coming soon" also appears on live stores announcing a product; only call it
  // parked when the page is tiny.
  if ((hit === 'coming soon' || hit === 'under construction') && html.length > 20_000) return null;
  return hit;
}

const ADULT = ['sex toy', 'sex toys', 'adult toy', 'adult toys', 'porn', 'xxx', 'dildo', 'vibrator', 'escort', 'casino', 'sportsbook', 'betting'];
export function isAdult(text: string): string | null {
  const low = text.toLowerCase();
  return ADULT.find((a) => low.includes(a)) || null;
}

// ---- Industry (keyword classifier; AI refinement comes with SEC-12) -------
export const INDUSTRIES: Record<string, string[]> = {
  'fashion-apparel': ['apparel', 'clothing', 'clothes', 'dress', 'dresses', 'denim', 'jeans', 'hoodie', 't-shirt', 'tee', 'shirts', 'shoes', 'sneakers', 'footwear', 'boots', 'handbag', 'swimwear', 'lingerie', 'underwear', 'menswear', 'womenswear', 'streetwear', 'sunglasses', 'eyewear', 'outerwear', 'jacket', 'knitwear', 'socks', 'leggings', 'bra'],
  'beauty-skincare': ['skincare', 'skin care', 'beauty', 'cosmetics', 'makeup', 'serum', 'moisturizer', 'moisturiser', 'fragrance', 'perfume', 'haircare', 'hair care', 'shampoo', 'lipstick', 'cleanser', 'sunscreen', 'spf', 'nail polish', 'grooming', 'beard', 'deodorant'],
  'food-drink': ['coffee', 'tea', 'snack', 'snacks', 'chocolate', 'wine', 'beer', 'spirits', 'whisky', 'whiskey', 'sauce', 'bakery', 'meals', 'food', 'drink', 'beverage', 'juice', 'kombucha', 'matcha', 'honey', 'olive oil', 'seafood', 'meat', 'cheese', 'candy', 'granola', 'roaster', 'brewery', 'distillery'],
  'supplements-wellness': ['supplement', 'supplements', 'vitamin', 'vitamins', 'protein', 'collagen', 'probiotic', 'wellness', 'nutrition', 'gummies', 'adaptogen', 'electrolyte', 'cbd', 'magnesium', 'creatine', 'pre-workout', 'nootropic', 'immunity', 'gut health'],
  'subscription-box': ['subscription box', 'monthly box', 'every month', 'mystery box', 'crate', 'curated box', 'box delivered', 'each month', 'subscribe & save', 'monthly subscription'],
  'kids-baby': ['kids', 'baby', 'toddler', 'children', 'toys', 'nursery', 'stroller', 'diaper', 'nappies', 'montessori', 'teething', 'newborn', 'playroom', 'kid'],
  'pets': ['dog', 'dogs', 'cat', 'cats', 'pet', 'pets', 'puppy', 'kitten', 'dog treats', 'pet food', 'leash', 'litter', 'canine', 'feline'],
  'home-furniture': ['furniture', 'sofa', 'mattress', 'bedding', 'sheets', 'pillow', 'candle', 'candles', 'home decor', 'homeware', 'kitchen', 'cookware', 'rug', 'rugs', 'lighting', 'lamp', 'towel', 'vase', 'planter', 'garden', 'tableware', 'ceramics', 'cutlery', 'bath'],
  'jewellery-watches': ['jewelry', 'jewellery', 'ring', 'rings', 'necklace', 'earrings', 'bracelet', 'watch', 'watches', 'gold', 'diamond', 'gemstone', 'pendant', 'silver'],
  'sports-outdoor': ['fitness', 'gym', 'yoga', 'running', 'cycling', 'bike', 'bikes', 'camping', 'hiking', 'outdoor', 'surf', 'skate', 'golf', 'tennis', 'workout', 'athletic', 'training', 'climbing', 'fishing', 'ski'],
  'tech-gadgets': ['phone case', 'charger', 'headphones', 'earbuds', 'speaker', 'gadget', 'gadgets', 'electronics', 'keyboard', 'laptop', 'camera', 'drone', 'smart home', 'cable', 'power bank', 'tech', 'audio', 'wireless'],
  'gifts-stationery': ['gift', 'gifts', 'stationery', 'notebook', 'planner', 'pens', 'greeting cards', 'journal', 'art print', 'prints', 'poster', 'puzzle', 'board game', 'card game', 'wrapping'],
};

export type IndustryGuess = { industry: string; score: number; runnerUp: string | null };

/** Scores keyword hits in weighted text buckets and returns the best industry. */
export function classifyIndustry(buckets: { text: string; weight: number }[]): IndustryGuess {
  const scores: Record<string, number> = {};
  for (const { text, weight } of buckets) {
    const low = ` ${text.toLowerCase().replace(/[^a-z0-9&+\-' ]+/g, ' ')} `;
    for (const [industry, words] of Object.entries(INDUSTRIES)) {
      let hits = 0;
      for (const w of words) {
        const needle = ` ${w} `;
        let idx = low.indexOf(needle);
        while (idx !== -1 && hits < 12) {
          hits++;
          idx = low.indexOf(needle, idx + needle.length);
        }
      }
      if (hits) scores[industry] = (scores[industry] || 0) + hits * weight;
    }
  }
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  if (!ranked.length || ranked[0][1] < 3) return { industry: 'other', score: ranked[0]?.[1] ?? 0, runnerUp: ranked[0]?.[0] ?? null };
  return { industry: ranked[0][0], score: ranked[0][1], runnerUp: ranked[1]?.[0] ?? null };
}

const TLD_COUNTRY: Record<string, string> = {
  'co.uk': 'GB', uk: 'GB', ie: 'IE', de: 'DE', fr: 'FR', nl: 'NL', be: 'BE', es: 'ES', it: 'IT', pt: 'PT', se: 'SE', no: 'NO', dk: 'DK', fi: 'FI',
  ch: 'CH', at: 'AT', pl: 'PL', cz: 'CZ', ca: 'CA', 'com.au': 'AU', au: 'AU', 'co.nz': 'NZ', nz: 'NZ', jp: 'JP', 'co.jp': 'JP', kr: 'KR', sg: 'SG',
  hk: 'HK', in: 'IN', 'co.in': 'IN', 'com.br': 'BR', br: 'BR', mx: 'MX', 'com.mx': 'MX', ar: 'AR', za: 'ZA', 'co.za': 'ZA', ae: 'AE', il: 'IL',
  'co.il': 'IL', tr: 'TR', 'com.tr': 'TR', gr: 'GR', ro: 'RO', hu: 'HU', ua: 'UA', ru: 'RU', cn: 'CN', tw: 'TW', th: 'TH', vn: 'VN', ph: 'PH',
  id: 'ID', my: 'MY', xk: 'XK', al: 'AL',
};

const CURRENCY_COUNTRY: Record<string, string> = { USD: 'US', GBP: 'GB', EUR: 'EU', CAD: 'CA', AUD: 'AU', NZD: 'NZ', JPY: 'JP', SEK: 'SE', NOK: 'NO', DKK: 'DK', CHF: 'CH', PLN: 'PL', INR: 'IN', BRL: 'BR', MXN: 'MX', SGD: 'SG', HKD: 'HK', KRW: 'KR', ZAR: 'ZA', AED: 'AE', ILS: 'IL', TRY: 'TR', CZK: 'CZ', HUF: 'HU' };

export function guessCountry(host: string, info: PlatformInfo): string | null {
  if (info.country) return info.country;
  const parts = host.split('.');
  const two = parts.slice(-2).join('.');
  const one = parts[parts.length - 1];
  if (TLD_COUNTRY[two]) return TLD_COUNTRY[two];
  if (TLD_COUNTRY[one]) return TLD_COUNTRY[one];
  if (info.locale && /-[A-Z]{2}$/i.test(info.locale)) return info.locale.slice(-2).toUpperCase();
  if (info.currency && CURRENCY_COUNTRY[info.currency]) return CURRENCY_COUNTRY[info.currency];
  return null;
}
