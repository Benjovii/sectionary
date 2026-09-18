// The Store shape is a cross-lane contract: it lives in src/contracts.
export type { Store, StoreSet } from "@/contracts/store";

export const INDUSTRY_LABEL: Record<string, string> = {
  "fashion-apparel": "Fashion & apparel",
  "beauty-skincare": "Beauty & skincare",
  "food-drink": "Food & drink",
  "supplements-wellness": "Supplements & wellness",
  "subscription-box": "Subscription box",
  "kids-baby": "Kids & baby",
  pets: "Pets",
  "home-furniture": "Home & furniture",
  "jewellery-watches": "Jewellery & watches",
  "sports-outdoor": "Sports & outdoor",
  "tech-gadgets": "Tech & gadgets",
  "gifts-stationery": "Gifts & stationery",
  other: "Other",
};

export const PLATFORM_LABEL: Record<string, string> = {
  shopify: "Shopify",
  woocommerce: "WooCommerce",
  bigcommerce: "BigCommerce",
  magento: "Magento",
  salesforce: "Salesforce Commerce",
  prestashop: "PrestaShop",
  shopware: "Shopware",
  "squarespace-commerce": "Squarespace",
  squarespace: "Squarespace",
  "wix-stores": "Wix",
  wix: "Wix",
  webflow: "Webflow",
  framer: "Framer",
  nextjs: "Custom (Next.js)",
  nuxt: "Custom (Nuxt)",
  wordpress: "WordPress",
};

export const platformLabel = (p: string | null) => (p ? (PLATFORM_LABEL[p] ?? p) : "Unknown");
export const industryLabel = (i: string) => INDUSTRY_LABEL[i] ?? i;
export const rankLabel = (r: number | null) => (r == null ? "–" : r.toLocaleString("en-US"));
