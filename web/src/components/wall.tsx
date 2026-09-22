"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { BlockCard, BlockCardSkeleton } from "@/components/block-card";
import { BlockDialog } from "@/components/block-dialog";
import { TechFilters } from "@/components/tech-filters";
import { BLOCKS_SRC } from "@/lib/data-source";
import { labelFor, PAGE_TYPE_LABEL, type Block, type BlockSet } from "@/lib/blocks";
import { blockHas, countTech, techFromFacets, type Facets, type TechKey } from "@/lib/tech";

const SKELETON_RATIOS = [0.55, 1.4, 0.8, 1.9, 0.7, 1.1, 0.5, 1.6, 0.9, 1.3, 0.6, 1.2];

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

// Same names as BlocksQuery, so a wall URL maps straight onto /api/blocks.
type Filters = { page: string; block: string; vp: string; q: string; platform: string; theme: string; app: string };
const KEYS: (keyof Filters)[] = ["page", "block", "vp", "q", "platform", "theme", "app"];

function readFilters(sp: URLSearchParams): Filters {
  return Object.fromEntries(KEYS.map((k) => [k, sp.get(k) ?? ""])) as Filters;
}

export function Wall({ src = BLOCKS_SRC }: { src?: string }) {
  const [data, setData] = useState<(BlockSet & { facets?: Facets }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Block | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const filters = useMemo(() => readFilters(new URLSearchParams(sp.toString())), [sp]);

  useEffect(() => {
    let alive = true;
    fetch(src)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j: BlockSet) => alive && setData(j))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [src]);

  // Filters live in the URL so any view can be shared by link.
  const setFilter = useCallback(
    (key: keyof Filters, value: string) => {
      const next = new URLSearchParams(sp.toString());
      if (value) next.set(key, value);
      else next.delete(key);
      router.replace(next.size ? `${pathname}?${next}` : pathname, { scroll: false });
    },
    [sp, router, pathname],
  );
  const clear = () => router.replace(pathname, { scroll: false });

  const blocks = useMemo(() => data?.blocks ?? [], [data]);
  const pageTypes = useMemo(() => [...new Set(blocks.map((b) => b.pageType))], [blocks]);
  const blockTypes = useMemo(() => [...new Set(blocks.map((b) => b.typeHint))].sort(), [blocks]);
  const q = filters.q.trim().toLowerCase();
  const matches = useCallback(
    (b: Block, skip?: TechKey) =>
      (!filters.page || b.pageType === filters.page) &&
      (!filters.block || b.typeHint === filters.block) &&
      (!filters.vp || b.viewport === filters.vp) &&
      (skip === "platform" || !filters.platform || blockHas(b, "platform", filters.platform)) &&
      (skip === "theme" || !filters.theme || blockHas(b, "theme", filters.theme)) &&
      (skip === "app" || !filters.app || blockHas(b, "app", filters.app)) &&
      (!q || (b.headline ?? "").toLowerCase().includes(q) || b.text.toLowerCase().includes(q) || b.typeHint.includes(q)),
    [filters, q],
  );
  const shown = blocks.filter((b) => matches(b));
  const active = KEYS.some((k) => filters[k]);
  // Each facet counts what it would show under the other filters.
  const techCounts = useMemo(
    () => ({
      platform: countTech(blocks.filter((b) => matches(b, "platform"))).platform,
      theme: countTech(blocks.filter((b) => matches(b, "theme"))).theme,
      app: countTech(blocks.filter((b) => matches(b, "app"))).app,
    }),
    [blocks, matches],
  );
  // The detail view shows library-wide counts: the API's facets when it sends them.
  const libraryCounts = useMemo(() => techFromFacets(data?.facets) ?? countTech(blocks), [data, blocks]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1" role="group" aria-label="Page type">
          <Button variant="outline" size="sm" active={!filters.page} onClick={() => setFilter("page", "")}>
            All pages
          </Button>
          {pageTypes.map((p) => (
            <Button key={p} variant="outline" size="sm" active={filters.page === p} onClick={() => setFilter("page", p)}>
              {PAGE_TYPE_LABEL[p] ?? p}
            </Button>
          ))}
        </div>
        <select
          aria-label="Block type"
          value={filters.block}
          onChange={(e) => setFilter("block", e.target.value)}
          className="h-7 rounded-lg border bg-background px-2 text-[12px] outline-none focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
        >
          <option value="">All block types</option>
          {blockTypes.map((t) => (
            <option key={t} value={t}>
              {labelFor(t)}
            </option>
          ))}
        </select>
        <div className="flex gap-1" role="group" aria-label="Viewport">
          {[
            ["", "Both"],
            ["desktop", "Desktop"],
            ["mobile", "Mobile"],
          ].map(([v, l]) => (
            <Button key={v} variant="outline" size="sm" active={filters.vp === v} onClick={() => setFilter("vp", v)}>
              {l}
            </Button>
          ))}
        </div>
        <input
          type="search"
          placeholder="Search headline or copy…"
          aria-label="Search"
          defaultValue={filters.q}
          onChange={(e) => setFilter("q", e.target.value)}
          className="h-7 min-w-0 flex-1 basis-40 rounded-lg border bg-background px-2.5 text-[12px] outline-none placeholder:text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30 sm:max-w-64"
        />
        <span className="ml-auto font-mono text-[11px] tabular-nums text-muted-foreground" aria-live="polite">
          {data ? `${shown.length} of ${blocks.length} blocks` : "loading…"}
        </span>
      </div>

      {data && blocks.length > 0 && (
        <TechFilters counts={techCounts} value={{ platform: filters.platform, theme: filters.theme, app: filters.app }} onChange={setFilter} />
      )}

      {error ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
          <p>The block set could not be loaded ({error}).</p>
          <p className="mt-1 text-[12px]">Run the capture and export scripts, then reload.</p>
        </div>
      ) : !data ? (
        <WallSkeleton />
      ) : shown.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
          <p>Nothing matches these filters.</p>
          {active && (
            <Button variant="outline" size="sm" className="mt-3" onClick={clear}>
              Clear filters
            </Button>
          )}
        </div>
      ) : (
        <div className="wall">
          {shown.map((b) => (
            <BlockCard key={b.id} block={b} onOpen={setOpen} />
          ))}
        </div>
      )}

      <BlockDialog
        block={open}
        onClose={() => setOpen(null)}
        counts={libraryCounts}
        onFilter={(key, value) => {
          setOpen(null);
          setFilter(key, value);
        }}
      />
    </div>
  );
}
