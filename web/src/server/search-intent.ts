// Search query understanding (SEC-17): which block type a query names, and what
// such blocks actually say. No imports, so scripts and tests can load it as is.
//
// People search the library in design words ("subscription picker with savings
// badge") while a block's copy says what a shopper reads ("Subscribe & save
// 15%", "Deliver every 30 days"). Full text alone matches "subscription" in a
// menu as readily as in a purchase option, and "picker" and "badge" in nothing.
// So when a query names a block type from the taxonomy (docs/PLAN.md section 8,
// platform/src/taxonomy.ts), the words that name it are replaced by one group:
// the type itself (matches blocks the tagger has labelled) or the copy that
// marks such a block. The group stands for as many query words as it replaced.

/** Copy that marks each block type, in websearch syntax (quote phrases). Kept short: these are signals, not descriptions. */
export const TYPE_VOCABULARY: Record<string, string[]> = {
  "announcement-bar": ["announcement", "\"free shipping\"", "\"limited time\""],
  "header-navigation": ["menu", "navigation", "\"shop all\""],
  hero: ["hero", "\"shop now\"", "discover"],
  "usp-bar": ["\"free shipping\"", "\"free returns\"", "guarantee"],
  "logo-press-bar": ["\"as seen in\"", "\"featured in\"", "press"],
  "image-with-text": ["story", "\"learn more\""],
  video: ["video", "watch", "play"],
  "features-grid": ["features", "benefits", "ingredients"],
  testimonials: ["testimonials", "\"what our customers say\"", "loved"],
  "ugc-gallery": ["instagram", "tiktok", "\"tag us\""],
  faq: ["faq", "faqs", "\"frequently asked\"", "questions"],
  newsletter: ["newsletter", "\"sign up\"", "subscribe", "email", "inbox"],
  "cta-band": ["\"get started\"", "\"shop now\"", "\"join now\""],
  footer: ["footer", "\"privacy policy\"", "\"terms of service\"", "copyright"],
  "comparison-table": ["\"vs\"", "versus", "\"compare\"", "\"us vs them\"", "others"],
  pricing: ["pricing", "plans", "\"per month\"", "\"per year\"", "tier"],
  team: ["team", "founders", "\"meet the\""],
  "blog-teasers": ["blog", "journal", "articles", "\"read more\""],
  contact: ["contact", "\"get in touch\"", "phone"],
  stats: ["customers", "\"5-star\"", "million"],
  "how-it-works": ["\"how it works\"", "step", "steps"],
  "app-download": ["\"app store\"", "\"google play\"", "\"download the app\""],
  "trust-badges": ["\"secure checkout\"", "certified", "guarantee", "badges"],
  "featured-collection": ["\"best sellers\"", "bestsellers", "featured", "\"shop all\""],
  "collection-grid": ["collection", "products", "\"sort by\"", "filter"],
  "product-card": ["\"add to cart\"", "\"quick add\"", "\"quick view\""],
  "filter-sort-bar": ["filter", "\"sort by\"", "\"price range\""],
  "product-gallery": ["gallery", "zoom", "thumbnails"],
  "buy-box": ["\"add to cart\"", "quantity", "\"buy now\"", "size", "variant"],
  "subscription-picker": [
    "\"subscribe and save\"", "\"subscribe & save\"", "subscribe", "subscription", "autoship", "\"auto-ship\"", "\"one-time purchase\"",
    "\"deliver every\"", "\"delivered every\"", "\"ships every\"", "\"delivery frequency\"", "recurring",
  ],
  "bundle-builder": ["bundle", "\"build your\"", "kit", "\"mix and match\""],
  "size-guide": ["\"size guide\"", "\"size chart\"", "measurements"],
  "shipping-returns": ["shipping", "returns", "delivery", "refund"],
  "product-tabs": ["description", "ingredients", "\"how to use\"", "details"],
  "product-reviews": ["reviews", "review", "rating", "ratings", "rated", "stars", "\"verified buyer\"", "\"verified reviewer\""],
  "cross-sell-upsell": ["\"you may also like\"", "\"frequently bought together\"", "\"complete the look\"", "\"pairs well\""],
  "recently-viewed": ["\"recently viewed\""],
  "sticky-add-to-cart": ["\"add to cart\""],
  "cart-drawer": ["cart", "subtotal", "checkout"],
  "cart-page": ["cart", "subtotal", "checkout", "\"order summary\""],
  "checkout-step": ["checkout", "shipping", "payment"],
  "order-confirmation": ["\"thank you\"", "\"order confirmed\"", "\"order number\""],
  account: ["login", "\"sign in\"", "account", "register"],
  "search-results": ["\"search results\"", "results"],
  "quiz-finder": ["quiz", "\"find your\"", "\"take the quiz\""],
  "store-locator": ["\"store locator\"", "\"find a store\"", "stockists"],
  "gift-card": ["\"gift card\"", "\"e-gift\""],
};

/** Other ways people name a type; each entry is the words that must all appear. */
const ALIASES: Record<string, string[][]> = {
  "header-navigation": [["header"], ["navigation"], ["nav"], ["menu"]],
  "announcement-bar": [["announcement"]],
  "usp-bar": [["usp"]],
  "logo-press-bar": [["press"], ["logo", "bar"], ["logos"]],
  "features-grid": [["features"], ["benefits"]],
  testimonials: [["testimonial"]],
  "ugc-gallery": [["ugc"], ["instagram"]],
  faq: [["faqs"], ["questions"]],
  newsletter: [["signup"], ["sign", "up"], ["email", "capture"]],
  "comparison-table": [["comparison"], ["compare"]],
  "blog-teasers": [["blog"], ["articles"]],
  "how-it-works": [["steps"], ["timeline"]],
  "trust-badges": [["trust"]],
  "collection-grid": [["product", "grid"]],
  "subscription-picker": [["subscribe", "save"], ["autoship"], ["subscription", "selector"], ["subscription", "toggle"], ["subscription", "options"]],
  "bundle-builder": [["bundle"], ["build", "box"]],
  "size-guide": [["size", "chart"], ["fit", "guide"]],
  "shipping-returns": [["shipping"], ["returns"]],
  "product-reviews": [["reviews"], ["ratings"], ["review"]],
  "cross-sell-upsell": [["upsell"], ["cross", "sell"], ["recommendations"]],
  "quiz-finder": [["quiz"], ["finder"]],
  "store-locator": [["stockists"]],
};

/** Levenshtein distance, early exit past `max`. */
export function editDistance(a: string, b: string, max = Infinity): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, cur[j]);
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/** How far a typed word may be from what it meant: one edit for short words, two from eight letters. */
export const maxEdits = (word: string) => (word.length >= 8 ? 2 : 1);

/** True when `typed` is `word`, a plural or singular of it, or a typo of it. */
export function sameWord(typed: string, word: string): boolean {
  if (typed === word || typed === `${word}s` || word === `${typed}s`) return true;
  return typed.length >= 4 && editDistance(typed, word, maxEdits(word)) <= maxEdits(word);
}

export interface Intent { type: string; words: string[] }

/**
 * Block types the query names, each with the query words it used. Longer names
 * win (a query word belongs to one type at most), so "product reviews" is
 * product-reviews, not product-card.
 */
export function detectIntents(words: string[]): Intent[] {
  const candidates: { type: string; parts: string[] }[] = [];
  for (const type of Object.keys(TYPE_VOCABULARY)) {
    candidates.push({ type, parts: type.split("-").filter((p) => p !== "and") });
    for (const alias of ALIASES[type] ?? []) candidates.push({ type, parts: alias });
  }
  candidates.sort((a, b) => b.parts.length - a.parts.length || a.type.localeCompare(b.type));

  const used = new Set<number>();
  const found = new Map<string, Set<number>>();
  for (const { type, parts } of candidates) {
    const hits: number[] = [];
    for (const part of parts) {
      const i = words.findIndex((w, k) => !used.has(k) && !hits.includes(k) && sameWord(w, part));
      if (i < 0) break;
      hits.push(i);
    }
    if (hits.length !== parts.length) continue;
    for (const i of hits) used.add(i);
    found.set(type, new Set([...(found.get(type) ?? []), ...hits]));
  }
  return [...found].map(([type, idx]) => ({ type, words: [...idx].sort((a, b) => a - b).map((i) => words[i]) }));
}

/** The websearch terms for an intent: the type as tagged, then the copy that marks it. */
export const intentTerms = (type: string) => [`"${type}"`, ...TYPE_VOCABULARY[type]];
