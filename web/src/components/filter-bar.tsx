"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { FILTERS, countSelected, type FilterKey, type Selected } from "@/lib/filters";

type Facets = Record<string, { value: string; count: number }[]>;

/**
 * Multi-select filters for the wall (SEC-16).
 *
 * A row of chips with one panel beneath, rather than a popover per chip: at
 * 375px a panel anchored to a chip has nowhere to go, and this way the open
 * list always gets the full width. One panel is open at a time.
 *
 * Every count comes from the facets, which are computed ignoring their own
 * dimension, so ticking one platform still shows what the others would add.
 */
export function FilterBar({
  facets,
  selected,
  search,
  total,
  ready,
  onToggle,
  onClearAll,
  onSearch,
}: {
  facets: Facets;
  selected: Selected;
  search: string;
  total: number;
  ready: boolean;
  onToggle: (key: FilterKey, value: string) => void;
  onClearAll: () => void;
  onSearch: (value: string) => void;
}) {
  const [open, setOpen] = useState<FilterKey | null>(null);
  const [needle, setNeedle] = useState("");
  const root = useRef<HTMLDivElement>(null);

  // Close on Escape or a click outside, the two things people expect.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(null);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const spec = FILTERS.find((f) => f.key === open) ?? null;
  const picked = spec ? (selected[spec.key] ?? []) : [];

  const options = useMemo(() => {
    if (!spec) return [];
    const list = facets[spec.key] ?? [];
    const rank = spec.order;
    const ordered = rank
      ? [...list].sort((a, b) => rank.indexOf(a.value) - rank.indexOf(b.value))
      : spec.byCount
        ? list
        : [...list].sort((a, b) => spec.format(a.value).localeCompare(spec.format(b.value)));
    const trimmed = needle.trim().toLowerCase();
    if (!trimmed) return ordered;
    return ordered.filter((o) => spec.format(o.value).toLowerCase().includes(trimmed) || o.value.toLowerCase().includes(trimmed));
  }, [spec, facets, needle]);

  const activeCount = countSelected(selected) + (search.trim() ? 1 : 0);

  return (
    <div ref={root} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {FILTERS.map((filter) => {
          const chosen = selected[filter.key] ?? [];
          const isOpen = open === filter.key;
          return (
            <Button
              key={filter.key}
              variant="outline"
              size="sm"
              active={chosen.length > 0}
              aria-expanded={isOpen}
              aria-controls={isOpen ? "filter-panel" : undefined}
              onClick={() => {
                setNeedle("");
                setOpen((prev) => (prev === filter.key ? null : filter.key));
              }}
            >
              {filter.label}
              {chosen.length > 0 && (
                <span className="rounded-full bg-background/25 px-1.5 font-mono text-[10px] tabular-nums">{chosen.length}</span>
              )}
              <ChevronDown className={cn("size-3 transition-transform duration-150", isOpen && "rotate-180")} />
            </Button>
          );
        })}

        <input
          type="search"
          value={search}
          placeholder="Search headline or copy…"
          aria-label="Search"
          onChange={(e) => onSearch(e.target.value)}
          className="h-7 min-w-0 flex-1 basis-40 rounded-lg border bg-background px-2.5 text-[12px] outline-none placeholder:text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30 sm:max-w-56"
        />

        {activeCount > 0 && (
          <Button variant="ghost" size="sm" onClick={onClearAll}>
            <X className="size-3" />
            Clear all
          </Button>
        )}

        {/* Fixed width: "loading…" and "30,000 blocks" are different lengths,
            and without this the count nudges itself sideways on arrival. That
            was the only layout shift left on the wall. */}
        <span
          className="ml-auto min-w-[96px] shrink-0 text-right font-mono text-[11px] tabular-nums text-muted-foreground"
          aria-live="polite"
        >
          {ready ? `${total.toLocaleString("en-US")} blocks` : "loading…"}
        </span>
      </div>

      {spec && (
        <div id="filter-panel" role="group" aria-label={spec.label} className="rounded-lg border bg-popover p-1 text-popover-foreground">
          {spec.searchable && (facets[spec.key] ?? []).length > 8 && (
            <input
              type="search"
              value={needle}
              autoFocus
              placeholder={`Find a ${spec.label.toLowerCase()}…`}
              aria-label={`Find a ${spec.label.toLowerCase()}`}
              onChange={(e) => setNeedle(e.target.value)}
              className="mb-1 h-8 w-full rounded-md border bg-background px-2.5 text-[12px] outline-none placeholder:text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
            />
          )}

          <div className="max-h-[50vh] overflow-auto sm:max-h-72">
            {options.length === 0 ? (
              <p className="px-2 py-3 text-center text-[12px] text-muted-foreground">Nothing here matches.</p>
            ) : (
              options.map((option) => {
                const on = picked.includes(option.value);
                const swatch = spec.swatch?.(option.value);
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    onClick={() => onToggle(spec.key, option.value)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-[13px] transition-colors duration-150 outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "flex size-4 shrink-0 items-center justify-center rounded border transition-colors duration-150",
                        on && "border-primary bg-primary text-primary-foreground",
                      )}
                    >
                      {on && <Check className="size-3" />}
                    </span>
                    {swatch && <span aria-hidden className="size-3 shrink-0 rounded-full border" style={{ background: swatch }} />}
                    <span className="truncate">{spec.format(option.value)}</span>
                    <span className="ml-auto shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
                      {option.count.toLocaleString("en-US")}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The filter bar before the data arrives (SEC-21).
 *
 * Deliberately the same markup and the same labels as the real bar, not a row
 * of grey pills: identical text means identical widths, which means the chips
 * wrap onto the same number of rows and nothing moves when the real bar
 * replaces this one. That is most of the wall's layout shift budget.
 */
export function FilterBarSkeleton() {
  return (
    <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading filters">
      <div className="flex flex-wrap items-center gap-1.5">
        {FILTERS.map((filter) => (
          <Button key={filter.key} variant="outline" size="sm" disabled className="opacity-50">
            {filter.label}
            <ChevronDown className="size-3" />
          </Button>
        ))}
        <div className="h-7 min-w-0 flex-1 basis-40 rounded-lg border bg-background dark:bg-input/30 sm:max-w-56" aria-hidden />
        <span className="ml-auto min-w-[96px] shrink-0 text-right font-mono text-[11px] tabular-nums text-muted-foreground">loading…</span>
      </div>
    </div>
  );
}
