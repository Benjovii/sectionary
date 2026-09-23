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
  /** Share of the page's height covered by block-sized pieces, for the way that was chosen (0 to 1). */
  coverage: number;
  /** The same share for every way that was tried: why this one won. */
  scores: Record<string, number>;
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
    // Headers are often slimmer than any other block worth keeping (mejuri.com: about 60px).
    const slim = /^(header|nav)$/i.test(el.tagName) || el.getAttribute('role') === 'banner';
    return r.width >= vw * 0.5 && r.height >= (slim ? 40 : opts.minHeight);
  }

  // `own`: only what the element says about itself. For something that was split into pieces a marker
  // found somewhere inside it would be wrong for most pieces (grenson.com: the body's first marked
  // descendant is the footer, and the hero came out as "footer-webpages-part").
  function typeHintFor(el: Element, own = false): string {
    const inner = own ? null : el.querySelector('[data-section-type]');
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

  const vh = window.innerHeight;
  const maxH = Math.round(Math.max(vh * 2.2, vw < 600 ? 2400 : 1800));

  // How tall an element's content really is. A wrapper can claim one screen
  // while its content runs for eight (store.dji.com: main is 900px, its content
  // 8,201px). Only when the overflow is painted, not inside a scroll box.
  function extent(el: Element): number {
    const h = el.getBoundingClientRect().height;
    return getComputedStyle(el).overflowY === 'visible' ? Math.max(h, (el as HTMLElement).scrollHeight || 0) : h;
  }

  // A child that can be a block of its own: visible, at least half the screen
  // wide (so side-by-side columns never split their parent), on screen, and
  // part of the page's flow. Pinned or absolutely placed elements are overlays,
  // except a header laid over the hero, which is wide, short and at the top.
  function isRow(el: Element): boolean {
    if (!isVisible(el)) return false;
    const r = el.getBoundingClientRect();
    if (r.right <= 0 || r.left >= vw) return false;
    const pos = getComputedStyle(el).position;
    // A sticky layer as tall as the screen is a pinned backdrop (anker.com's video stages): it overlaps
    // whatever scrolls past it, so its picture would only repeat its neighbours.
    if (pos === 'sticky' && r.height >= vh * 0.8) return false;
    if (pos !== 'fixed' && pos !== 'absolute') return true;
    // A pinned element's position is measured against the screen, an absolute one's against the page.
    const top = pos === 'fixed' ? r.top : r.top + window.scrollY;
    return top <= 10 && r.width >= vw * 0.9 && r.height <= vh * 0.4;
  }

  // Anything taller than about two screens is a wrapper (a page builder's
  // canvas, a custom "main" section, the body itself). Descend until the
  // pieces are block-sized. `splits` counts real splits against `budget`;
  // single-child wrapper hops are free but capped so a pathological DOM cannot
  // loop forever.
  // `first`: the walk from the body has not made its first cut yet. Until it has, height is no reason
  // to stop: a short page (amydiener.com, under two screens) would otherwise be one block, the body.
  function refine(el: Element, splits: number, hops: number, budget: number, note: { refined: boolean }, first = false): Element[] {
    const h = extent(el);
    if ((h <= maxH && !first) || splits >= budget || hops >= 14) return [el];
    const kids = Array.from(el.children).filter(isRow);
    if (kids.length < 2) {
      const wrapper = Array.from(el.children).find((c) => isRow(c) && extent(c) >= h * 0.6);
      return wrapper ? refine(wrapper, splits, hops + 1, budget, note, first) : [el];
    }
    const sum = kids.reduce((s, k) => s + extent(k), 0);
    if (sum < h * 0.6) return [el];
    note.refined = true;
    return kids.flatMap((k) => refine(k, splits + 1, hops + 1, budget, note));
  }

  // Nothing to look at: no words, no media, no background picture. Page builders space their rows with
  // empty strips (anker.com: 96px `ipc_spacer` divs) and reserve scroll room with empty full-screen boxes.
  function isEmpty(el: Element): boolean {
    if (((el as HTMLElement).innerText || '').trim()) return false;
    if (el.querySelector('img, picture, video, svg, canvas, iframe, input, select, textarea')) return false;
    for (const node of [el, ...Array.from(el.querySelectorAll('*')).slice(0, 40)]) {
      const bg = getComputedStyle(node).backgroundImage;
      if (bg && bg !== 'none') return false;
    }
    return true;
  }

  const outermost = (list: Element[]) => list.filter((el) => !list.some((o) => o !== el && o.contains(el)));

  // Three ways to cut a page. None is trusted blindly: each is scored by how
  // much of the page it covers with block-sized pieces, because a way that
  // "works" can still miss nearly everything. farrow-ball.com has a header and
  // a footer tag and 16 plain div rows in between (14% covered); jbhifi.com.au
  // marks only its header and footer as Shopify sections (8%).
  const ways: { name: string; budget: number; roots: () => Element[] }[] = [
    { name: 'shopify-sections', budget: 4, roots: () => Array.from(document.querySelectorAll('.shopify-section')) },
    {
      name: 'semantic',
      budget: 4,
      roots: () =>
        outermost(
          Array.from(
            document.querySelectorAll('header, footer, section, [class*="elementor-top-section"], .e-con.e-parent, .section, .w-section, [data-section]'),
          ).filter(isVisible),
        ),
    },
    // The page's own flow from the top: rows of the body, then rows of whatever is still too tall.
    { name: 'flow', budget: 6, roots: () => [document.body] },
  ];

  type Cut = { name: string; chosen: Element[]; parentHint: Map<Element, string>; score: number };
  const cuts: Cut[] = ways.map((way) => {
    const note = { refined: false };
    const parentHint = new Map<Element, string>();
    const roots = way.name === 'flow' ? way.roots() : outermost(way.roots().filter(isVisible));
    const chosen = outermost(
      roots.flatMap((el) => {
        // The body says nothing about its pieces: WordPress puts words like `wp-custom-logo` on it,
        // and every block of papyrusonline.com came out as "logo-part".
        const hint = el === document.body ? 'unknown' : typeHintFor(el, true);
        const parts = refine(el, 0, 0, way.budget, note, el === document.body);
        if (hint !== 'unknown') for (const p of parts) if (p !== el) parentHint.set(p, hint);
        return parts;
      }),
    )
      .filter((el) => el !== document.body && !isEmpty(el))
      .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
    // Share of the page covered by pieces no taller than a generous block.
    let covered = 0;
    let cursor = 0;
    for (const el of chosen) {
      const r = el.getBoundingClientRect();
      if (r.height > maxH * 1.25) continue;
      const top = r.top + window.scrollY;
      const start = Math.max(top, cursor);
      if (top + r.height > start) covered += top + r.height - start;
      cursor = Math.max(cursor, top + r.height);
    }
    return { name: way.name + (note.refined ? '+refine' : ''), chosen, parentHint, score: docH ? covered / docH : 0 };
  });

  // The first way that covers most of the page wins (a store's own section
  // markers beat tags, tags beat raw flow); if none does, the best cover wins.
  const best = cuts.find((c) => c.score >= 0.6 && c.chosen.length >= 3) || [...cuts].sort((a, b) => b.score - a.score || b.chosen.length - a.chosen.length)[0];
  const strategy = best.name;
  const chosen = [...best.chosen];

  // Safety net for the header, one of the most wanted block types. A pinned header often sits in a
  // zero-height wrapper (zwift.com), which no walk through the page's rows ever reaches.
  const isHeader = (el: Element) => /^(header|nav)$/i.test(el.tagName) || el.getAttribute('role') === 'banner';
  if (!chosen.some((el) => isHeader(el) || el.querySelector('header, [role="banner"]'))) {
    const header = Array.from(document.querySelectorAll('header, [role="banner"]')).find((el) => {
      if (!isVisible(el)) return false;
      const r = el.getBoundingClientRect();
      const top = getComputedStyle(el).position === 'fixed' ? r.top : r.top + window.scrollY;
      return top <= 150 && r.width >= vw * 0.9 && r.height <= vh * 0.4;
    });
    if (header) chosen.unshift(header);
  }
  const parentHint = best.parentHint;

  const blocks: BlockInfo[] = [];
  chosen.slice(0, opts.maxBlocks).forEach((el, i) => {
    const ref = 'b' + (i + 1);
    el.setAttribute('data-secref', ref);
    const r = el.getBoundingClientRect();
    const own = typeHintFor(el);
    // A piece cut out of something larger says what it was cut from: the root
    // it came from, or the nearest header, footer, nav or marked section above it.
    let parent = parentHint.get(el) || null;
    for (let up = el.parentElement, n = 0; !parent && up && up !== document.body && n < 6; up = up.parentElement, n++) {
      const tag = up.tagName.toLowerCase();
      if (tag === 'header' || tag === 'footer' || tag === 'nav' || up.hasAttribute('data-section-type') || /^shopify-section-/.test(up.id)) parent = typeHintFor(up, true);
    }
    if (parent === 'unknown') parent = null;
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
      // A pinned element sits where the screen is, wherever the page has scrolled to.
      top: Math.round(cs.position === 'fixed' ? r.top : r.top + window.scrollY),
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

  const scores: Record<string, number> = {};
  for (const c of cuts) scores[c.name] = Math.round(c.score * 100) / 100;
  return { strategy, coverage: Math.round(best.score * 100) / 100, scores, docHeight: docH, viewportWidth: vw, blocks };
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
    // The site fell over (mytheresa.com: "Something went wrong", a "report issue" button and nothing else).
    ['error-page', /something went wrong|an (unexpected )?error (has )?occurred|internal server error|service (is )?(temporarily )?unavailable|we.?re sorry, (something|an error|this page)/i],
    // A country chooser instead of the store (canyon.com: "Choose your location and language").
    ['location-gate', /(choose|select|pick) your (location|country|region|shipping destination|delivery country)|where (do you want|would you like) (us )?to (ship|deliver)/i],
  ];
  for (const [kind, re] of tests) if (re.test(hay)) return { kind, text: text.slice(0, 120) };
  // Elements that exist only on a challenge page.
  if (document.querySelector('#px-captcha, #challenge-form, #challenge-stage, .cf-browser-verification, iframe[src*="captcha-delivery"]')) {
    return { kind: 'human-check', text: text.slice(0, 120) };
  }
  // A reCAPTCHA or hCaptcha frame also sits, hidden and empty, on any page with
  // a protected form (stores with a newsletter box were failed as walls). Only
  // a frame that is actually shown, at challenge size, counts.
  for (const f of Array.from(document.querySelectorAll<HTMLIFrameElement>('iframe[src*="hcaptcha.com"], iframe[src*="recaptcha/api2/bframe"]'))) {
    const r = f.getBoundingClientRect();
    const cs = getComputedStyle(f);
    if (r.width >= 200 && r.height >= 200 && cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0) return { kind: 'human-check', text: text.slice(0, 120) };
  }
  return null;
}

/**
 * Hide what is pinned to the screen, so it does not land on top of a
 * screenshot: chat bubbles, discount tabs, sticky headers, "choose your
 * country" dialogs and their backdrops. Made transparent, which moves nothing
 * on the page, and put back by restorePinned(). Nothing is clicked.
 *
 * With a block `ref`: everything pinned goes, except the block itself, what it
 * contains and what contains it (so a sticky header still gets its own shot).
 * Without one (the full-page picture): only `fixed` elements go, because at
 * the top of the page a sticky element sits in its natural place, and a header
 * pinned to the top stays because it is part of the design.
 */
export function hidePinned(arg: { ref: string | null; rescan: boolean }): number {
  const w = window as unknown as { __secHidden?: [HTMLElement, string, string][]; __secPinned?: Set<HTMLElement> };
  for (const [el, value, priority] of w.__secHidden || []) {
    if (value) el.style.setProperty('opacity', value, priority);
    else el.style.removeProperty('opacity');
  }
  w.__secHidden = [];

  // Scans are remembered and added up, because reading every element's style
  // is the slow part (175 ms on a 19,000-element page) and because one scan is
  // not enough: many headers only become pinned once the page has scrolled, so
  // the caller scans at the top and again further down.
  if (arg.rescan || !w.__secPinned) {
    const found = w.__secPinned || new Set<HTMLElement>();
    const scan = (root: ParentNode) => {
      for (const el of Array.from(root.querySelectorAll<HTMLElement>('*'))) {
        if (el.shadowRoot) scan(el.shadowRoot);
        const pos = getComputedStyle(el).position;
        if (pos === 'fixed' || pos === 'sticky') found.add(el);
      }
    };
    scan(document);
    w.__secPinned = found;
  }

  const block = arg.ref ? document.querySelector(`[data-secref="${arg.ref}"]`) : null;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  for (const el of w.__secPinned) {
    if (!el.isConnected) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    // A pinned layer as large as the screen that sits behind the content (sticky, or fixed with no
    // stacking order of its own) is a backdrop: hiding it would blank the blocks that scroll over it.
    // A dialog's backdrop sits in front, which takes a positive z-index.
    const box = el.getBoundingClientRect();
    const fullScreen = box.width >= vw * 0.9 && box.height >= vh * 0.8;
    if (fullScreen && (cs.position === 'sticky' || !(parseInt(cs.zIndex, 10) > 0))) continue;
    if (block) {
      if (el === block || el.contains(block) || block.contains(el)) continue;
    } else {
      if (cs.position !== 'fixed') continue;
      // A header pinned to the top, possibly under an announcement bar, is part of the design.
      const r = el.getBoundingClientRect();
      if (r.height > 0 && r.top <= 120 && r.bottom <= vh * 0.5 && r.width >= vw * 0.9) continue;
    }
    // Transparent rather than `visibility: hidden`: a child can override visibility (zwift.com's menu
    // items did), nothing overrides a parent's opacity, and neither moves anything on the page.
    w.__secHidden.push([el, el.style.getPropertyValue('opacity'), el.style.getPropertyPriority('opacity')]);
    el.style.setProperty('opacity', '0', 'important');
  }
  return w.__secHidden.length;
}

export function restorePinned(): void {
  const w = window as unknown as { __secHidden?: [HTMLElement, string, string][] };
  for (const [el, value, priority] of w.__secHidden || []) {
    if (value) el.style.setProperty('opacity', value, priority);
    else el.style.removeProperty('opacity');
  }
  w.__secHidden = [];
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
