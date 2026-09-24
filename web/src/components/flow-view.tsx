"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ChevronLeft, ChevronRight, Monitor, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StoreIcon } from "@/components/store-icon";
import { cn } from "@/lib/utils";
import { assetUrl } from "@/lib/data-source";
import { loadSiteView } from "@/lib/load-blocks";
import { labelFor, PAGE_TYPE_LABEL } from "@/lib/blocks";
import { cutBlocks, flowOf, pageView, FLOW_STEPS, type FlowStep, type FlowStepType, type PageView, type Viewport } from "@/lib/flows";
import { markReturn } from "@/lib/return-to";
import type { ProfilePage, SiteView } from "@/lib/site-profile";

/** From here up the steps sit side by side; below, they stack. */
const WIDE = "(min-width: 900px)";

/** On phones a step shows this much of its page (height over width) until opened. */
const PREVIEW_RATIO = 1.5;

// Module scope, so useSyncExternalStore does not resubscribe on every render.
const subscribeWide = (onChange: () => void) => {
  const query = window.matchMedia(WIDE);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
};
const isWide = () => window.matchMedia(WIDE).matches;
const notWide = () => false;

/** Whether the steps sit side by side. False on the server, where nothing is drawn yet anyway. */
function useWide(): boolean {
  return useSyncExternalStore(subscribeWide, isWide, notWide);
}

/**
 * Where the person was, saved as they open a block and put back when they
 * return: the page's scroll, each column's scroll, and which steps were opened
 * in full. The viewport, markers and which collection or product is shown live
 * in the URL instead, so Back restores those on its own.
 */
type Place = { y: number; columns: Partial<Record<FlowStepType, number>>; open: FlowStepType[] };
const placeKey = (host: string) => `sectionary:flow-place:${host}`;

function savePlace(host: string, place: Place): void {
  try {
    sessionStorage.setItem(placeKey(host), JSON.stringify(place));
  } catch {
    // Private mode or storage blocked: the flow still works, it just starts at the top.
  }
}

/** The saved place, once: it is removed as it is read. */
function takePlace(host: string): Place | null {
  try {
    const raw = sessionStorage.getItem(placeKey(host));
    sessionStorage.removeItem(placeKey(host));
    return raw ? (JSON.parse(raw) as Place) : null;
  } catch {
    return null;
  }
}

/**
 * A store's flow (SEC-20): home, collection, product, cart and checkout, each
 * a full page. Side by side from 900px, each column scrolling on its own so
 * any part of two pages can be compared; stacked on phones, each page cut to
 * a screen and a half until opened. Every block is a link to its detail view.
 */
export function FlowView({ host }: { host: string }) {
  const [state, setState] = useState<{ host: string; view: SiteView | null; error: string | null } | null>(null);
  const [open, setOpen] = useState<FlowStepType[]>([]);
  const wide = useWide();

  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const picked = params.get("v");
  const markers = params.get("markers") !== "off";

  const regions = useRef(new Map<FlowStepType, HTMLDivElement>());
  const restoring = useRef<Place | null>(null);

  useEffect(() => {
    let alive = true;
    loadSiteView(host).then(
      (view) => {
        if (!alive) return;
        const place = takePlace(host);
        restoring.current = place;
        setOpen(place?.open ?? []);
        setState({ host, view, error: null });
      },
      (e: Error) => alive && setState({ host, view: null, error: e.message }),
    );
    return () => {
      alive = false;
    };
  }, [host]);

  // Put the scroll back once the returning flow has drawn. The frames take
  // their height from the blocks' known sizes, so there is nothing to wait for.
  useEffect(() => {
    const place = restoring.current;
    if (!state?.view || !place) return;
    restoring.current = null;
    for (const [type, top] of Object.entries(place.columns)) {
      const region = regions.current.get(type as FlowStepType);
      if (region && top) region.scrollTop = top;
    }
    window.scrollTo({ top: place.y });
  }, [state]);

  const flow = useMemo(() => (state?.view ? flowOf(state.view.pages) : null), [state]);

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (value === null) next.delete(key);
    else next.set(key, value);
    router.replace(next.size ? `${pathname}?${next}` : pathname, { scroll: false });
  };

  const rememberPlace = () => {
    const columns: Place["columns"] = {};
    for (const [type, region] of regions.current) if (region.scrollTop) columns[type] = region.scrollTop;
    savePlace(host, { y: window.scrollY, columns, open });
  };

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

  const viewport: Viewport = picked === "desktop" || picked === "mobile" ? picked : wide ? "desktop" : "mobile";
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
          {/* The basis lets the switches drop to their own line on phones instead of squeezing the title. */}
          <div className="min-w-0 flex-1 basis-52">
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
            <ViewportSwitch value={viewport} onChange={(v) => setParam("v", v)} />
            <Button variant="outline" size="sm" aria-pressed={markers} onClick={() => setParam("markers", markers ? "off" : null)}>
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
          {flow.steps.map((step, i) => {
            // 1-based in the URL (?collection=2), clamped: a page can drop out of a newer capture.
            const at = Math.min(Math.max(Number(params.get(step.type)) - 1 || 0, 0), Math.max(step.pages.length - 1, 0));
            return (
              <li key={step.type} className="flex min-w-0 flex-col gap-2 min-[900px]:w-[340px] min-[900px]:shrink-0">
                <StepColumn
                  step={step}
                  number={i + 1}
                  at={at}
                  onAt={(n) => setParam(step.type, n === 0 ? null : String(n + 1))}
                  viewport={viewport}
                  markers={markers}
                  cut={!wide && !open.includes(step.type)}
                  onToggleOpen={() => setOpen((list) => (list.includes(step.type) ? list.filter((t) => t !== step.type) : [...list, step.type]))}
                  regionRef={(el) => {
                    if (el) regions.current.set(step.type, el);
                    else regions.current.delete(step.type);
                  }}
                  onLeave={rememberPlace}
                />
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

/** Desktop or Mobile, as a radio group: one tab stop, arrow keys move between the two. */
function ViewportSwitch({ value, onChange }: { value: Viewport; onChange: (v: Viewport) => void }) {
  const buttons = useRef(new Map<Viewport, HTMLButtonElement>());
  const options = ["desktop", "mobile"] as const;
  return (
    <div
      role="radiogroup"
      aria-label="Viewport"
      className="flex rounded-lg border p-0.5"
      onKeyDown={(e) => {
        if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
        e.preventDefault();
        const next = value === "desktop" ? "mobile" : "desktop";
        onChange(next);
        buttons.current.get(next)?.focus();
      }}
    >
      {options.map((v) => {
        const Icon = v === "mobile" ? Smartphone : Monitor;
        return (
          <button
            key={v}
            ref={(el) => {
              if (el) buttons.current.set(v, el);
            }}
            type="button"
            role="radio"
            aria-checked={value === v}
            tabIndex={value === v ? 0 : -1}
            onClick={() => onChange(v)}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12px] font-medium transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring touch:h-11",
              value === v ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="size-3.5" />
            {v === "mobile" ? "Mobile" : "Desktop"}
          </button>
        );
      })}
    </div>
  );
}

/** Frame shared by pages and gaps: capped on phones, a column-high scroller from 900px. */
const FRAME = "relative overflow-hidden rounded-lg border bg-muted/40 min-[900px]:h-[calc(100dvh-15rem)] min-[900px]:min-h-80";

function StepColumn({
  step,
  number,
  at,
  onAt,
  viewport,
  markers,
  cut,
  onToggleOpen,
  regionRef,
  onLeave,
}: {
  step: FlowStep;
  number: number;
  /** Which of the step's pages is shown. */
  at: number;
  onAt: (n: number) => void;
  viewport: Viewport;
  markers: boolean;
  /** Cut the page at PREVIEW_RATIO (stacked, not opened). */
  cut: boolean;
  onToggleOpen: () => void;
  regionRef: (el: HTMLDivElement | null) => void;
  /** Called as a block link is followed, to save the reader's place. */
  onLeave: () => void;
}) {
  const label = PAGE_TYPE_LABEL[step.type] ?? step.type;
  const page = step.pages[at] ?? null;
  const path = page ? page.url.replace(/^https?:\/\/[^/]+/, "") || "/" : null;
  const shown = page ? pageView(page, viewport) : null;
  const tall = shown ? shown.ratio > PREVIEW_RATIO : false;
  const cap = tall && cut ? PREVIEW_RATIO : null;

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
            <Button variant="ghost" size="icon-sm" aria-label={`Previous ${label.toLowerCase()}`} disabled={at === 0} onClick={() => onAt(at - 1)}>
              <ChevronLeft />
            </Button>
            <span className="min-w-10 text-center font-mono text-[11px] text-muted-foreground tabular-nums">
              {at + 1} of {step.pages.length}
            </span>
            <Button variant="ghost" size="icon-sm" aria-label={`Next ${label.toLowerCase()}`} disabled={at === step.pages.length - 1} onClick={() => onAt(at + 1)}>
              <ChevronRight />
            </Button>
          </div>
        )}
      </div>
      <p className="-mt-1 min-h-4 truncate font-mono text-[11px] text-muted-foreground">{path}</p>

      {!page || !shown ? (
        <div className={cn(FRAME, "flex aspect-[4/3] items-center justify-center border-dashed bg-transparent p-6 text-center min-[900px]:aspect-auto")}>
          <p className="max-w-56 text-[12px] text-muted-foreground">
            {step.gap === "never" ? "Not captured: we never capture checkout." : "Not captured for this store."}
          </p>
        </div>
      ) : (
        <>
          <div
            ref={regionRef}
            className={cn(FRAME, "min-[900px]:overflow-y-auto")}
            // The column scrolls on its own from 900px; a label lets a keyboard or screen reader find it.
            role="region"
            aria-label={`${label} page, ${shown.viewport}`}
          >
            {shown.fallback && (
              <p className="border-b bg-card px-2.5 py-1.5 text-[11px] text-muted-foreground">Only the {shown.viewport} page was captured.</p>
            )}
            <PageBody page={page} shown={shown} markers={markers} cap={cap} onLeave={onLeave} />
            {cap && (
              <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-background to-transparent min-[900px]:hidden" />
            )}
          </div>
          {tall && (
            <Button variant="outline" size="sm" className="self-center min-[900px]:hidden" aria-expanded={!cut} onClick={onToggleOpen}>
              {cut ? "Show whole page" : "Show less"}
            </Button>
          )}
        </>
      )}
    </>
  );
}

/**
 * The page, top to bottom. With blocks, each is a link to its detail view and
 * carries a numbered marker. With a cap, the page stops there (see cutBlocks),
 * so no link reaches past the frame into the next step.
 */
function PageBody({
  page,
  shown,
  markers,
  cap,
  onLeave,
}: {
  page: ProfilePage;
  shown: PageView;
  markers: boolean;
  cap: number | null;
  onLeave: () => void;
}) {
  if (shown.full) {
    const alt = `${page.title ?? PAGE_TYPE_LABEL[page.type] ?? page.type}, ${shown.viewport}`;
    return (
      <div className="overflow-hidden" style={cap ? { aspectRatio: `1 / ${cap}` } : undefined}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={assetUrl(shown.full)} alt={alt} loading="lazy" className="block w-full" />
      </div>
    );
  }

  return (
    <div className="bg-card">
      {cutBlocks(shown.blocks, cap).map(({ block: b, ratio, cut }, i) => {
        const name = labelFor(b.typeHint);
        return (
          <Link
            key={b.id}
            href={`/?open=${encodeURIComponent(b.id)}`}
            onClick={() => {
              onLeave();
              markReturn(b.id);
            }}
            className="group relative block overflow-hidden border-t border-black/10 outline-none first:border-t-0"
            style={{ aspectRatio: `1 / ${cut ?? ratio}`, background: b.bg }}
          >
            <span className="block" style={{ aspectRatio: `${b.w} / ${b.h}` }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={assetUrl(b.src)} alt="" loading="lazy" decoding="async" className="block h-full w-full" />
            </span>
            {/* Where the block starts and ends, on hover or focus. */}
            <span className="pointer-events-none absolute inset-0 ring-2 ring-primary ring-inset opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100" />
            {/* The marker names the link, so what is read out is what is shown. */}
            {markers ? (
              <span className="pointer-events-none absolute top-1 left-1 max-w-[calc(100%-0.5rem)] truncate rounded-full bg-black/75 px-1.5 py-px text-[10px] font-medium text-white tabular-nums group-hover:bg-primary group-hover:text-primary-foreground group-focus-visible:bg-primary group-focus-visible:text-primary-foreground">
                {i + 1} · {name}
                <span className="sr-only"> block, open its detail</span>
              </span>
            ) : (
              <span className="sr-only">
                {i + 1} · {name} block, open its detail
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
