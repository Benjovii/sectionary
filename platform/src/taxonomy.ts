// Block taxonomy v1 (docs/PLAN.md section 8) and the tagger's output contract.
//
// Every list here is closed: the model answers through a JSON schema built
// from these lists (structured outputs), and validateTags() checks the answer
// again before anything reaches the database, so a value outside the taxonomy
// is a failed request, never a stored tag.

/** Bump when the prompt or the schema changes: blocks tagged under an older version are tagged again. */
export const PROMPT_VERSION = "tagger-v1.0";

/** PLAN.md section 8, global blocks, with the one-line meaning the model is given. */
export const GLOBAL_BLOCK_TYPES = {
  "announcement-bar": "thin strip above the header with a promo, shipping threshold or notice",
  "header-navigation": "logo, main menu, search, account and cart icons",
  hero: "the large opening banner of a page: headline, image or video, primary call to action",
  "usp-bar": "row of short selling points with icons (free shipping, returns, guarantees)",
  "logo-press-bar": "row of press, retailer or partner logos (\"as seen in\")",
  "image-with-text": "one image beside or behind a block of copy, a single story or feature",
  video: "a section whose main content is a video player or video embed",
  "features-grid": "grid or list of product or brand features, benefits or ingredients",
  testimonials: "customer quotes or written endorsements (not the product reviews widget)",
  "ugc-gallery": "grid or carousel of customer photos or social posts (Instagram, TikTok)",
  faq: "questions and answers, usually an accordion",
  newsletter: "email or SMS sign-up form",
  "cta-band": "short band whose job is one call to action",
  footer: "site footer: link columns, legal, payment icons, social links",
  "comparison-table": "table comparing products, plans or the brand against competitors",
  pricing: "plans or tiers with prices to choose between (not a single product's buy box)",
  team: "people: founders, team members, experts",
  "blog-teasers": "cards linking to articles, journal or blog posts",
  contact: "contact details or a contact form",
  stats: "large numbers as proof (\"1M customers\", \"4.8 stars\")",
  "how-it-works": "numbered steps or a timeline explaining a process",
  "app-download": "promotion of a mobile app with store badges",
  "trust-badges": "certification, security, payment or guarantee badges",
} as const;

/** PLAN.md section 8, e-commerce blocks. */
export const ECOMMERCE_BLOCK_TYPES = {
  "featured-collection": "a curated row or carousel of products on a home or landing page",
  "collection-grid": "the main product grid of a collection or category page, or a grid of collection tiles",
  "product-card": "a single product tile, or a section that is essentially one product card",
  "filter-sort-bar": "filters, facets and sort controls for a product listing",
  "product-gallery": "a product page's image gallery and thumbnails",
  "buy-box": "product title, price, variants and add to cart",
  "subscription-picker": "choice between one-time purchase and subscribe (and save), delivery frequency",
  "bundle-builder": "build-your-own bundle or kit: pick several items for a set price",
  "size-guide": "size chart, fit guide or measurement help",
  "shipping-returns": "shipping, delivery and returns information",
  "product-tabs": "product details in tabs or accordions (description, ingredients, how to use)",
  "product-reviews": "the reviews widget: star summary, review list, write a review",
  "cross-sell-upsell": "\"you may also like\", \"complete the look\", frequently bought together",
  "recently-viewed": "products the shopper viewed before",
  "sticky-add-to-cart": "add-to-cart bar fixed to the top or bottom while scrolling",
  "cart-drawer": "slide-out mini cart",
  "cart-page": "the cart page's line items, totals and checkout button",
  "checkout-step": "a checkout step: contact, shipping, payment",
  "order-confirmation": "thank-you or order status page content",
  account: "login, register or account dashboard",
  "search-results": "results of an on-site search",
  "quiz-finder": "a quiz or finder that recommends products",
  "store-locator": "find a physical store or stockist",
  "gift-card": "gift card purchase or balance",
} as const;

export const BLOCK_TYPES = [...Object.keys(GLOBAL_BLOCK_TYPES), ...Object.keys(ECOMMERCE_BLOCK_TYPES)] as BlockType[];
export type BlockType = keyof typeof GLOBAL_BLOCK_TYPES | keyof typeof ECOMMERCE_BLOCK_TYPES;

/** PLAN.md section 8, style. */
export const STYLE_TAGS = [
  "minimal", "bold", "playful", "luxury", "editorial", "brutalist",
  "dark", "pastel", "photo-led", "illustration-led", "typographic", "gradient",
] as const;
export type StyleTag = (typeof STYLE_TAGS)[number];

/** The app's industry keys (web/src/lib/stores.ts INDUSTRY_LABEL, src/fingerprints.ts), so tags and site filters agree. */
export const INDUSTRIES = [
  "fashion-apparel", "beauty-skincare", "food-drink", "supplements-wellness", "subscription-box", "kids-baby",
  "pets", "home-furniture", "jewellery-watches", "sports-outdoor", "tech-gadgets", "gifts-stationery", "other",
] as const;
export type Industry = (typeof INDUSTRIES)[number];

/** Where the block sits in the page's story. */
export const PAGE_ROLES = {
  opening: "the first thing a visitor sees: top of the page, in the first screen",
  navigation: "site chrome that repeats on every page: announcement bar, header, menus",
  content: "the body of the page: what this page is about",
  conversion: "where the page asks for the purchase or sign-up: buy box, pricing, add to cart, sign-up",
  "social-proof": "reviews, testimonials, press, stats and badges that build trust",
  closing: "end of the page: final call to action, footer",
} as const;
export type PageRole = keyof typeof PAGE_ROLES;
export const PAGE_ROLE_KEYS = Object.keys(PAGE_ROLES) as PageRole[];

export const MAX_STYLE_TAGS = 3;
export const MAX_PATTERNS = 6;
export const MAX_DESCRIPTION = 200;

/** What the tagger stores per block (ai_response), in the API's snake_case. */
export interface BlockTags {
  block_type: BlockType;
  page_role: PageRole;
  style_tags: StyleTag[];
  industry: Industry;
  description: string;
  patterns: string[];
  has_price: boolean;
  has_reviews: boolean;
  has_video: boolean;
}

/**
 * JSON schema for structured outputs. Enums carry the taxonomy; counts and
 * lengths are not expressible there, so validateTags() enforces them.
 */
export const TAGS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["block_type", "page_role", "style_tags", "industry", "description", "patterns", "has_price", "has_reviews", "has_video"],
  properties: {
    block_type: { type: "string", enum: BLOCK_TYPES },
    page_role: { type: "string", enum: PAGE_ROLE_KEYS },
    style_tags: { type: "array", items: { type: "string", enum: [...STYLE_TAGS] } },
    industry: { type: "string", enum: [...INDUSTRIES] },
    description: { type: "string" },
    patterns: { type: "array", items: { type: "string" } },
    has_price: { type: "boolean" },
    has_reviews: { type: "boolean" },
    has_video: { type: "boolean" },
  },
} as const;

export type Validation = { ok: true; tags: BlockTags } | { ok: false; errors: string[] };

/** Strict check of a model answer against the taxonomy. Nothing is coerced into a valid value. */
export function validateTags(value: unknown): Validation {
  const errors: string[] = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, errors: ["not an object"] };
  const v = value as Record<string, unknown>;
  const allowed = new Set(TAGS_SCHEMA.required as readonly string[]);
  for (const key of Object.keys(v)) if (!allowed.has(key)) errors.push(`unexpected field ${key}`);
  for (const key of TAGS_SCHEMA.required) if (!(key in v)) errors.push(`missing ${key}`);

  const oneOf = (key: string, list: readonly string[]) => {
    if (key in v && (typeof v[key] !== "string" || !list.includes(v[key] as string))) errors.push(`${key} ${JSON.stringify(v[key])} is not in the taxonomy`);
  };
  oneOf("block_type", BLOCK_TYPES);
  oneOf("page_role", PAGE_ROLE_KEYS);
  oneOf("industry", INDUSTRIES);

  if ("style_tags" in v) {
    const tags = v.style_tags;
    if (!Array.isArray(tags)) errors.push("style_tags is not an array");
    else {
      if (tags.length < 1 || tags.length > MAX_STYLE_TAGS) errors.push(`style_tags needs 1-${MAX_STYLE_TAGS} tags, got ${tags.length}`);
      for (const t of tags) if (!(STYLE_TAGS as readonly unknown[]).includes(t)) errors.push(`style tag ${JSON.stringify(t)} is not in the taxonomy`);
      if (new Set(tags).size !== tags.length) errors.push("style_tags repeats a tag");
    }
  }
  if ("description" in v) {
    const d = v.description;
    if (typeof d !== "string" || !d.trim()) errors.push("description is empty");
    else if (/[\r\n]/.test(d)) errors.push("description is more than one line");
    else if (d.length > MAX_DESCRIPTION) errors.push(`description is over ${MAX_DESCRIPTION} characters`);
  }
  if ("patterns" in v) {
    const p = v.patterns;
    if (!Array.isArray(p) || p.some((x) => typeof x !== "string" || !x.trim())) errors.push("patterns must be non-empty strings");
    else if (p.length > MAX_PATTERNS) errors.push(`patterns has more than ${MAX_PATTERNS} entries`);
  }
  for (const key of ["has_price", "has_reviews", "has_video"]) if (key in v && typeof v[key] !== "boolean") errors.push(`${key} is not a boolean`);

  if (errors.length) return { ok: false, errors };
  const tags = v as unknown as BlockTags;
  return { ok: true, tags: { ...tags, description: tags.description.trim(), patterns: tags.patterns.map((p) => p.trim().toLowerCase()) } };
}

/** The system prompt. Stable text only (no dates, no ids): it is the cached prefix of every request. */
export function systemPrompt(): string {
  const list = (o: Record<string, string>) => Object.entries(o).map(([k, d]) => `- ${k}: ${d}`).join("\n");
  return `You classify sections ("blocks") cut from screenshots of online store pages, for a design reference library. Designers search it by block type, style and pattern, so a label is only useful if it is the one a designer would expect.

You get one block per request: its screenshot, and what the page's DOM said about it (a section hint from the theme, its headline, its text, counts of buttons, images and videos, its position on the page). Trust the screenshot over the hint: theme section names are often generic ("section", "part") or wrong.

Answer with exactly these fields.

block_type: the one type below that best describes what the block is for. Pick by the block's main job, not by everything in it: a hero with a small trust badge is a hero; a header with an announcement strip inside it is header-navigation.

Global blocks:
${list(GLOBAL_BLOCK_TYPES)}

E-commerce blocks:
${list(ECOMMERCE_BLOCK_TYPES)}

How to separate the close calls:
- buy-box vs subscription-picker: when the purchase area offers subscribe-and-save next to one-time purchase and that choice is the focus of the block, use subscription-picker; otherwise buy-box.
- featured-collection vs collection-grid vs product-card: a curated row on a home or landing page is featured-collection; the full listing of a collection page (or a grid of collection tiles) is collection-grid; product-card only when the block is essentially one product.
- testimonials vs product-reviews: quoted endorsements chosen by the brand are testimonials; a ratings widget with a review list is product-reviews.
- features-grid vs usp-bar: a thin row of short claims is usp-bar; a fuller grid with explanations is features-grid.
- image-with-text vs hero: hero only for the opening banner of the page.
- cta-band vs newsletter: if the call to action is an email or SMS sign-up, newsletter.

page_role: one of
${list(PAGE_ROLES)}

style_tags: 1 to ${MAX_STYLE_TAGS} of: ${STYLE_TAGS.join(", ")}. Describe what you see; "photo-led" means photography carries the block, "typographic" means type does.

industry: what the store sells, one of: ${INDUSTRIES.join(", ")}. Use the hint about the site when the block itself does not say.

description: one line, at most ${MAX_DESCRIPTION} characters, saying what the block shows and does, specific enough to find it again ("Subscribe & save 15% toggle with 30/60/90-day delivery selector and savings badge").

patterns: up to ${MAX_PATTERNS} concrete UI patterns visible in the block, short and lowercase ("savings badge", "delivery frequency dropdown", "star rating summary", "countdown timer", "variant swatches"). An empty list is fine.

has_price: true if a price or currency amount is visible.
has_reviews: true if star ratings, review counts or review text are visible.
has_video: true if a video player, play button or video thumbnail is visible.`;
}
