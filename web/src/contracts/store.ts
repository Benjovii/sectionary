// CONTRACT v1 · see ./block.ts for the change rules.

/** One validated store (seeds/stores.validated.csv today, /api/stores tomorrow). */
export type Store = {
  /** Position in the ranked list, 1-based. */
  n: number;
  host: string;
  brand: string;
  title: string | null;
  platform: string | null;
  builder: string | null;
  theme: string | null;
  themeVersion: string | null;
  currency: string | null;
  /** ISO country code, "EU" for a euro store with no country signal, or null. */
  country: string | null;
  /** One of the keys in INDUSTRY_LABEL (web/src/lib/stores.ts), "other" when unsure. */
  industry: string;
  industryScore: number;
  apps: string[];
  collections: number | null;
  /** Tranco traffic rank, lower is bigger; null when outside the top million. */
  rank: number | null;
  mentions: number;
  sources: string[];
  validatedAt: string | null;
};

export type StoreSet = { generatedAt: string; stores: Store[] };
