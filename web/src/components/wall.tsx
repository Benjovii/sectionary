"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { BlockCard, BlockCardSkeleton } from "@/components/block-card";
import { BlockDialog } from "@/components/block-dialog";
import { FilterBar, FilterBarSkeleton } from "@/components/filter-bar";
import { TechFilters } from "@/components/tech-filters";
import { techFromFacets } from "@/lib/tech";
import { wallSource } from "@/lib/load-blocks";
import { clearReturn, returnsFor } from "@/lib/return-to";
import { type WallQuery, type WallResponse } from "@/lib/block-source";
import { type DetailIndex } from "@/lib/block-detail";
import { layOut, visible, GAP, type Layout } from "@/lib/wall-layout";
import { FILTERS, readSelected, writeSelected, toggleValue, toQuery, countSelected, SEARCH_KEY, type FilterKey } from "@/lib/filters";
import { type Block } from "@/lib/blocks";

const SKELETON_RATIOS = [0.55, 1.4, 0.8, 1.9, 0.7, 1.1, 0.5, 1.6, 0.9, 1.3, 0.6, 1.2];

/** How many blocks a page of the wall asks for. The contract caps it at 200. */
const PAGE_SIZE = 200;

/** Rendered beyond the viewport, top and bottom, so a fast flick stays covered. */
const OVERSCAN = 800;

/**
 * Space held open below the loaded blocks while the next page is on its way.
 * A fixed number, so the wall's height is still deterministic. The next page is
 * requested two viewports before the end, so this strip is always off-screen
 * when it is replaced and the shift never reaches the viewport.
 */
const LOADING_STRIP = 420;

/** The URL key that holds the open block's id. Not "block": that is the block-type filter. */
const BLOCK_KEY = "open";

/**
 * Everything above the blocks plus the blocks, as placeholders. The route's
 * loading.tsx and the page's Suspense fallback both use this, so the first
 * paint has the same geometry as the real thing and nothing jumps when the
 * data arrives.
 */
export function WallFallback() {
  return (
    <div className="flex flex-col gap-3">
      <FilterBarSkeleton />
      <WallSkeleton />
    </div>
  );
}

/** Skeleton wall, exported so the route's loading.tsx shows the same shape. */
export function WallSkeleton() {
  return (
    <div className="wall" aria-busy="true" aria-label="Loading blocks">
      {SKELETON_RATIOS.map((r, i) => (
        <BlockCardSkeleton key={i} ratio={r} mobile={i % 4 === 3} />
      ))}
    </div>
  );
}

/** The sample in the browser or /api/blocks, decided at build time (lib/data-source.ts). */
const source = wallSource();

export function Wall() {
  const [error, setError] = useState<string | null>(null);

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // The URL is the filter state. Nothing else holds it, so every view is a link.
  const params = useMemo(() => new URLSearchParams(searchParams.toString()), [searchParams]);
  const selected = useMemo(() => readSelected(params), [params]);
  const search = params.get(SEARCH_KEY) ?? "";
  // Keyed by its JSON so a URL change that leaves the filters alone, like
  // opening a block, does not re-run the query over the whole set.
  const queryKey = useMemo(() => JSON.stringify(toQuery(selected, search)), [selected, search]);
  const query = useMemo(() => JSON.parse(queryKey) as WallQuery, [queryKey]);

  const replace = useCallback(
    (next: URLSearchParams) => router.replace(next.size ? `${pathname}?${next}` : pathname, { scroll: false }),
    [router, pathname],
  );

  const onToggle = useCallback(
    (key: FilterKey, value: string) => replace(writeSelected(params, key, toggleValue(selected[key], value))),
    [params, selected, replace],
  );

  const onSearch = useCallback(
    (value: string) => {
      const next = new URLSearchParams(params.toString());
      if (value.trim()) next.set(SEARCH_KEY, value);
      else next.delete(SEARCH_KEY);
      replace(next);
    },
    [params, replace],
  );

  const onClearAll = useCallback(() => replace(new URLSearchParams()), [replace]);

  const onClearOne = useCallback(
    (key: FilterKey) => replace(writeSelected(params, key, [])),
    [params, replace],
  );

  // The first page of the current query, tagged with its key. A filter change
  // asks for a new one and the appended pages below fall away with it. Until it
  // arrives the previous result stays up, marked busy, rather than flashing
  // skeletons: on the API a query is a round trip.
  const [result, setResult] = useState<{ key: string; response: WallResponse } | null>(null);
  const first = result?.response ?? null;
  const ready = result !== null;
  const settled = result?.key === queryKey;

  useEffect(() => {
    const controller = new AbortController();
    source.query({ ...query, limit: PAGE_SIZE }, { signal: controller.signal }).then(
      (response) => {
        setResult({ key: queryKey, response });
        setError(null);
      },
      (e: Error) => !controller.signal.aborted && setError(e.message),
    );
    return () => controller.abort();
  }, [query, queryKey]);

  // Pages fetched by scrolling, tagged with the query they belong to so a stale
  // set is ignored rather than cleared in an effect.
  const [extra, setExtra] = useState<{ key: string; items: Block[]; cursor: string | null }>({ key: "", items: [], cursor: null });
  const current = settled && extra.key === queryKey;

  const items = useMemo(
    () => (current ? [...(first?.items ?? []), ...extra.items] : (first?.items ?? [])),
    [first, extra.items, current],
  );
  const cursor = !settled ? null : current ? extra.cursor : (first?.nextCursor ?? null);
  const total = first?.total ?? 0;
  const facets = useMemo(() => first?.facets ?? {}, [first]);

  // Back to the top when the filters change. A DOM call, no state.
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [queryKey]);

  const loadMore = useCallback(() => {
    if (!cursor) return;
    source.query({ ...query, cursor, limit: PAGE_SIZE }, { facets: false }).then(
      (next) =>
        setExtra((prev) => ({
          key: queryKey,
          items: prev.key === queryKey ? [...prev.items, ...next.items] : next.items,
          cursor: next.nextCursor,
        })),
      // A failed page leaves the cursor where it was; the next scroll asks again.
      () => undefined,
    );
  }, [cursor, query, queryKey]);

  // Measure the wall's own box, and the window's scroll, separately: the box
  // changes on resize, the scroll changes constantly.
  const hostRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ width: 0, top: 0 });
  const [view, setView] = useState({ top: 0, height: 0 });

  useEffect(() => {
    const element = hostRef.current;
    if (!element) return;
    const measure = () => setBox({ width: element.clientWidth, top: element.getBoundingClientRect().top + window.scrollY });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ready, total]);

  // Refreshed every render so the scroll frame below always sees the current
  // layout and cursor without re-subscribing to the scroll event.
  const latest = useRef({ layout: null as Layout | null, cursor: null as string | null, top: 0, key: "", loadMore });

  useEffect(() => {
    let frame = 0;
    // The scroll frame runs many times before React re-renders with the next
    // cursor, so without this one flick asks for the same page dozens of times
    // and every one of those is a full pass over the set. Keyed by query as
    // well as cursor, because cursors repeat from one query to the next.
    let asked = "";
    const read = () => {
      frame = 0;
      setView({ top: window.scrollY, height: window.innerHeight });

      const { layout, cursor: at, top, key, loadMore: load } = latest.current;
      if (!layout || !at || asked === `${key}:${at}`) return;
      const seen = window.scrollY - top + window.innerHeight;
      if (seen <= layout.height - window.innerHeight * 2) return;
      asked = `${key}:${at}`;
      load();
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(read);
    };
    read();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  // Positions for everything loaded, recomputed only when the set or the width
  // changes. Heights come from the contract, so nothing is measured.
  const layout = useMemo(() => (box.width > 0 ? layOut(items, box.width) : null), [items, box.width]);

  const cards = useMemo(() => {
    if (!layout) return [];
    const top = view.top - box.top;
    return visible(layout, top - OVERSCAN, top + view.height + OVERSCAN);
  }, [layout, view, box.top]);

  // Hand the scroll frame the current values. A ref write in an effect, so the
  // subscription above never has to tear down and rebuild.
  useEffect(() => {
    latest.current = { layout, cursor, top: box.top, key: queryKey, loadMore };
  });

  // The open block lives in the URL too (`?open=<id>`), so a detail view is a
  // link. Opening from the wall pushes a history entry, so Back closes it;
  // moving between blocks inside the view replaces it, so Back still closes
  // rather than stepping through everything seen.
  const openId = params.get(BLOCK_KEY);
  // What the open block's view needs, fetched when the id changes. The wall's
  // own copy of the block is handed over when it has one, read through a ref
  // so scrolling more blocks in does not refetch.
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  });
  const [opened, setOpened] = useState<{ id: string; block: Block | null; detail: DetailIndex } | null>(null);
  useEffect(() => {
    if (!openId) return;
    let alive = true;
    source.detail(openId, itemsRef.current.find((b) => b.id === openId)).then(
      ({ block, detail }) => alive && setOpened({ id: openId, block, detail }),
      () => alive && setOpened({ id: openId, block: null, detail: { byId: new Map(), byPage: new Map(), byType: new Map(), captures: new Map() } }),
    );
    return () => {
      alive = false;
    };
  }, [openId]);
  const loadedOpen = openId && opened?.id === openId ? opened : null;
  const open = loadedOpen?.block ?? null;
  const detail = loadedOpen?.detail ?? null;
  const pushed = useRef(false);
  // Opened from a flow or a site's page viewer, in this tab: closing goes back there.
  const [returnOnClose] = useState(() => returnsFor(openId));

  const withBlock = useCallback(
    (id: string | null) => {
      const next = new URLSearchParams(params.toString());
      if (id) next.set(BLOCK_KEY, id);
      else next.delete(BLOCK_KEY);
      return next.size ? `${pathname}?${next}` : pathname;
    },
    [params, pathname],
  );

  const onOpen = useCallback(
    (block: Block) => {
      pushed.current = true;
      router.push(withBlock(block.id), { scroll: false });
    },
    [router, withBlock],
  );

  const onShow = useCallback((block: Block) => router.replace(withBlock(block.id), { scroll: false }), [router, withBlock]);

  const onCloseBlock = useCallback(() => {
    if (!openId) return;
    if (pushed.current || returnOnClose) {
      pushed.current = false;
      clearReturn();
      router.back();
    } else {
      router.replace(withBlock(null), { scroll: false });
    }
  }, [openId, returnOnClose, router, withBlock]);

  // Opened by a pasted link, then closed by Back: nothing of ours to pop.
  useEffect(() => {
    if (openId) return;
    pushed.current = false;
    clearReturn();
  }, [openId]);

  const onStep = useMemo(() => {
    const at = open ? items.findIndex((b) => b.id === open.id) : -1;
    if (at < 0) return {};
    return {
      prev: at > 0 ? () => onShow(items[at - 1]) : undefined,
      next: at < items.length - 1 ? () => onShow(items[at + 1]) : undefined,
    };
  }, [open, items, onShow]);

  // The detail view's tech chips count the whole library, not the filtered wall.
  const [libraryCounts, setLibraryCounts] = useState<ReturnType<typeof techFromFacets> | null>(null);
  useEffect(() => {
    let alive = true;
    source.query({ limit: 1 }).then(
      (r) => alive && setLibraryCounts(techFromFacets(r.facets)),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, []);

  // A tech chip in the detail view: close it and show only that platform, theme or app.
  const onFilterTech = useCallback(
    (key: FilterKey, value: string) => {
      pushed.current = false;
      const next = writeSelected(params, key, [value]);
      next.delete(BLOCK_KEY);
      replace(next);
    },
    [params, replace],
  );

  const anyFilter = countSelected(selected) > 0 || Boolean(search.trim());

  // When nothing matches, name the one filter actually responsible rather than
  // shrugging. nearMiss counts, per dimension, how many blocks a single
  // removal would reveal, so the biggest number is the most useful advice.
  const blame = useMemo(() => {
    const near = first?.nearMiss ?? {};
    let key: string | null = null;
    let count = 0;
    for (const [candidate, n] of Object.entries(near)) {
      if (n > count) {
        count = n;
        key = candidate;
      }
    }
    if (!key || count === 0) return null;
    if (key === "q") return { label: "the search", count, clear: () => onSearch("") };
    const spec = FILTERS.find((f) => f.key === key);
    if (!spec) return null;
    return { label: spec.label, count, clear: () => onClearOne(spec.key) };
  }, [first, onSearch, onClearOne]);

  return (
    <div className="flex flex-col gap-3">
      <FilterBar
        facets={facets}
        selected={selected}
        search={search}
        total={total}
        ready={ready}
        onToggle={onToggle}
        onClearAll={onClearAll}
        onSearch={onSearch}
      />

      {ready && <TechFilters facets={facets} selected={selected} onToggle={onToggle} />}

      {error ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
          <p>The block set could not be loaded ({error}).</p>
          <p className="mt-1 text-[12px]">Run the capture and export scripts, then reload.</p>
        </div>
      ) : !ready ? (
        <WallSkeleton />
      ) : total === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
          {blame ? (
            <>
              <p className="text-foreground">Nothing matches. Try removing {blame.label}.</p>
              <p className="mt-1 text-[12px]">
                That alone would show {blame.count.toLocaleString("en-US")} block{blame.count === 1 ? "" : "s"}.
              </p>
              <div className="mt-3 flex flex-wrap justify-center gap-2">
                <Button variant="outline" size="sm" onClick={blame.clear}>
                  Remove {blame.label}
                </Button>
                <Button variant="ghost" size="sm" onClick={onClearAll}>
                  Clear all
                </Button>
              </div>
            </>
          ) : (
            <>
              <p>Nothing matches these filters.</p>
              {anyFilter && (
                <Button variant="outline" size="sm" className="mt-3" onClick={onClearAll}>
                  Clear all
                </Button>
              )}
            </>
          )}
        </div>
      ) : (
        <div
          ref={hostRef}
          className="relative w-full transition-opacity duration-200"
          style={{ height: (layout?.height ?? 0) + (cursor ? GAP + LOADING_STRIP : 0), opacity: settled ? 1 : 0.55 }}
          aria-busy={!settled}
          role="list"
          aria-label={`${total.toLocaleString("en-US")} blocks`}
        >
          {cards.map((card) => (
            <div
              key={card.block.id}
              role="listitem"
              className="absolute"
              style={{
                transform: `translate(${card.x + (card.width - card.cardWidth) / 2}px, ${card.y}px)`,
                width: card.cardWidth,
                height: card.height,
              }}
            >
              <BlockCard block={card.block} onOpen={onOpen} height={card.height} />
            </div>
          ))}

          {/* Clipped: CSS columns at a fixed height spill sideways into extra
              columns, which on one-column phones widened the whole page. */}
          {cursor && layout && (
            <div
              className="wall absolute inset-x-0 overflow-hidden"
              style={{ top: layout.height + GAP, height: LOADING_STRIP }}
              aria-hidden
            >
              {SKELETON_RATIOS.slice(0, 4).map((r, i) => (
                <BlockCardSkeleton key={i} ratio={r} mobile={i % 4 === 3} />
              ))}
            </div>
          )}
        </div>
      )}

      <BlockDialog
        block={open}
        missing={Boolean(loadedOpen && !open)}
        detail={detail}
        onClose={onCloseBlock}
        onOpen={onShow}
        onStep={onStep}
        counts={libraryCounts}
        onFilter={onFilterTech}
      />
    </div>
  );
}
