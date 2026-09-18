"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { BlockCard, BlockCardSkeleton } from "@/components/block-card";
import { BlockDialog } from "@/components/block-dialog";
import { BLOCKS_SRC } from "@/lib/data-source";
import { labelFor, PAGE_TYPE_LABEL, type Block, type BlockSet } from "@/lib/blocks";

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

type Filters = { page: string; block: string; vp: string; q: string };

function readFilters(sp: URLSearchParams): Filters {
  return { page: sp.get("page") ?? "", block: sp.get("block") ?? "", vp: sp.get("vp") ?? "", q: sp.get("q") ?? "" };
}

export function Wall({ src = BLOCKS_SRC }: { src?: string }) {
  const [data, setData] = useState<BlockSet | null>(null);
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

  const blocks = data?.blocks ?? [];
  const pageTypes = useMemo(() => [...new Set(blocks.map((b) => b.pageType))], [blocks]);
  const blockTypes = useMemo(() => [...new Set(blocks.map((b) => b.typeHint))].sort(), [blocks]);
  const q = filters.q.trim().toLowerCase();
  const shown = blocks.filter(
    (b) =>
      (!filters.page || b.pageType === filters.page) &&
      (!filters.block || b.typeHint === filters.block) &&
      (!filters.vp || b.viewport === filters.vp) &&
      (!q || (b.headline ?? "").toLowerCase().includes(q) || b.text.toLowerCase().includes(q) || b.typeHint.includes(q)),
  );
  const active = Boolean(filters.page || filters.block || filters.vp || filters.q);

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

      <BlockDialog block={open} onClose={() => setOpen(null)} />
    </div>
  );
}
