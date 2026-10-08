"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { StoreIcon } from "@/components/store-icon";
import { Stack } from "@/components/site-profile";
import { cn } from "@/lib/utils";
import { loadFlowSummaries } from "@/lib/load-blocks";
import { PAGE_TYPE_LABEL } from "@/lib/blocks";
import { flowCounts, type FlowSummary } from "@/lib/flows";

/** Rows rendered per step; more join as the end of the list scrolls into view. */
const STEP = 40;

/** Step thumbnails are cut to this shape (height over width). */
const THUMB_RATIO = 4 / 3;

/**
 * Every captured store's flow (SEC-20), and the count the task is measured by:
 * stores whose home, collection and product pages are all captured. Complete
 * flows by default; "Show incomplete" lists the rest with what they lack.
 *
 * Counted from /api/sites when NEXT_PUBLIC_SITES_SRC is set (SEC-47), the
 * same source each store's flow page reads, so the two always agree. Without
 * it, from the block set, which every store's blocks pass through.
 */
export function FlowsIndex() {
  const [list, setList] = useState<FlowSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const all = params.get("all") === "1";

  useEffect(() => {
    let alive = true;
    loadFlowSummaries().then(
      (summaries) => alive && setList(summaries),
      (e: Error) => alive && setError(e.message),
    );
    return () => {
      alive = false;
    };
  }, []);

  const counts = useMemo(() => flowCounts(list ?? []), [list]);
  const shown = useMemo(() => (list ?? []).filter((s) => all || s.flow.complete), [list, all]);
  const incomplete = counts.captured - counts.complete;

  // Grow the list as its end comes into view. Reset when the toggle changes.
  const [limit, setLimit] = useState({ all, n: STEP });
  const n = limit.all === all ? limit.n : STEP;
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setLimit({ all, n: n + STEP });
    }, { rootMargin: "1200px 0px" });
    observer.observe(el);
    return () => observer.disconnect();
  }, [all, n, shown.length]);

  const toggle = () => {
    const next = new URLSearchParams(params.toString());
    if (all) next.delete("all");
    else next.set("all", "1");
    router.replace(next.size ? `${pathname}?${next}` : pathname, { scroll: false });
  };

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1 basis-72">
          <h1 className="font-heading text-[22px] leading-tight font-semibold">Flows</h1>
          <p className="mt-1 text-[13px]" aria-live="polite">
            {list ? (
              <>
                <span className="font-semibold tabular-nums">{counts.complete.toLocaleString("en-US")}</span>{" "}
                {counts.complete === 1 ? "store has" : "stores have"} a complete flow
                <span className="text-muted-foreground">
                  {" "}
                  · {counts.withCart.toLocaleString("en-US")} with cart · {counts.captured.toLocaleString("en-US")} captured
                </span>
              </>
            ) : (
              <span className="text-muted-foreground">Counting flows…</span>
            )}
          </p>
          <p className="mt-1 max-w-2xl text-[12px] text-muted-foreground">
            A flow is complete when a store&apos;s home, collection and product pages are captured. Cart joins when the
            store&apos;s robots.txt lets us in; checkout is never captured.
          </p>
        </div>
        {list && incomplete > 0 && (
          <Button variant="outline" size="sm" aria-pressed={all} onClick={toggle}>
            Show incomplete
            <span className="font-mono text-[11px] text-muted-foreground tabular-nums">{incomplete.toLocaleString("en-US")}</span>
          </Button>
        )}
      </header>

      {error ? (
        <Empty>The flows could not be loaded ({error}).</Empty>
      ) : !list ? (
        <FlowsSkeleton />
      ) : shown.length === 0 ? (
        <Empty>
          <p className="text-foreground">No store has a complete flow yet.</p>
          {incomplete > 0 && (
            <Button variant="outline" size="sm" className="mt-3" onClick={toggle}>
              Show the {incomplete.toLocaleString("en-US")} incomplete
            </Button>
          )}
        </Empty>
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {shown.slice(0, n).map((summary) => (
              <li key={summary.store.host}>
                <FlowRow summary={summary} />
              </li>
            ))}
          </ul>
          {n < shown.length && <div ref={sentinel} aria-hidden className="h-px" />}
        </>
      )}
    </div>
  );
}

/** One store: who it is, then its five steps as thumbnails, gaps dashed. */
function FlowRow({ summary }: { summary: FlowSummary }) {
  const { store, flow } = summary;
  const got = flow.steps.filter((s) => s.pages.length > 0).map((s) => PAGE_TYPE_LABEL[s.type].toLowerCase());
  const gaps = flow.steps.filter((s) => s.pages.length === 0).map((s) => PAGE_TYPE_LABEL[s.type].toLowerCase());
  return (
    <Link
      href={`/sites/${encodeURIComponent(store.host)}/flow`}
      className="group flex flex-col gap-3 rounded-lg border bg-card p-3 transition-colors duration-150 outline-none hover:border-primary/60 focus-visible:ring-2 focus-visible:ring-ring sm:flex-row sm:items-center"
    >
      <div className="flex min-w-0 items-center gap-3 sm:w-64 sm:shrink-0">
        <StoreIcon host={store.host} brand={store.brand} size={36} className="rounded-[10px]" />
        <div className="min-w-0">
          <p className="truncate text-[14px] font-semibold group-hover:text-link">{store.brand}</p>
          <p className="truncate font-mono text-[11px] text-muted-foreground">{store.host}</p>
          {!flow.complete && (
            <p className="text-[12px] text-muted-foreground">
              Missing {flow.missing.map((t) => PAGE_TYPE_LABEL[t].toLowerCase()).join(", ")}
            </p>
          )}
          <span className="sr-only">
            , captured: {got.join(", ")}; not captured: {gaps.join(", ")}
          </span>
        </div>
      </div>
      <ol aria-hidden className="grid flex-1 grid-cols-5 gap-1.5 sm:max-w-md sm:gap-2">
        {flow.steps.map((step) => {
          const page = step.pages[0];
          const blocks = page ? (page.desktopBlocks.length ? page.desktopBlocks : page.mobileBlocks) : [];
          return (
            <li key={step.type} className="flex min-w-0 flex-col gap-1">
              <span
                className={cn(
                  "relative block overflow-hidden rounded-md border",
                  page ? "bg-muted" : "border-dashed bg-transparent",
                )}
                style={{ aspectRatio: `1 / ${THUMB_RATIO}` }}
              >
                {page && <Stack src={page.desktop ?? page.mobile} blocks={blocks} ratio={THUMB_RATIO} />}
              </span>
              <span className={cn("truncate text-center text-[10px]", page ? "text-foreground" : "text-muted-foreground")}>
                {PAGE_TYPE_LABEL[step.type]}
              </span>
            </li>
          );
        })}
      </ol>
    </Link>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">{children}</div>;
}

/** Rows with nothing in them, so nothing jumps when the index arrives. */
export function FlowsSkeleton() {
  return (
    <ul className="flex flex-col gap-2" aria-busy="true" aria-label="Loading flows">
      {Array.from({ length: 6 }, (_, i) => (
        <li key={i} className="flex flex-col gap-3 rounded-lg border bg-card p-3 sm:flex-row sm:items-center" aria-hidden>
          <div className="flex items-center gap-3 sm:w-64">
            <div className="shimmer size-9 rounded-[10px] bg-muted" />
            <div className="flex flex-col gap-1.5">
              <div className="shimmer h-3 w-28 rounded bg-muted" />
              <div className="shimmer h-3 w-36 rounded bg-muted" />
            </div>
          </div>
          <div className="grid flex-1 grid-cols-5 gap-1.5 sm:max-w-md sm:gap-2">
            {Array.from({ length: 5 }, (_, j) => (
              <div key={j} className="shimmer rounded-md bg-muted" style={{ aspectRatio: `1 / ${THUMB_RATIO}` }} />
            ))}
          </div>
        </li>
      ))}
    </ul>
  );
}
