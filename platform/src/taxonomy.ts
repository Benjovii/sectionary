// Block taxonomy v1 (from PLAN.md section 8)

export const BLOCK_TAXONOMY = {
  global: [
    "announcement-bar",
    "header-navigation",
    "hero",
    "usp-bar",
    "logo-press-bar",
    "image-with-text",
    "video",
    "features-grid",
    "testimonials",
    "ugc-gallery",
    "faq",
    "newsletter",
    "cta-band",
    "footer",
    "comparison-table",
    "pricing",
    "team",
    "blog-teasers",
    "contact",
    "stats",
    "how-it-works",
    "app-download",
    "trust-badges",
  ],
  ecommerce: [
    "featured-collection",
    "collection-grid",
    "product-card",
    "filter-sort-bar",
    "product-gallery",
    "buy-box",
    "subscription-picker",
    "bundle-builder",
    "size-guide",
    "shipping-returns",
    "product-tabs",
    "product-reviews",
    "cross-sell-upsell",
    "recently-viewed",
    "sticky-add-to-cart",
    "cart-drawer",
    "cart-page",
    "checkout-step",
    "order-confirmation",
    "account",
    "search-results",
    "quiz-finder",
    "store-locator",
    "gift-card",
  ],
};

export const STYLE_TAGS = [
  "minimal",
  "bold",
  "playful",
  "luxury",
  "editorial",
  "brutalist",
  "dark",
  "pastel",
  "photo-led",
  "illustration-led",
  "typographic",
  "gradient",
];

export const INDUSTRIES = [
  "fashion",
  "beauty",
  "food-and-drink",
  "supplements",
  "subscription-boxes",
  "kids",
  "pets",
  "home",
  "jewelry",
  "sports",
  "tech-accessories",
  "gifts",
  "other",
];

export const PAGE_ROLES = [
  "above-fold",
  "mid-page",
  "below-fold",
];

export interface TaggingRequest {
  blockId: string;
  captureId: string;
  blockIndex: number;
  viewport: "desktop" | "mobile";
  imageKey: string;
  text: string;
  typeHint: string;
}

export interface TaggingResponse {
  blockId: string;
  blockType: string;
  pageRole: string;
  styleTags: string[];
  industry: string;
  description: string;
  patterns: string[];
  hasPrice: boolean;
  hasReviews: boolean;
  hasVideo: boolean;
}

// System prompt for Claude to tag blocks
export function getSystemPrompt(): string {
  return `You are a block classifier for e-commerce design. Your job is to analyze screenshots and text from website sections and classify them according to a detailed taxonomy.

## Block Types (Global)
${BLOCK_TAXONOMY.global.join(", ")}

## Block Types (E-commerce)
${BLOCK_TAXONOMY.ecommerce.join(", ")}

## Style Tags
${STYLE_TAGS.join(", ")}

## Industries
${INDUSTRIES.join(", ")}

## Page Roles
${PAGE_ROLES.join(", ")}

## Classification Rules

For each block, return a JSON object with:
- \`block_type\`: One of the block types above. Match the closest semantic meaning. If unsure, pick the most common pattern you see (e.g., grid of product cards = "product-card" or "collection-grid").
- \`page_role\`: Where this block sits on the page: "above-fold" (visible on page load), "mid-page" (scroll to see), "below-fold" (footer area).
- \`style_tags\`: 1-3 tags that describe the visual style. Pick from the list above.
- \`industry\`: The most likely industry this store/page serves. One from the list.
- \`description\`: One line describing what this block does (e.g., "Hero banner with overlaid text and CTA button").
- \`patterns\`: Array of specific UX patterns you see (e.g., ["sticky buttons", "countdown timer", "variant picker"]).
- \`has_price\`: Boolean. True if you see any prices or currency symbols.
- \`has_reviews\`: Boolean. True if you see star ratings, review text, or review counts.
- \`has_video\`: Boolean. True if you see video players, play buttons, or video thumbnails.

## Examples

### Hero Banner
Block type: "hero"
Page role: "above-fold"
Style tags: ["photo-led", "bold"]
Industry: "fashion"
Description: "Full-width hero with background image, overlay text, and prominent CTA button"
Patterns: ["full-width", "overlay text", "cta button", "video background"]
Has price: false
Has reviews: false
Has video: true

### Product Card Grid
Block type: "product-card"
Page role: "mid-page"
Style tags: ["minimal", "typographic"]
Industry: "beauty"
Description: "Grid of 4 product cards with image, title, price, and quick-add button"
Patterns: ["product grid", "quick-add", "price display", "hover effects"]
Has price: true
Has reviews: false
Has video: false

## Important Notes

- **Be specific:** If you see product cards in a grid, use "product-card", not "featured-collection".
- **Consistency:** Use exact block type names from the list. Do not invent new names.
- **Patterns:** Be concrete. "sticky buttons" > "interactive elements".
- **Industry:** Make your best guess based on product types, brand signals, and design language.
- **Always include all 9 fields** in your JSON response.

Return ONLY valid JSON. Do not include markdown, explanations, or extra text.`;
}

// Build a Batch API request item
export function buildBatchItem(
  index: number,
  request: TaggingRequest,
  imageBase64: string
): object {
  return {
    custom_id: `tag-${request.blockId}`,
    params: {
      model: "claude-opus-4-1",
      max_tokens: 500,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/webp",
                data: imageBase64,
              },
            },
            {
              type: "text",
              text: `Analyze this block from a website.

Block context:
- Text content (first 500 chars): ${request.text.slice(0, 500)}
- Block type hint from DOM: ${request.typeHint}
- Viewport: ${request.viewport}

Classify this block and return JSON with: block_type, page_role, style_tags, industry, description, patterns, has_price, has_reviews, has_video.`,
            },
          ],
        },
      ],
    },
  };
}

// Parse a batch response
export function parseBatchResponse(
  blockId: string,
  responseText: string
): TaggingResponse | null {
  try {
    const json = JSON.parse(responseText);
    return {
      blockId,
      blockType: json.block_type || "unknown",
      pageRole: json.page_role || "mid-page",
      styleTags: json.style_tags || [],
      industry: json.industry || "other",
      description: json.description || "",
      patterns: json.patterns || [],
      hasPrice: json.has_price ?? false,
      hasReviews: json.has_reviews ?? false,
      hasVideo: json.has_video ?? false,
    };
  } catch (e) {
    console.error(`Failed to parse response for ${blockId}: ${responseText}`);
    return null;
  }
}
