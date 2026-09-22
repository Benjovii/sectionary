// Dominant colour buckets for the wall's colour filter (SEC-16).
//
// Block.bg is the CSS colour the crawler read off the block's background, and
// it is the only colour signal contract v1 carries. Bucketing it into a dozen
// families is what makes it filterable: nobody searches for rgb(250, 247, 242).
//
// Pure, no imports, so the verify script can exercise it directly.

export type ColourBucket = { key: string; label: string; swatch: string };

/** Ordered for the filter panel: neutrals first, then round the wheel. */
export const COLOUR_BUCKETS: ColourBucket[] = [
  { key: "white", label: "White", swatch: "#ffffff" },
  { key: "light", label: "Light", swatch: "#e8e3db" },
  { key: "grey", label: "Grey", swatch: "#9a948b" },
  { key: "dark", label: "Dark", swatch: "#3a3630" },
  { key: "black", label: "Black", swatch: "#141210" },
  { key: "red", label: "Red", swatch: "#d94a3d" },
  { key: "orange", label: "Orange", swatch: "#e8853a" },
  { key: "yellow", label: "Yellow", swatch: "#e5c144" },
  { key: "green", label: "Green", swatch: "#5ca85c" },
  { key: "teal", label: "Teal", swatch: "#3fa3a0" },
  { key: "blue", label: "Blue", swatch: "#4178c8" },
  { key: "purple", label: "Purple", swatch: "#8a5cc4" },
  { key: "pink", label: "Pink", swatch: "#d45c96" },
];

export const COLOUR_LABEL: Record<string, string> = Object.fromEntries(COLOUR_BUCKETS.map((b) => [b.key, b.label]));
export const COLOUR_SWATCH: Record<string, string> = Object.fromEntries(COLOUR_BUCKETS.map((b) => [b.key, b.swatch]));

function parse(css: string): [number, number, number] | null {
  const rgb = css.match(/rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  const hex = css.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!hex) return null;
  const full = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join("") : hex[1];
  return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
}

function compute(css: string): string | null {
  const parsed = parse(css);
  if (!parsed) return null;
  const [r, g, b] = parsed.map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  const chroma = max - min;
  const saturation = chroma === 0 ? 0 : chroma / (1 - Math.abs(2 * lightness - 1));

  // Near-neutral backgrounds are most of the web, so they get their own ladder
  // rather than being forced onto a hue.
  if (saturation < 0.15 || chroma < 0.06) {
    if (lightness > 0.94) return "white";
    if (lightness > 0.78) return "light";
    if (lightness > 0.35) return "grey";
    if (lightness > 0.14) return "dark";
    return "black";
  }

  let hue: number;
  if (max === r) hue = ((g - b) / chroma) % 6;
  else if (max === g) hue = (b - r) / chroma + 2;
  else hue = (r - g) / chroma + 4;
  hue = (hue * 60 + 360) % 360;

  if (hue < 15) return "red";
  if (hue < 45) return "orange";
  if (hue < 70) return "yellow";
  if (hue < 160) return "green";
  if (hue < 195) return "teal";
  if (hue < 255) return "blue";
  if (hue < 290) return "purple";
  if (hue < 335) return "pink";
  return "red";
}

// Stores hold thousands of blocks but only a handful of distinct background
// colours, so parsing once per colour keeps the filter off the hot path.
const cache = new Map<string, string | null>();

/** The bucket key for a CSS colour, or null when it cannot be read. */
export function bucketFor(css: string): string | null {
  const hit = cache.get(css);
  if (hit !== undefined) return hit;
  const computed = compute(css);
  cache.set(css, computed);
  return computed;
}
