// Tech-stack facets: what a block's site runs on. Counts are blocks, not sites,
// because blocks are what the wall shows. The values and counts come from the
// wall's facets (see block-source.ts), so the tech-stack row, the filter bar
// and the detail view never disagree.

export type TechKey = "platform" | "theme" | "app";
export type TechCounts = Record<TechKey, [value: string, count: number][]>;
export type Facets = Partial<Record<string, { value: string; count: number }[]>>;

export const TECH_LABEL: Record<TechKey, string> = { platform: "Platform", theme: "Theme", app: "Apps" };

/** Facets in the tech-stack shape, most common first. */
export function techFromFacets(f: Facets | undefined): TechCounts | null {
  if (!f?.platform && !f?.theme && !f?.app) return null;
  const pick = (k: TechKey) => (f[k] ?? []).map((x) => [x.value, x.count] as [string, number]);
  return { platform: pick("platform"), theme: pick("theme"), app: pick("app") };
}

export const countOf = (counts: TechCounts | null, key: TechKey, value: string) => counts?.[key].find(([v]) => v === value)?.[1] ?? null;
