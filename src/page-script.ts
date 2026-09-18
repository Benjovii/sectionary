// Functions in this file run INSIDE the captured web page (Playwright serialises
// them with page.evaluate). They must be self-contained: no imports, no closures
// over anything outside the function body.

export type BlockInfo = {
  ref: string;
  index: number;
  typeHint: string;
  parentType: string | null;
  tag: string;
  id: string | null;
  classes: string | null;
  top: number;
  height: number;
  width: number;
  text: string;
  textLength: number;
  headline: string | null;
  buttons: number;
  images: number;
  videos: number;
  bg: string;
};

export type CollectResult = {
  strategy: string;
  docHeight: number;
  viewportWidth: number;
  blocks: BlockInfo[];
};

export type SiteInfo = {
  platform: string;
  theme: Record<string, unknown> | null;
  builder: string | null;
  apps: string[];
  currency: string | null;
  locale: string | null;
};

export type PageMeta = {
  title: string;
  description: string | null;
  canonical: string | null;
  ogImage: string | null;
  lang: string | null;
  h1: string | null;
};

/** Find the visual "blocks" (sections) of the page and tag them with data-secref. */
export function collectBlocks(opts: { minHeight: number; maxBlocks: number }): CollectResult {
  const vw = window.innerWidth;
  const docH = document.documentElement.scrollHeight;

  function isVisible(el: Element): boolean {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width >= vw * 0.5 && r.height >= opts.minHeight;
  }

  function typeHintFor(el: Element): string {
    const inner = el.querySelector('[data-section-type]');
    const dst = (inner && inner.getAttribute('data-section-type')) || el.getAttribute('data-section-type');
    if (dst) return dst.toLowerCase();
    const id = el.id || '';
    // Shopify ids: shopify-section-template--123__hero_banner_kCjXcf | shopify-section-sections--123__header
    const m = id.match(/^shopify-section-(?:template--\d+__|sections--\d+__)?(.+)$/);
    if (m) {
      return m[1]
        .replace(/_[A-Za-z0-9]{6,}$/, '')
        .replace(/[-_]?\d+$/, '')
        .replace(/_/g, '-')
        .toLowerCase();
    }
    const tag = el.tagName.toLowerCase();
    if (tag === 'header') return 'header';
    if (tag === 'footer') return 'footer';
    if (tag === 'nav') return 'navigation';
    const cls = (typeof el.className === 'string' ? el.className : '').toLowerCase() + ' ' + id.toLowerCase();
    const keys = ['announcement', 'hero', 'banner', 'slideshow', 'testimonial', 'review', 'faq', 'newsletter', 'pricing',
      'feature', 'logo', 'video', 'collection', 'product', 'gallery', 'cta', 'contact', 'team', 'blog', 'footer', 'header'];
    for (const k of keys) if (cls.includes(k)) return k;
    return 'unknown';
  }

  let strategy = 'shopify-sections';
  let cands: Element[] = Array.from(document.querySelectorAll('.shopify-section'));
  if (cands.length < 2) {
    strategy = 'semantic';
    const all = Array.from(document.querySelectorAll(
      'header, footer, section, [class*="elementor-top-section"], .e-con.e-parent, .section, .w-section, [data-section]'
    ));
    cands = all.filter((el) => !all.some((o) => o !== el && o.contains(el)));
    if (cands.length < 3) {
      strategy = 'main-children';
      const main = document.querySelector('main') || document.body;
      cands = Array.from(main.children);
    }
  }

  const vh = window.innerHeight;
  const maxH = Math.round(Math.max(vh * 2.2, vw < 600 ? 2400 : 1800));
  let refined = false;

  // A section taller than about two screens is usually a page-builder or
  // custom section that holds the whole page. Descend into its children until
  // the pieces are block-sized, but never split side-by-side layouts: children
  // narrower than half the viewport fail isVisible and the parent stays whole.
  // `splits` counts real splits (limit 4); single-child wrapper hops are free
  // but capped at 12 so a pathological DOM cannot loop forever.
  function refine(el: Element, splits: number, hops: number): Element[] {
    const h = el.getBoundingClientRect().height;
    if (h <= maxH || splits >= 4 || hops >= 12) return [el];
    const kids = Array.from(el.children).filter(isVisible);
    if (kids.length < 2) {
      const wrapper = Array.from(el.children).find((c) => isVisible(c) && c.getBoundingClientRect().height >= h * 0.6);
      return wrapper ? refine(wrapper, splits, hops + 1) : [el];
    }
    const sum = kids.reduce((s, k) => s + k.getBoundingClientRect().height, 0);
    if (sum < h * 0.6) return [el];
    refined = true;
    return kids.flatMap((k) => refine(k, splits + 1, hops + 1));
  }

  const parentHint = new Map<Element, string>();
  const chosen = cands
    .filter(isVisible)
    .filter((el, _i, arr) => !arr.some((o) => o !== el && o.contains(el)))
    .flatMap((el) => {
      const hint = typeHintFor(el);
      const parts = refine(el, 0, 0);
      for (const p of parts) if (p !== el) parentHint.set(p, hint);
      return parts;
    })
    .filter((el, _i, arr) => !arr.some((o) => o !== el && o.contains(el)))
    .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
  if (refined) strategy += '+refine';

  const blocks: BlockInfo[] = [];
  chosen.slice(0, opts.maxBlocks).forEach((el, i) => {
    const ref = 'b' + (i + 1);
    el.setAttribute('data-secref', ref);
    const r = el.getBoundingClientRect();
    const own = typeHintFor(el);
    const parent = parentHint.get(el) || null;
    const typeHint = own !== 'unknown' ? own : parent ? parent + '-part' : own;
    const raw = (el as HTMLElement).innerText || el.textContent || '';
    const text = raw.replace(/\s+/g, ' ').trim();
    const head = el.querySelector('h1, h2, h3');
    const cs = getComputedStyle(el);
    const transparent = (c: string) => c === 'transparent' || /rgba\(\d+, \d+, \d+, 0\)/.test(c);
    let bg = cs.backgroundColor;
    if (transparent(bg) && el.firstElementChild) bg = getComputedStyle(el.firstElementChild).backgroundColor;
    if (transparent(bg)) bg = getComputedStyle(document.body).backgroundColor;
    blocks.push({
      ref,
      index: i + 1,
      typeHint,
      parentType: parent,
      tag: el.tagName.toLowerCase(),
      id: el.id || null,
      classes: typeof el.className === 'string' && el.className.trim() ? el.className.trim().slice(0, 200) : null,
      top: Math.round(r.top + window.scrollY),
      height: Math.round(r.height),
      width: Math.round(r.width),
      text: text.slice(0, 400),
      textLength: text.length,
      headline: head ? (head.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 160) : null,
      buttons: el.querySelectorAll('a.button, a.btn, button, [class*="button"], [class*="btn"], input[type="submit"]').length,
      images: el.querySelectorAll('img, picture').length,
      videos: el.querySelectorAll('video, iframe[src*="youtube"], iframe[src*="vimeo"], iframe[src*="videopress"]').length,
      bg,
    });
  });

  return { strategy, docHeight: docH, viewportWidth: vw, blocks };
}

/** Detect platform, theme, page builder and third-party apps from what the page loaded. */
export function detectSite(): SiteInfo {
  const w = window as unknown as Record<string, any>;
  const parts: string[] = [];
  for (const s of Array.from(document.scripts)) parts.push(s.src || (s.textContent || '').slice(0, 6000));
  for (const l of Array.from(document.querySelectorAll('link[href]'))) parts.push(l.getAttribute('href') || '');
  for (const f of Array.from(document.querySelectorAll('iframe[src]'))) parts.push(f.getAttribute('src') || '');
  const genEl = document.querySelector('meta[name="generator"]') as HTMLMetaElement | null;
  const gen = genEl ? genEl.content : '';
  parts.push(gen);
  const hay = parts.join('\n').toLowerCase();
  const has = (s: string) => hay.includes(s);

  let platform = 'unknown';
  let theme: Record<string, unknown> | null = null;
  let builder: string | null = null;

  if (w.Shopify || has('cdn.shopify.com')) {
    platform = 'shopify';
    const t = w.Shopify && w.Shopify.theme;
    if (t) theme = { name: t.name, id: t.id, schema_name: t.schema_name, schema_version: t.schema_version, theme_store_id: t.theme_store_id, role: t.role };
  } else if (document.body.classList.contains('woocommerce') || document.body.classList.contains('woocommerce-page') || (has('woocommerce') && has('/wp-content/'))) {
    platform = 'woocommerce';
  } else if (has('/wp-content/') || gen.toLowerCase().includes('wordpress')) {
    platform = 'wordpress';
  } else if (document.documentElement.hasAttribute('data-wf-site') || has('webflow')) {
    platform = 'webflow';
  } else if (gen.toLowerCase().includes('framer') || has('framerusercontent.com')) {
    platform = 'framer';
  } else if ((w.Static && w.Static.SQUARESPACE_CONTEXT) || has('squarespace.com')) {
    platform = 'squarespace';
  } else if (has('wixstatic.com') || has('parastorage.com')) {
    platform = 'wix';
  } else if (has('bigcommerce.com')) {
    platform = 'bigcommerce';
  } else if (has('demandware') || has('salesforce-commerce')) {
    platform = 'salesforce-commerce-cloud';
  } else if (has('/static/version') && has('mage/')) {
    platform = 'magento';
  } else if (has('/_next/')) {
    platform = 'nextjs';
  } else if (document.querySelector('#__nuxt')) {
    platform = 'nuxt';
  }

  if (platform === 'wordpress' || platform === 'woocommerce') {
    const m = hay.match(/\/wp-content\/themes\/([a-z0-9_-]+)\//);
    if (m) theme = { name: m[1] };
    if (has('elementor')) builder = 'elementor';
    else if (has('js_composer')) builder = 'wpbakery';
    else if (has('divi')) builder = 'divi';
    else if (has('bricks')) builder = 'bricks';
  }
  if (platform === 'shopify') {
    if (has('gempages')) builder = 'gempages';
    else if (has('pagefly')) builder = 'pagefly';
    else if (has('getshogun')) builder = 'shogun';
    else if (has('replo')) builder = 'replo';
  }

  const APPS: Array<[string, RegExp]> = [
    ['Klaviyo', /klaviyo|_learnq/],
    ['Recharge', /rechargepayments|rechargeapps/],
    ['Skio', /skio\.com|skio-subscriptions|getskio/],
    ['Loop Subscriptions', /loopwork\.co|loopsubscriptions/],
    ['Rebuy', /rebuyengine/],
    ['Gorgias', /gorgias/],
    ['Judge.me', /judge\.me|judgeme/],
    ['Loox', /loox\.io/],
    ['Okendo', /okendo/],
    ['Yotpo', /yotpo/],
    ['Stamped', /stamped\.io/],
    ['Hotjar', /hotjar/],
    ['Microsoft Clarity', /clarity\.ms/],
    ['Google Tag Manager', /googletagmanager\.com\/gtm\.js/],
    ['Google Analytics', /gtag\/js|google-analytics\.com|googletagmanager\.com\/gtag/],
    ['Meta Pixel', /connect\.facebook\.net|fbq\(/],
    ['TikTok Pixel', /analytics\.tiktok\.com|ttq\./],
    ['Pinterest Tag', /pintrk|ct\.pinterest\.com/],
    ['Snap Pixel', /sc-static\.net|snaptr\(/],
    ['Attentive', /attn\.tv|attentivemobile/],
    ['Postscript', /postscript\.io/],
    ['Privy', /privy\.com|privymktg/],
    ['Justuno', /justuno/],
    ['Shopify Inbox', /shopify-chat|inbox\.shopify/],
    ['Intelligems', /intelligems/],
    ['Triple Whale', /triplewhale/],
    ['Northbeam', /northbeam/],
    ['Elevar', /elevar/],
    ['Wishlist Plus', /swymrelay|swym/],
    ['Klarna', /klarna/],
    ['Afterpay', /afterpay/],
    ['Sezzle', /sezzle/],
    ['Shop Pay', /shop\.app|shopifypay|shop-pay/],
    ['PayPal', /paypal\.com/],
    ['Tolstoy', /gotolstoy/],
    ['Vimeo', /player\.vimeo\.com/],
    ['YouTube', /youtube\.com\/embed|youtube-nocookie/],
    ['VideoPress', /videopress\.com/],
    ['Typeform', /typeform/],
    ['HubSpot', /hs-scripts\.com|hsforms|hubspot/],
    ['Mailchimp', /chimpstatic|mailchimp|list-manage/],
    ['ActiveCampaign', /activehosted|activecampaign/],
    ['Zendesk', /zendesk|zdassets/],
    ['Intercom', /intercom/],
    ['Tidio', /tidio/],
    ['Crisp', /crisp\.chat/],
    ['Kali Forms', /kaliforms/],
    ['Cookie consent (OneTrust)', /onetrust|cookielaw\.org/],
    ['Cookie consent (Cookiebot)', /cookiebot/],
    ['Cookie consent (Pandectes)', /pandectes/],
    ['Weglot', /weglot/],
    ['Smile.io', /smile\.io/],
    ['LoyaltyLion', /loyaltylion/],
    ['Bold', /boldapps|boldcommerce/],
    ['Globo', /globosoftware/],
    ['Fera', /fera\.ai/],
  ];
  const apps = APPS.filter(([, re]) => re.test(hay)).map(([n]) => n);

  return {
    platform,
    theme,
    builder,
    apps,
    currency: (w.Shopify && w.Shopify.currency && w.Shopify.currency.active) || null,
    locale: (w.Shopify && w.Shopify.locale) || document.documentElement.lang || null,
  };
}

/**
 * Same-origin links on the rendered page, in document order, without
 * fragments or duplicates. The crawl worker uses the home page's links to find
 * a store's collection and product pages on platforms that publish no feed.
 */
export function collectLinks(max: number): string[] {
  const origin = location.origin;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const a of Array.from(document.querySelectorAll('a[href]'))) {
    let u: URL;
    try {
      u = new URL((a as HTMLAnchorElement).href, location.href);
    } catch {
      continue;
    }
    if (u.origin !== origin) continue;
    u.hash = '';
    const key = u.origin + u.pathname.replace(/\/+$/, '') + u.search;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(u.toString());
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Is this page a wall instead of the store? A human check ("press and hold"),
 * an access-denied page or a geo-block often answers 200 OK and would pass for
 * a captured page. We only recognise walls, we never try to get past one.
 * Walls are short pages, which keeps a store that merely mentions "access
 * denied" somewhere in its help text from matching.
 */
export function detectWall(): { kind: string; text: string } | null {
  const text = ((document.body && document.body.innerText) || '').replace(/\s+/g, ' ').trim();
  if (text.length > 1500) return null;
  const hay = `${document.title || ''} ${text}`;
  const tests: [string, RegExp][] = [
    ['human-check', /verify (that )?you('| a)?re (a |not a )?(human|robot)|press (&|and) hold|are you a robot|complete the security check|checking (if the site connection is secure|your browser)|just a moment|needs to review the security of your connection/i],
    ['access-denied', /access (to this page has been |is )?denied|you don.?t have permission to access|request unsuccessful|pardon our interruption|unusual traffic|has been blocked|sorry, you have been blocked/i],
    ['geo-block', /restricted access|(not available|unavailable|cannot visit|can.?t visit|not accessible|do not ship|don.?t ship).{0,60}(your (current )?(location|country|region))/i],
  ];
  for (const [kind, re] of tests) if (re.test(hay)) return { kind, text: text.slice(0, 120) };
  if (document.querySelector('#px-captcha, #challenge-form, #challenge-stage, .cf-browser-verification, iframe[src*="captcha-delivery"], iframe[src*="hcaptcha.com"], iframe[src*="recaptcha/api2/bframe"]')) {
    return { kind: 'human-check', text: text.slice(0, 120) };
  }
  return null;
}

export function pageMeta(): PageMeta {
  const q = (s: string) => document.querySelector(s);
  const content = (s: string) => {
    const el = q(s) as HTMLMetaElement | null;
    return el ? el.content : null;
  };
  const h1 = q('h1');
  const canon = q('link[rel="canonical"]') as HTMLLinkElement | null;
  return {
    title: document.title,
    description: content('meta[name="description"]') || content('meta[property="og:description"]'),
    canonical: canon ? canon.href : null,
    ogImage: content('meta[property="og:image"]'),
    lang: document.documentElement.lang || null,
    h1: h1 ? (h1.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200) : null,
  };
}
