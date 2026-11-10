"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Check, Lock, Search, SlidersHorizontal, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { BAR_FILTERS, countSelected, type FilterKey, type FilterSpec, type Selected } from "@/lib/filters";
import { useAccess } from "@/lib/account";

/** The filters Free and signed-out viewers keep (the API drops the rest; server/plans.ts). Same set as the old bar. */
const FREE_FILTERS: ReadonlySet<FilterKey> = new Set<FilterKey>(["host", "block", "vp"]);

/** How many options a group shows before "Show more". */
const FOLDED = 6;

type Facets = Record<string, { value: string; count: number }[]>;

const PILL =
  "inline-flex h-9 shrink-0 items-center gap-2 rounded-full border border-foreground/80 bg-card px-4 text-[13px] font-medium outline-none transition-colors duration-150 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring touch:h-11";
const SEARCH =
  "h-9 w-full rounded-full border bg-background pr-3 pl-8 text-[13px] outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring dark:bg-input/30 touch:h-11";

/**
 * The wall's filters, laid out the way Etsy does search filters: one
 * "All filters" pill opens a side panel with every group stacked as a plain
 * checkbox list, and what is picked shows as removable chips under the bar.
 *
 * Ticking applies at once (the URL changes and the wall reloads behind the
 * panel), so the footer button always shows the live count. It only closes the
 * panel. Counts come from the facets, computed ignoring their own dimension, so
 * ticking one platform still shows what the others would add.
 *
 * Replaces the chip row in filter-bar.tsx on the wall; that component is kept.
 */
export function FilterDrawer({
  facets,
  selected,
  search,
  total,
  ready,
  busy,
  onToggle,
  onClearAll,
  onSearch,
}: {
  facets: Facets;
  selected: Selected;
  search: string;
  total: number;
  ready: boolean;
  /** A new count is on its way. */
  busy?: boolean;
  onToggle: (key: FilterKey, value: string) => void;
  onClearAll: () => void;
  onSearch: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const closer = useRef<HTMLButtonElement>(null);

  // The viewport has its own switch and stays put through "Clear all", so it is not counted here.
  const picked = countSelected({ ...selected, vp: undefined });
  const activeCount = picked + (search.trim() ? 1 : 0);

  // Escape closes, the page behind stops scrolling, and focus goes in and back out.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown);
    closer.current?.focus();
    const back = trigger.current;
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", onKeyDown);
      back?.focus();
    };
  }, [open]);

  const chips = BAR_FILTERS.flatMap((spec) => (selected[spec.key] ?? []).map((value) => ({ spec, value })));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button ref={trigger} type="button" className={PILL} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
          <SlidersHorizontal className="size-4" aria-hidden />
          All filters
          {picked > 0 && (
            <span className="-mr-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 font-mono text-[11px] tabular-nums text-primary-foreground">
              {picked}
            </span>
          )}
        </button>

        <label className="relative min-w-0 flex-1 basis-48 sm:max-w-72">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            type="search"
            value={search}
            placeholder="Search headline or copy…"
            aria-label="Search"
            onChange={(e) => onSearch(e.target.value)}
            className={SEARCH}
          />
        </label>

        {/* Fixed width so "loading…" and "30,000 blocks" don't nudge the row on arrival. */}
        <span className="ml-auto min-w-[96px] shrink-0 text-right text-[12px] tabular-nums text-muted-foreground" aria-live="polite">
          {ready ? `${total.toLocaleString("en-US")} results` : "loading…"}
        </span>
      </div>

      {activeCount > 0 && (
        <ul className="flex flex-wrap items-center gap-2" aria-label="Active filters">
          {search.trim() && (
            <li>
              <Chip label={`“${search.trim()}”`} onRemove={() => onSearch("")} />
            </li>
          )}
          {chips.map(({ spec, value }) => (
            <li key={`${spec.key}:${value}`}>
              <Chip label={chipLabel(spec, value)} swatch={spec.swatch?.(value)} onRemove={() => onToggle(spec.key, value)} />
            </li>
          ))}
          <li>
            <button
              type="button"
              onClick={onClearAll}
              className="rounded-full px-2 py-1 text-[13px] font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
            >
              Clear all
            </button>
          </li>
        </ul>
      )}

      {/* Always mounted, so it slides both ways; inert while closed. */}
      <div className={cn("fixed inset-0 z-50", !open && "pointer-events-none")} inert={!open}>
        <div
          aria-hidden
          onClick={() => setOpen(false)}
          className={cn("absolute inset-0 bg-black/55 transition-opacity duration-200", open ? "opacity-100" : "opacity-0")}
        />
        <button
          type="button"
          aria-label="Close filters"
          tabIndex={-1}
          onClick={() => setOpen(false)}
          className={cn(
            "absolute top-5 left-[min(440px,100vw)] hidden size-10 items-center justify-center rounded-full text-white transition-opacity duration-200 hover:bg-white/10 sm:flex",
            open ? "opacity-100" : "opacity-0",
          )}
        >
          <X className="size-6" />
        </button>

        <aside
          role="dialog"
          aria-modal="true"
          aria-labelledby="filters-title"
          className={cn(
            "absolute inset-y-0 left-0 flex w-full max-w-[420px] flex-col bg-popover text-popover-foreground shadow-2xl transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]",
            open ? "translate-x-0" : "-translate-x-full",
          )}
        >
          <header className="flex items-center justify-between gap-3 px-6 pt-6 pb-4">
            <h2 id="filters-title" className="font-heading text-[26px] font-semibold tracking-tight">
              Filters
            </h2>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={onClearAll}
                disabled={activeCount === 0}
                className="h-10 rounded-full bg-muted px-5 text-[14px] font-medium outline-none transition-colors duration-150 hover:bg-foreground/10 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              >
                Reset
              </button>
              <button
                ref={closer}
                type="button"
                aria-label="Close filters"
                onClick={() => setOpen(false)}
                className="flex size-10 items-center justify-center rounded-full outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring sm:hidden"
              >
                <X className="size-5" />
              </button>
            </div>
          </header>

          <div className="flex-1 overflow-y-auto overscroll-contain px-6 pb-6">
            {BAR_FILTERS.map((spec) => (
              <Group key={spec.key} spec={spec} options={facets[spec.key] ?? []} picked={selected[spec.key] ?? []} onToggle={onToggle} />
            ))}
          </div>

          <footer className="border-t px-4 py-4">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="h-12 w-full rounded-full bg-foreground text-[15px] font-semibold text-background outline-none transition-opacity duration-150 hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              {ready && !busy ? `Show results (${total.toLocaleString("en-US")} blocks)` : "Show results…"}
            </button>
          </footer>
        </aside>
      </div>
    </div>
  );
}

/** One filter group in the panel: a heading and a checkbox list, folded after six. */
function Group({
  spec,
  options,
  picked,
  onToggle,
}: {
  spec: FilterSpec;
  options: { value: string; count: number }[];
  picked: string[];
  onToggle: (key: FilterKey, value: string) => void;
}) {
  const access = useAccess();
  const locked = !FREE_FILTERS.has(spec.key) && !access.can("filters");
  const [expanded, setExpanded] = useState(false);
  const [needle, setNeedle] = useState("");

  const ordered = useMemo(() => {
    const rank = spec.order;
    if (rank) return [...options].sort((a, b) => rank.indexOf(a.value) - rank.indexOf(b.value));
    if (spec.byCount) return options;
    return [...options].sort((a, b) => spec.format(a.value).localeCompare(spec.format(b.value)));
  }, [spec, options]);

  const trimmed = needle.trim().toLowerCase();
  const matching = trimmed
    ? ordered.filter((o) => spec.format(o.value).toLowerCase().includes(trimmed) || o.value.toLowerCase().includes(trimmed))
    : ordered;

  // Folded: the first few plus anything ticked further down, so a ticked box never hides.
  const shown =
    expanded || trimmed
      ? matching
      : [...matching.slice(0, FOLDED), ...matching.slice(FOLDED).filter((o) => picked.includes(o.value))];
  const hidden = matching.length - shown.length;
  const long = expanded && !trimmed && matching.length > 40;

  if (!options.length && !locked) return null;

  return (
    <fieldset className="border-b py-5 last:border-b-0">
      <legend className="float-left mb-3 flex w-full items-center gap-1.5 text-[15px] font-semibold">
        {spec.label}
        {locked && <Lock aria-label="Pro" className="size-3.5 text-muted-foreground" />}
        {picked.length > 0 && <span className="ml-auto text-[12px] font-normal text-muted-foreground">{picked.length} selected</span>}
      </legend>

      {locked ? (
        <p className="clear-left text-[13px] text-muted-foreground">
          Comes with Pro.{" "}
          <Link href={access.signedIn ? "/account" : "/account?next=/"} className="font-medium text-link underline-offset-4 hover:underline">
            {access.signedIn ? "See plans" : "Start free trial"}
          </Link>
        </p>
      ) : (
        <div className="clear-left">
          {spec.searchable && options.length > FOLDED * 2 && (
            <label className="relative mb-2 block">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <input
                type="search"
                value={needle}
                placeholder={`Find a ${spec.label.toLowerCase()}…`}
                aria-label={`Find a ${spec.label.toLowerCase()}`}
                onChange={(e) => setNeedle(e.target.value)}
                className="h-9 w-full rounded-lg border bg-background pr-3 pl-8 text-[13px] outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring dark:bg-input/30 touch:h-11"
              />
            </label>
          )}

          {shown.length === 0 ? (
            <p className="py-1 text-[13px] text-muted-foreground">Nothing here matches.</p>
          ) : (
            <ul className={cn("flex flex-col", long && "max-h-80 overflow-y-auto overscroll-contain")}>
              {shown.map((option) => (
                <li key={option.value}>
                  <Option
                    label={spec.format(option.value)}
                    count={option.count}
                    swatch={spec.swatch?.(option.value)}
                    on={picked.includes(option.value)}
                    onClick={() => onToggle(spec.key, option.value)}
                  />
                </li>
              ))}
            </ul>
          )}

          {!trimmed && (hidden > 0 || expanded) && matching.length > FOLDED && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="mt-1.5 text-[13px] font-medium underline underline-offset-4 outline-none hover:text-foreground/80 focus-visible:ring-2 focus-visible:ring-ring"
            >
              {expanded ? "Show less" : `Show ${hidden.toLocaleString("en-US")} more`}
            </button>
          )}
        </div>
      )}
    </fieldset>
  );
}

function Option({ label, count, swatch, on, onClick }: { label: string; count: number; swatch?: string; on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      onClick={onClick}
      className="group flex w-full items-center gap-3 rounded-md py-1.5 text-left text-[14px] outline-none focus-visible:ring-2 focus-visible:ring-ring touch:min-h-11"
    >
      <span
        aria-hidden
        className={cn(
          "flex size-5 shrink-0 items-center justify-center rounded-[4px] border-[1.5px] border-foreground/60 transition-colors duration-150 group-hover:border-foreground",
          on && "border-foreground bg-foreground text-background",
        )}
      >
        {on && <Check className="size-3.5" strokeWidth={3} />}
      </span>
      {swatch && <span aria-hidden className="size-4 shrink-0 rounded-full border" style={{ background: swatch }} />}
      <span className="min-w-0 truncate">{label}</span>
      <span className="ml-auto shrink-0 text-[12px] tabular-nums text-muted-foreground">{count.toLocaleString("en-US")}</span>
    </button>
  );
}

function Chip({ label, swatch, onRemove }: { label: string; swatch?: string; onRemove: () => void }) {
  return (
    <button
      type="button"
      onClick={onRemove}
      aria-label={`Remove ${label}`}
      className="inline-flex h-9 max-w-64 items-center gap-2 rounded-full bg-muted pr-3 pl-4 text-[13px] font-medium outline-none transition-colors duration-150 hover:bg-foreground/10 focus-visible:ring-2 focus-visible:ring-ring touch:h-11"
    >
      {swatch && <span aria-hidden className="size-3 shrink-0 rounded-full border" style={{ background: swatch }} />}
      <span className="truncate">{label}</span>
      <X className="size-4 shrink-0" aria-hidden />
    </button>
  );
}

/** What a removable chip says. Bare values that read badly alone get their group name. */
function chipLabel(spec: FilterSpec, value: string): string {
  const text = spec.format(value);
  if (spec.key === "color") return `${text} colour`;
  if (spec.key === "page") return `${text} page`;
  return text;
}

/** The bar before the data arrives: same pill, search and count, so nothing moves when it swaps in. */
export function FilterDrawerSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading filters">
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn(PILL, "opacity-50")}>
          <SlidersHorizontal className="size-4" aria-hidden />
          All filters
        </span>
        <div className="min-w-0 flex-1 basis-48 sm:max-w-72">
          <div className={SEARCH} aria-hidden />
        </div>
        <span className="ml-auto min-w-[96px] shrink-0 text-right text-[12px] tabular-nums text-muted-foreground">loading…</span>
      </div>
    </div>
  );
}
