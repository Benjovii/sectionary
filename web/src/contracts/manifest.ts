// CONTRACT v1 · the capture manifest. Lane A (capture) writes one
// data/<host>/<page-slug>/manifest.json per page; Lane B (platform) imports it.
// src/contract-check.ts in the repo root fails the type-check if the crawler's
// own types drift from this file. Sample: fixtures/manifests/.

// Self-contained on purpose (no imports): the crawler type-checks this file
// under NodeNext resolution, where extensionless relative imports are errors.
type Viewport = "desktop" | "mobile";

export type ManifestSite = {
  host: string;
  origin: string;
  platform?: string;
  theme?: Record<string, unknown> | null;
  builder?: string | null;
  apps?: string[];
  currency?: string | null;
  locale?: string | null;
};

export type ManifestPage = {
  url: string;
  /** home | collection | collection-list | product | cart | checkout | search | account | article | blog | page | other */
  type: string;
  slug: string;
  capturedAt: string;
  title?: string;
  description?: string | null;
  canonical?: string | null;
  ogImage?: string | null;
  lang?: string | null;
  h1?: string | null;
};

export type ManifestViewport =
  | { file: string; width: number; fullHeight: number; strategy: string; status: number | null; ms: number }
  | { error: string; status: number | null };

export type ManifestBlock = {
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
  viewport: Viewport;
  /** Path relative to the manifest's folder, or null when the screenshot failed. */
  file: string | null;
  error?: string;
};

export type Manifest = {
  site: ManifestSite;
  page: ManifestPage;
  viewports: Partial<Record<Viewport, ManifestViewport>>;
  blocks: ManifestBlock[];
};
