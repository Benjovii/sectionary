// What the wall can be filtered by, and how that state travels in the URL.
//
// One list drives the filter bar, the query and the shareable link, so adding a
// dimension is one entry here rather than three edits in three files.
//
// SEC-16 asks for one more than this: "style". That comes from the AI tagger
// (SEC-12, Lane B) and Block carries no style field yet, so it is absent rather
// than shown as a control that cannot work.

import { PAGE_TYPE_LABEL, labelFor } from "@/lib/blocks";
import { platformLabel, industryLabel } from "@/lib/stores";
import { COLOUR_BUCKETS, COLOUR_LABEL, COLOUR_SWATCH } from "@/lib/colour";
import type { WallQuery } from "@/lib/block-source";

export type FilterKey = "page" | "block" | "vp" | "platform" | "theme" | "app" | "industry" | "country" | "video" | "color";

export type FilterSpec = {
  key: FilterKey;
  label: string;
  /** Raw facet value to what a person reads. */
  format: (value: string) => string;
  /** A colour chip beside the option, for the colour filter. */
  swatch?: (value: string) => string | undefined;
  /** Keep the facet's own order (commonest first) instead of sorting by name. */
  byCount?: boolean;
  /** A fixed order for values that have a natural one, like colours. */
  order?: string[];
  /** Long lists get a filter box inside the panel. */
  searchable?: boolean;
};

const COUNTRY_LABEL: Record<string, string> = {
  US: "United States",
  GB: "United Kingdom",
  EU: "Europe (euro store)",
  CA: "Canada",
  AU: "Australia",
  DE: "Germany",
  FR: "France",
  NL: "Netherlands",
  IE: "Ireland",
  ES: "Spain",
  IT: "Italy",
};

export const FILTERS: FilterSpec[] = [
  { key: "page", label: "Page", format: (v) => PAGE_TYPE_LABEL[v] ?? v },
  { key: "block", label: "Block", format: labelFor, byCount: true, searchable: true },
  { key: "vp", label: "Viewport", format: (v) => (v === "mobile" ? "Mobile" : "Desktop") },
  { key: "platform", label: "Platform", format: platformLabel, byCount: true },
  { key: "theme", label: "Theme", format: (v) => v, byCount: true, searchable: true },
  { key: "app", label: "Apps", format: (v) => v, byCount: true, searchable: true },
  { key: "industry", label: "Industry", format: industryLabel, byCount: true },
  { key: "country", label: "Country", format: (v) => COUNTRY_LABEL[v] ?? v, byCount: true, searchable: true },
  { key: "video", label: "Video", format: (v) => (v === "yes" ? "Has video" : "No video") },
  {
    key: "color",
    label: "Colour",
    format: (v) => COLOUR_LABEL[v] ?? v,
    swatch: (v) => COLOUR_SWATCH[v],
    // Neutrals first, then round the wheel. Alphabetical would put Black next
    // to Blue and read as noise.
    order: COLOUR_BUCKETS.map((b) => b.key),
  },
];

export const FILTER_KEYS = FILTERS.map((f) => f.key);

/** Free-text search rides in the URL beside the filters. */
export const SEARCH_KEY = "q";

export type Selected = Partial<Record<FilterKey, string[]>>;

/** Read the whole filter state out of a URL. Multi-value is comma separated. */
export function readSelected(params: URLSearchParams): Selected {
  const selected: Selected = {};
  for (const key of FILTER_KEYS) {
    const raw = params.get(key);
    if (!raw) continue;
    const values = raw.split(",").map((v) => v.trim()).filter(Boolean);
    if (values.length) selected[key] = values;
  }
  return selected;
}

/** Put one dimension's selection back into a URL, dropping it when empty. */
export function writeSelected(params: URLSearchParams, key: FilterKey, values: string[]): URLSearchParams {
  const next = new URLSearchParams(params.toString());
  if (values.length) next.set(key, values.join(","));
  else next.delete(key);
  return next;
}

/** Add or remove one value, which is what ticking a box does. */
export function toggleValue(current: string[] | undefined, value: string): string[] {
  const list = current ?? [];
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export function countSelected(selected: Selected): number {
  return FILTER_KEYS.reduce((n, key) => n + (selected[key]?.length ?? 0), 0);
}

/** The query the wall runs. Comma separated, exactly as /api/blocks expects. */
export function toQuery(selected: Selected, search: string): WallQuery {
  const query: WallQuery = {};
  for (const key of FILTER_KEYS) {
    const values = selected[key];
    if (values?.length) query[key] = values.join(",");
  }
  const trimmed = search.trim();
  if (trimmed) query.q = trimmed;
  return query;
}
