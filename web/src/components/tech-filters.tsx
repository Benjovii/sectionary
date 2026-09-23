"use client";

import { Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { platformLabel } from "@/lib/stores";
import type { FilterKey, Selected } from "@/lib/filters";
import { TECH_LABEL, type Facets, type TechKey } from "@/lib/tech";

const CHIPS: Record<TechKey, number> = { platform: 6, theme: 6, app: 10 };

const Count = ({ n }: { n: number }) => <span className="font-mono text-[10px] tabular-nums opacity-60">{n.toLocaleString("en-US")}</span>;

/**
 * The tech-stack row on the wall: platform, theme and apps up front, each with
 * the number of blocks it would show. It is a shortcut onto the same filters as
 * the filter bar (same URL keys, same facets), so the two never disagree; the
 * full lists stay in the bar's panels.
 */
export function TechFilters({
  facets,
  selected,
  onToggle,
}: {
  facets: Facets;
  selected: Selected;
  onToggle: (key: FilterKey, value: string) => void;
}) {
  // The commonest values, plus anything selected that fell outside them, so a
  // ticked chip never disappears.
  const chips = (key: TechKey) => {
    const all = facets[key] ?? [];
    const top = all.slice(0, CHIPS[key]);
    const extra = (selected[key] ?? []).filter((v) => !top.some((f) => f.value === v)).map((v) => all.find((f) => f.value === v) ?? { value: v, count: 0 });
    return [...top, ...extra];
  };
  const rows = (["platform", "theme", "app"] as TechKey[]).map((key) => ({ key, items: chips(key) })).filter((r) => r.items.length > 0);
  if (!rows.length) return null;

  return (
    <section aria-label="Tech stack" className="flex flex-col gap-2 rounded-lg border bg-card px-3 py-2.5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-4">
      <h2 className="inline-flex items-center gap-1.5 text-[12px] font-medium">
        <Layers className="size-3.5 text-muted-foreground" aria-hidden />
        Tech stack
      </h2>
      {rows.map(({ key, items }) => (
        <div key={key} className="flex min-w-0 flex-wrap items-center gap-1" role="group" aria-label={TECH_LABEL[key]}>
          {items.map(({ value, count }) => {
            const on = selected[key]?.includes(value) ?? false;
            return (
              <Button key={value} variant="outline" size="sm" active={on} aria-pressed={on} onClick={() => onToggle(key, value)}>
                {key === "platform" ? platformLabel(value) : value} <Count n={count} />
              </Button>
            );
          })}
        </div>
      ))}
    </section>
  );
}
