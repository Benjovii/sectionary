import type { Block } from "@/contracts/block";

// Tech-stack facets: what a block's site runs on. Counts are blocks, not sites,
// because blocks are what the wall shows.

export type TechKey = "platform" | "theme" | "app";
export type TechCounts = Record<TechKey, [value: string, count: number][]>;
export type Facets = Partial<Record<string, { value: string; count: number }[]>>;

export const TECH_LABEL: Record<TechKey, string> = { platform: "Platform", theme: "Theme", app: "App" };

const valuesOf = (b: Block, key: TechKey): string[] =>
  key === "app" ? b.apps : key === "platform" ? (b.platform ? [b.platform] : []) : b.theme ? [b.theme] : [];

export const blockHas = (b: Block, key: TechKey, value: string) => valuesOf(b, key).includes(value);

/** Most common first, then alphabetical. */
export function countTech(blocks: Block[]): TechCounts {
  const out = {} as TechCounts;
  for (const key of ["platform", "theme", "app"] as TechKey[]) {
    const m = new Map<string, number>();
    for (const b of blocks) for (const v of valuesOf(b, key)) m.set(v, (m.get(v) ?? 0) + 1);
    out[key] = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }
  return out;
}

/** The API's facets in the same shape, when it sends them. */
export function techFromFacets(f: Facets | undefined): TechCounts | null {
  if (!f?.platform && !f?.theme && !f?.app) return null;
  const pick = (k: TechKey) => (f[k] ?? []).map((x) => [x.value, x.count] as [string, number]);
  return { platform: pick("platform"), theme: pick("theme"), app: pick("app") };
}

export const countOf = (counts: TechCounts | null, key: TechKey, value: string) => counts?.[key].find(([v]) => v === value)?.[1] ?? null;
