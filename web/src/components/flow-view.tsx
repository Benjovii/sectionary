"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ChevronLeft, ChevronRight, Monitor, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StoreIcon } from "@/components/store-icon";
import { cn } from "@/lib/utils";
import { assetUrl } from "@/lib/data-source";
import { loadSiteView } from "@/lib/load-blocks";
import { labelFor, PAGE_TYPE_LABEL, type Block } from "@/lib/blocks";
import { flowOf, FLOW_STEPS, type FlowStep } from "@/lib/flows";
import type { ProfilePage, SiteView } from "@/lib/site-profile";

type Viewport = "desktop" | "mobile";

/** From here up the steps sit side by side; below, they stack. */
const WIDE = "(min-width: 900px)";

/** On phones a step shows this much of its page (height over width) until opened. */
const PREVIEW_RATIO = 1.5;

/**
 * A store's flow (SEC-20): home, collection, product, cart and checkout, each
 * a full page. Side by side from 900px, each column scrolling on its own so
 * any part of two pages can be compared; stacked on phones, each page cut to
 * a screen and a half until opened. Every block is a link to its detail view.
 */
export function FlowView({ host }: { host: string }) {
  const [state, setState] = useState<{ host: string; view: SiteView | null; error: string | null } | null>(null);
  // Null until the person picks: then the default follows the screen.
  const [picked, setPicked] = useState<Viewport | null>(null);
  const [markers, setMarkers] = useState(true);

  useEffect(() => {
    let alive = true;
    loadSiteView(host).then(
      (view) => alive && setState({ host, view, error: null }),
      (e: Error) => alive && setState({ host, view: null, error: e.message }),
    );
    return () => {
      alive = false;
    };
  }, [host]);

  const flow = useMemo(() => (state?.view ? flowOf(state.view.pages) : null), [state]);

  if (!state || state.host !== host) return <FlowSkeleton />;
  if (state.error) return <Empty>This flow could not be loaded ({state.error}).</Empty>;
  if (!state.view || !flow) {
    return (
      <Empty>
        <p className="text-foreground">We have no store at {host}.</p>
        <Link href="/flows" className="mt-3 inline-block rounded-sm text-[13px] text-link underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring touch:py-3">
          Every flow
        </Link>
      </Empty>
    );
  }

  // Read only once the data is here, which is only ever on the client.
  const viewport: Viewport = picked ?? (window.matchMedia(WIDE).matches ? "desktop" : "mobile");
  const { store } = state.view;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-3">
        <Link
          href={`/sites/${encodeURIComponent(store.host)}`}
          className="inline-flex w-fit items-center gap-1 rounded-md text-[12px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring touch:-my-3 touch:h-11 touch:pr-3"
        >
          <ArrowLeft className="size-3.5" /> {store.brand}
        </Link>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-3">
          <StoreIcon key={store.host} host={store.host} brand={store.brand} size={40} className="rounded-lg" />
          <div className="min-w-0 flex-1">
            <h1 className="font-heading text-[22px] leading-tight font-semibold">{store.brand} flow</h1>
            <p className="text-[12px] text-muted-foreground">
              {flow.captured} of {FLOW_STEPS.length} steps captured ·{" "}
              {flow.complete ? (
                <span className="text-foreground">complete</span>
              ) : (
                <>missing {flow.missing.map((t) => PAGE_TYPE_LABEL[t].toLowerCase()).join(", ")}</>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div role="radiogroup" aria-label="Viewport" className="flex rounded-lg border p-0.5">
              {(["desktop", "mobile"] as const).map((v) => {
                const Icon = v === "mobile" ? Smartphone : Monitor;
                return (
                  <button
                    key={v}
                    type="button"
                    role="radio"
                    aria-checked={viewport === v}
                    onClick={() => setPicked(v)}
                    className={cn(
                      "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12px] font-medium transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring touch:h-11",
                      viewport === v ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <Icon className="size-3.5" />
                    {v === "mobile" ? "Mobile" : "Desktop"}
                  </button>
                );
              })}
            </div>
            <Button variant="outline" size="sm" aria-pressed={markers} onClick={() => setMarkers((m) => !m)}>
              Markers
            </Button>
          </div>
        </div>
      </header>

      {flow.captured === 0 ? (
        <Empty>Nothing has been captured from this store yet, so it has no flow to show.</Empty>
      ) : (
        <ol
          aria-label="Flow, home to checkout"
          className="flex flex-col gap-8 min-[900px]:-mx-4 min-[900px]:flex-row min-[900px]:gap-4 min-[900px]:overflow-x-auto min-[900px]:px-4 min-[900px]:pb-3"
        >
          {flow.steps.map((step, i) => (
            <li key={step.type} className="flex min-w-0 flex-col gap-2 min-[900px]:w-[340px] min-[900px]:shrink-0">
              <StepColumn step={step} number={i + 1} viewport={viewport} markers={markers} />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** Frame shared by pages and gaps: capped on phones, a column-high scroller from 900px. */
const FRAME = "relative overflow-hidden rounded-lg border bg-muted/40 min-[900px]:h-[calc(100dvh-15rem)] min-[900px]:min-h-80";

function StepColumn({ step, number, viewport, markers }: { step: FlowStep; number: number; viewport: Viewport; markers: boolean }) {
  const [at, setAt] = useState(0);
  const [open, setOpen] = useState(false);
  const label = PAGE_TYPE_LABEL[step.type] ?? step.type;
  const page = step.pages[at] ?? null;
  const path = page ? page.url.replace(/^https?:\/\/[^/]+/, "") || "/" : null;
  const shown = page ? pageBlocks(page, viewport) : null;
  const tall = shown ? shown.ratio > PREVIEW_RATIO : false;

  return (
    <>
      <div className="flex min-h-8 items-center gap-2 touch:min-h-11">
        <span
          aria-hidden
          className={cn(
            "flex size-6 shrink-0 items-center justify-center rounded-full font-mono text-[11px] font-medium tabular-nums",
            page ? "bg-primary text-primary-foreground" : "border border-dashed text-muted-foreground",
          )}
        >
          {number}
        </span>
        <h2 className="text-[14px] font-semibold">
          <span className="sr-only">Step {number}, </span>
          {label}
        </h2>
        {step.pages.length > 1 && (
          <div className="ml-auto flex items-center gap-0.5">
            <Button variant="ghost" size="icon-sm" aria-label={`Previous ${label.toLowerCase()}`} disabled={at === 0} onClick={() => { setAt(at - 1); setOpen(false); }}>
              <ChevronLeft />
            </Button>
            <span className="min-w-10 text-center font-mono text-[11px] text-muted-foreground tabular-nums">
              {at + 1} of {step.pages.length}
            </span>
            <Button variant="ghost" size="icon-sm" aria-label={`Next ${label.toLowerCase()}`} disabled={at === step.pages.length - 1} onClick={() => { setAt(at + 1); setOpen(false); }}>
              <ChevronRight />
            </Button>
          </div>
        )}
      </div>
      <p className="-mt-1 min-h-4 truncate font-mono text-[11px] text-muted-foreground">{path}</p>

      {!page || !shown ? (
        <div className={cn(FRAME, "flex aspect-[4/3] items-center justify-center border-dashed bg-transparent p-6 text-center min-[900px]:aspect-auto")}>
          <p className="max-w-56 text-[12px] text-muted-foreground">
            {step.gap === "never" ? "Not captured: we never capture checkout." : `Not captured for this store.`}
          </p>
        </div>
      ) : (
        <>
          <div
            className={cn(FRAME, "min-[900px]:overflow-y-auto", open || !tall ? "" : "max-h-[150vw]")}
            // The column scrolls on its own from 900px; a label lets a keyboard or screen reader find it.
            role="region"
            aria-label={`${label} page, ${shown.viewport}`}
          >
            {shown.note && (
              <p className="border-b bg-card px-2.5 py-1.5 text-[11px] text-muted-foreground">{shown.note}</p>
            )}
            <PageBody page={page} shown={shown} markers={markers} />
            {tall && !open && (
              <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-background to-transparent min-[900px]:hidden" />
            )}
          </div>
          {tall && (
            <Button variant="outline" size="sm" className="self-center min-[900px]:hidden" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
              {open ? "Show less" : "Show whole page"}
            </Button>
          )}
        </>
      )}
    </>
  );
}

type Shown = {
  viewport: Viewport;
  /** A full-page screenshot (API source), or null when the page is its blocks. */
  full: string | null;
  blocks: Block[];
  /** Height over width of the whole page, for deciding whether it needs "Show whole page". */
  ratio: number;
  note: string | null;
};

/** What to draw for a page in the chosen viewport, falling back to the other one when that is all there is. */
function pageBlocks(page: ProfilePage, want: Viewport): Shown | null {
  const other: Viewport = want === "desktop" ? "mobile" : "desktop";
  for (const viewport of [want, other]) {
    const full = viewport === "desktop" ? page.desktop : page.mobile;
    const blocks = viewport === "desktop" ? page.desktopBlocks : page.mobileBlocks;
    if (!full && blocks.length === 0) continue;
    const note = viewport === want ? null : `Only the ${viewport} page was captured.`;
    // A full screenshot's height is unknown until it loads; treat it as tall.
    const ratio = full ? Number.POSITIVE_INFINITY : blocks.reduce((sum, b) => sum + b.h / b.w, 0);
    return { viewport, full, blocks, ratio, note };
  }
  return null;
}

/** The page, top to bottom. With blocks, each is a link to its detail view and carries a numbered marker. */
function PageBody({ page, shown, markers }: { page: ProfilePage; shown: Shown; markers: boolean }) {
  if (shown.full) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={assetUrl(shown.full)} alt={`${page.title ?? PAGE_TYPE_LABEL[page.type] ?? page.type}, ${shown.viewport}`} loading="lazy" className="block w-full" />;
  }
  return (
    <div className="bg-card">
      {shown.blocks.map((b, i) => {
        const name = labelFor(b.typeHint);
        return (
          <Link
            key={b.id}
            href={`/?open=${encodeURIComponent(b.id)}&back=1`}
            className="group relative block border-t border-black/10 outline-none first:border-t-0"
            style={{ aspectRatio: `${b.w} / ${b.h}`, background: b.bg }}
            aria-label={`${i + 1}, ${name} block. Open its detail`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={assetUrl(b.src)} alt="" loading="lazy" decoding="async" className="block h-full w-full" />
            {/* Where the block starts and ends, on hover or focus. */}
            <span className="pointer-events-none absolute inset-0 ring-2 ring-primary ring-inset opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100" />
            {markers && (
              <span
                aria-hidden
                className="pointer-events-none absolute top-1 left-1 max-w-[calc(100%-0.5rem)] truncate rounded-full bg-black/75 px-1.5 py-px text-[10px] font-medium text-white tabular-nums group-hover:bg-primary group-hover:text-primary-foreground group-focus-visible:bg-primary group-focus-visible:text-primary-foreground"
              >
                {i + 1} · {name}
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">{children}</div>;
}

/** The flow's shape with nothing in it, so nothing jumps when it loads. */
export function FlowSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading flow">
      <div className="flex flex-col gap-3">
        <div className="shimmer h-3 w-20 rounded bg-muted" />
        <div className="shimmer h-6 w-56 rounded bg-muted" />
        <div className="shimmer h-3 w-40 rounded bg-muted" />
      </div>
      <div className="flex flex-col gap-8 min-[900px]:flex-row min-[900px]:gap-4 min-[900px]:overflow-hidden">
        {FLOW_STEPS.map((s) => (
          <div key={s} className="flex flex-col gap-2 min-[900px]:w-[340px] min-[900px]:shrink-0">
            <div className="shimmer h-6 w-28 rounded bg-muted" />
            <div className="shimmer aspect-[4/3] rounded-lg bg-muted min-[900px]:aspect-auto min-[900px]:h-[calc(100dvh-15rem)]" />
          </div>
        ))}
      </div>
    </div>
  );
}
