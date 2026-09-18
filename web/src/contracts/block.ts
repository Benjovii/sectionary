// CONTRACT v1 · shared between lanes. Change only through a pull request
// labelled `contract`, reviewed by every lane. Additive changes only within a
// milestone; a breaking change bumps CONTRACT_VERSION in ./api.ts.
//
// Pure types, no imports from Next.js or Node: the crawler and the platform
// import this file too.

export type Viewport = "desktop" | "mobile";

/** One captured block as the web app receives it (sample JSON today, /api/blocks tomorrow). */
export type Block = {
  /** Stable id: `<host>/<page-slug>/<viewport>/<index>` until the database issues uuids. */
  id: string;
  host: string;
  pageType: string;
  pageUrl: string;
  pageTitle: string | null;
  viewport: Viewport;
  /** Raw type from capture ("featured-collection"); the AI tagger adds `blockType` later. */
  typeHint: string;
  headline: string | null;
  /** CSS colour of the block background, painted behind the image while it loads. */
  bg: string;
  /** CSS pixel size of the block. The image may be 2x on mobile; use these for aspect ratio. */
  w: number;
  h: number;
  /** Path or absolute URL of the screenshot. Relative paths resolve against the asset base. */
  src: string;
  platform: string | null;
  theme: string | null;
  apps: string[];
  buttons: number;
  images: number;
  videos: number;
  /** First 400 characters of the block's visible text. */
  text: string;
};

export type BlockSet = { generatedAt: string; blocks: Block[] };
