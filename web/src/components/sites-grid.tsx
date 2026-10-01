"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StoreIcon } from "@/components/store-icon";
import { Stack } from "@/components/site-profile";
import { cn } from "@/lib/utils";
import { loadCovers, loadSitesDirectory } from "@/lib/load-blocks";
import { type SiteCard } from "@/lib/site-profile";
import { labelFor } from "@/lib/blocks";
import { industryLabel, platformLabel } from "@/lib/stores";

type Sort = "captured" | "traffic" | "az";

const SORTS: { key: Sort; label: string }[] = [
  { key: "captured", label: "Most captured" },
  { key: "traffic", label: "Top traffic" },
  { key: "az", label: "A–Z" },
];

/** Cards rendered per step; more join as the end of the grid scrolls into view. */
const STEP = 48;

/** The cover frame: a desktop screen and a bit, like a browser window. */
const COVER_RATIO = 10 / 16;

/**
 * The Sites directory (SEC-19), laid out the way Mobbin lays out sites: a
 * directory of links up top, sort tabs, then a grid of big visual cards, each
 * one a store's home page with its name beneath. Every control lives in the
 * URL, so any view is a link.
 */
export function SitesGrid() {
  const [cards, setCards] = useState<SiteCard[] | null>(null);
  const [blockTypes, setBlockTypes] = useState<{ value: string; count: number }[]>([]);
  const [error, setError] = useState<string | null>(null);

  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const industry = params.get("industry") ?? "";
  const platform = params.get("platform") ?? "";
  const country = params.get("country") ?? "";
  const q = params.get("q") ?? "";
  const sort = (SORTS.find((s) => s.key === params.get("sort"))?.key ?? "captured") as Sort;
  const [filtersOpen, setFiltersOpen] = useState(Boolean(country || q));

  useEffect(() => {
    let alive = true;
    loadSitesDirectory().then(
      (directory) => {
        if (!alive) return;
        setCards(directory.cards);
        setBlockTypes(directory.blockTypes);
      },
      (e: Error) => alive && setError(e.message),
    );
    return () => {
      alive = false;
    };
  }, []);

  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    router.replace(next.size ? `${pathname}?${next}` : pathname, { scroll: false });
  };

  const all = useMemo(() => cards ?? [], [cards]);

  // Industry only counts for listed stores: a captured-only store's "other" is
  // a placeholder, not a classification.
  const industries = useMemo(() => facet(all, (c) => (c.listed ? c.store.industry : null)), [all]);
  // By label: "squarespace" and "squarespace-commerce" both read Squarespace,
  // and two identical entries in the directory would look like a bug.
  const platforms = useMemo(() => facet(all, (c) => (c.store.platform ? platformLabel(c.store.platform) : null)), [all]);
  const countries = useMemo(() => facet(all, (c) => c.store.country), [all]);

  const needle = q.trim().toLowerCase();
  const shown = useMemo(() => {
    const list = all.filter(
      (c) =>
        (!industry || (c.listed && c.store.industry === industry)) &&
        (!platform || (c.store.platform !== null && platformLabel(c.store.platform) === platform)) &&
        (!country || c.store.country === country) &&
        (!needle ||
          c.store.brand.toLowerCase().includes(needle) ||
          c.store.host.includes(needle) ||
          (c.store.theme ?? "").toLowerCase().includes(needle) ||
          c.store.apps.some((a) => a.toLowerCase().includes(needle))),
    );
    const rank = (c: SiteCard) => c.store.rank ?? Number.POSITIVE_INFINITY;
    return list.sort((a, b) => {
      if (sort === "az") return a.store.brand.localeCompare(b.store.brand);
      if (sort === "traffic") return rank(a) - rank(b) || a.store.brand.localeCompare(b.store.brand);
      return b.blockCount - a.blockCount || rank(a) - rank(b) || a.store.brand.localeCompare(b.store.brand);
    });
  }, [all, industry, platform, country, needle, sort]);

  // Grow the grid as its end comes into view. Reset when the list changes.
  const listKey = `${industry}|${platform}|${country}|${needle}|${sort}`;
  const [limit, setLimit] = useState({ key: listKey, n: STEP });
  const n = limit.key === listKey ? limit.n : STEP;
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setLimit({ key: listKey, n: n + STEP });
      },
      { rootMargin: "1200px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [listKey, n, shown.length]);

  // On the API path cards arrive without covers (see loadSitesDirectory); fetch
  // them for the cards on screen, one query per batch. A no-op on the sample
  // path, where every captured store already has its cover.
  const requested = useRef(new Set<string>());
  useEffect(() => {
    const batch = shown
      .slice(0, n)
      .filter((c) => c.blockCount > 0 && !c.cover && !requested.current.has(c.store.host))
      .map((c) => c.store);
    if (batch.length === 0) return;
    for (const store of batch) requested.current.add(store.host);
    loadCovers(batch).then(
      (covers) =>
        setCards((prev) => prev && prev.map((c) => (covers.get(c.store.host)?.cover ? { ...c, cover: covers.get(c.store.host)!.cover } : c))),
      // Let the next render ask again.
      () => batch.forEach((store) => requested.current.delete(store.host)),
    );
  }, [shown, n]);

  const active = Boolean(industry || platform || country || q);

  return (
    <div className="flex flex-col gap-6">
      <Directory
        groups={[
          { title: "Industries", options: industries.map((o) => ({ ...o, label: industryLabel(o.value) })), key: "industry", selected: industry },
          { title: "Platforms", options: platforms.slice(0, 10).map((o) => ({ ...o, label: o.value })), key: "platform", selected: platform },
        ]}
        blocks={blockTypes.slice(0, 10)}
        ready={Boolean(cards)}
        onPick={(key, value, selected) => set(key, value === selected ? "" : value)}
      />

      <div className="sticky top-12 z-10 -mx-3 flex flex-col gap-2 border-b bg-background/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:-mx-4 sm:px-4">
        <div className="flex items-center gap-4">
          <nav aria-label="Sort" className="flex gap-4">
            {SORTS.map((s) => (
              <button
                key={s.key}
                type="button"
                aria-pressed={sort === s.key}
                onClick={() => set("sort", s.key === "captured" ? "" : s.key)}
                className={cn(
                  "-mb-px shrink-0 border-b-2 py-3 text-[13px] font-medium whitespace-nowrap transition-colors duration-150 outline-none focus-visible:text-foreground",
                  sort === s.key ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {s.label}
              </button>
            ))}
          </nav>
          <span className="ml-auto hidden font-mono text-[11px] text-muted-foreground tabular-nums sm:inline" aria-live="polite">
            {cards ? `${shown.length.toLocaleString("en-US")} of ${all.length.toLocaleString("en-US")}` : "loading…"}
          </span>
          <Button
            variant="ghost"
            size="sm"
            aria-expanded={filtersOpen}
            onClick={() => setFiltersOpen((v) => !v)}
            className={cn("ml-auto shrink-0 sm:ml-0", filtersOpen && "text-foreground")}
          >
            <SlidersHorizontal />
            Filter
          </Button>
        </div>
        {(filtersOpen || active) && (
          <div className="flex flex-wrap items-center gap-2 pb-3">
            <label className="relative flex min-w-0 flex-1 basis-56 items-center sm:max-w-80">
              <Search className="pointer-events-none absolute left-2.5 size-3.5 text-muted-foreground" />
              <input
                type="search"
                placeholder="Brand, domain, theme or app…"
                aria-label="Search stores"
                defaultValue={q}
                onChange={(e) => set("q", e.target.value)}
                className="h-8 w-full rounded-lg border bg-background pr-2.5 pl-8 text-[13px] outline-none placeholder:text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
              />
            </label>
            <select
              aria-label="Country"
              value={country}
              onChange={(e) => set("country", e.target.value)}
              className="h-8 rounded-lg border bg-background px-2 text-[13px] outline-none focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
            >
              <option value="">All countries</option>
              {countries.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.value} ({c.count})
                </option>
              ))}
            </select>
            {[
              industry && { key: "industry", label: industryLabel(industry) },
              platform && { key: "platform", label: platform },
            ]
              .filter((c): c is { key: string; label: string } => Boolean(c))
              .map((chip) => (
                <Button key={chip.key} variant="outline" size="sm" active onClick={() => set(chip.key, "")} aria-label={`Remove ${chip.label}`}>
                  {chip.label}
                  <X className="size-3" />
                </Button>
              ))}
            {active && (
              <Button variant="ghost" size="sm" onClick={() => router.replace(pathname, { scroll: false })}>
                Clear all
              </Button>
            )}
          </div>
        )}
      </div>

      {error ? (
        <Empty>The store list could not be loaded ({error}).</Empty>
      ) : !cards ? (
        <GridSkeleton />
      ) : shown.length === 0 ? (
        <Empty>
          <p className="text-foreground">No store matches.</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => router.replace(pathname, { scroll: false })}>
            Clear all
          </Button>
        </Empty>
      ) : (
        <>
          <ul className="grid grid-cols-1 gap-x-5 gap-y-7 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {shown.slice(0, n).map((card) => (
              <li key={card.store.host}>
                <SiteCardView card={card} />
              </li>
            ))}
          </ul>
          {n < shown.length && <div ref={sentinel} aria-hidden className="h-px" />}
        </>
      )}
    </div>
  );
}

/** How many cards carry each value, commonest first. */
function facet(cards: SiteCard[], pick: (c: SiteCard) => string | null) {
  const m = new Map<string, number>();
  for (const c of cards) {
    const v = pick(c);
    if (v) m.set(v, (m.get(v) ?? 0) + 1);
  }
  return [...m].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count);
}

type Group = { title: string; key: string; selected: string; options: { value: string; label: string; count: number }[] };

/**
 * Mobbin's directory, in Sectionary terms: what a store is (industry), what it
 * runs on (platform), and what has been cut from it (blocks, which go to the
 * wall). Big type on wide screens; a row of chips per group on phones.
 */
function Directory({
  groups,
  blocks,
  ready,
  onPick,
}: {
  groups: Group[];
  blocks: { value: string; count: number }[];
  ready: boolean;
  onPick: (key: string, value: string, selected: string) => void;
}) {
  const link =
    "group inline-flex items-baseline gap-1.5 whitespace-nowrap outline-none transition-colors duration-150 focus-visible:text-primary " +
    // Phones: chips. From md: big directory type.
    "max-md:h-8 max-md:items-center max-md:rounded-full max-md:border max-md:px-3 max-md:text-[13px] " +
    "md:font-heading md:text-[18px] md:leading-[1.35] md:font-semibold md:tracking-[-0.01em]";
  const count = "font-mono text-[11px] font-normal tabular-nums text-muted-foreground max-md:hidden";

  return (
    <div className="flex flex-col gap-5 md:flex-row md:flex-wrap md:gap-x-14 md:gap-y-6" aria-busy={!ready}>
      {groups.map((group) => (
        <section key={group.title} className="min-w-0">
          <h2 className="mb-2 text-[12px] text-muted-foreground">{group.title}</h2>
          <ul className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] md:grid md:grid-flow-col md:grid-rows-5 md:gap-x-10 md:gap-y-0 md:overflow-visible md:pb-0">
            {group.options.map((o) => {
              const on = group.selected === o.value;
              return (
                <li key={o.value} className="shrink-0">
                  <button
                    type="button"
                    aria-pressed={on}
                    onClick={() => onPick(group.key, o.value, group.selected)}
                    className={cn(link, on ? "text-primary max-md:border-primary" : "text-foreground hover:text-primary")}
                  >
                    {o.label}
                    <span className={count}>{o.count.toLocaleString("en-US")}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {blocks.length > 0 && (
        <section className="min-w-0">
          <h2 className="mb-2 text-[12px] text-muted-foreground">Blocks</h2>
          <ul className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] md:grid md:grid-flow-col md:grid-rows-5 md:gap-x-10 md:gap-y-0 md:overflow-visible md:pb-0">
            {blocks.map((b) => (
              <li key={b.value} className="shrink-0">
                <Link href={`/?block=${encodeURIComponent(b.value)}`} className={cn(link, "text-foreground hover:text-primary")}>
                  {labelFor(b.value)}
                  <span className={count}>{b.count.toLocaleString("en-US")}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** One store: its home page in a big rounded tile, its name beneath. */
function SiteCardView({ card }: { card: SiteCard }) {
  const { store, cover } = card;
  const facts = [platformLabel(store.platform), card.listed ? industryLabel(store.industry) : null].filter(Boolean).join(" · ");
  return (
    <Link
      href={`/sites/${encodeURIComponent(store.host)}`}
      className="group block rounded-2xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      aria-label={`${store.brand}, ${facts}`}
    >
      <div className="relative overflow-hidden rounded-2xl border bg-card p-[8%] transition-colors duration-150 group-hover:border-primary/60">
        {cover ? (
          <>
            <span className="absolute top-3 left-3 z-10 rounded-full bg-background/80 px-2 py-0.5 font-mono text-[10px] font-medium text-foreground tabular-nums backdrop-blur">
              {card.blockCount.toLocaleString("en-US")} blocks
            </span>
            <div
              className="relative overflow-hidden rounded-md shadow-[0_8px_30px_-8px_rgb(0_0_0/0.5)] transition-transform duration-300 ease-out group-hover:-translate-y-0.5"
              style={{ aspectRatio: `1 / ${COVER_RATIO}` }}
            >
              <Stack src={null} blocks={cover.desktop} ratio={COVER_RATIO} />
            </div>
            {cover.mobile.length > 0 && (
              <div
                className="absolute right-[5%] bottom-[6%] w-[17%] overflow-hidden rounded-md border-2 border-card shadow-[0_8px_24px_-6px_rgb(0_0_0/0.6)]"
                style={{ aspectRatio: "9 / 19" }}
              >
                <Stack src={null} blocks={cover.mobile} ratio={19 / 9} />
              </div>
            )}
          </>
        ) : card.blockCount > 0 ? (
          // Captured, cover still on its way from the API.
          <div className="shimmer rounded-md bg-muted" style={{ aspectRatio: `1 / ${COVER_RATIO}` }} aria-hidden />
        ) : (
          // Nothing captured: the store's mark, quietly, in the same frame.
          <div className="flex flex-col items-center justify-center gap-2" style={{ aspectRatio: `1 / ${COVER_RATIO}` }}>
            <StoreIcon host={store.host} brand={store.brand} size={48} className="rounded-xl" />
            <span className="text-[11px] text-muted-foreground">Not captured yet</span>
          </div>
        )}
      </div>
      <div className="mt-3 flex items-center gap-3 px-0.5">
        <StoreIcon host={store.host} brand={store.brand} size={36} className="rounded-[10px]" />
        <div className="min-w-0">
          <p className="truncate text-[14px] font-semibold group-hover:text-primary">{store.brand}</p>
          <p className="truncate text-[12px] text-muted-foreground">{facts || store.host}</p>
        </div>
      </div>
    </Link>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl border border-dashed p-8 text-center text-muted-foreground">{children}</div>;
}

/** The directory and grid with nothing in them, so nothing jumps when data arrives. */
export function SitesGridSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-label="Loading stores">
      <div className="hidden gap-14 md:flex">
        {[3, 2, 2].map((cols, g) => (
          <div key={g} className="flex flex-col gap-2">
            <div className="shimmer h-3 w-16 rounded bg-muted" />
            <div className="flex gap-10">
              {Array.from({ length: cols }, (_, c) => (
                <div key={c} className="flex flex-col gap-2.5 py-1">
                  {Array.from({ length: 5 }, (_, r) => (
                    <div key={r} className="shimmer h-4 w-28 rounded bg-muted" />
                  ))}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="h-11 border-b" />
      <GridSkeleton />
    </div>
  );
}

function GridSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-x-5 gap-y-7 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4" aria-hidden>
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i}>
          <div className="shimmer rounded-2xl bg-muted" style={{ aspectRatio: `1 / ${COVER_RATIO * 1.2}` }} />
          <div className="mt-3 flex items-center gap-3">
            <div className="shimmer size-9 rounded-[10px] bg-muted" />
            <div className="flex flex-col gap-1.5">
              <div className="shimmer h-3 w-28 rounded bg-muted" />
              <div className="shimmer h-3 w-40 rounded bg-muted" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
