"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowLeft, ArrowRight, Check, Copy, ExternalLink, Link2, MoreHorizontal, Store, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StoreIcon } from "@/components/store-icon";
import { SaveToBoard } from "@/components/save-to-board";
import { ViewportSwitch } from "@/components/viewport-switch";
import { TimeMachineStage, useTimeMachine } from "@/components/time-machine";
import { BlockInfoPanel, copyImage, TABS, zoomWidth, type Tab } from "@/components/block-dialog";
import { cn } from "@/lib/utils";
import { assetUrl } from "@/lib/data-source";
import { labelFor, PAGE_TYPE_LABEL, thumbOf, type Block } from "@/lib/blocks";
import { capturesOf, counterpartOf, similarTo, type DetailIndex } from "@/lib/block-detail";
import type { FilterKey } from "@/lib/filters";
import type { TechCounts } from "@/lib/tech";
import type { Viewport } from "@/contracts/block";

/** Gap round the window on a wide screen. Phones get the whole screen. */
const INSET = "min-[700px]:m-6 min-[700px]:h-[calc(100dvh-48px)]";

/** A block opened from a shared board: the client sees its note, and none of the library's tools. */
export type SharedContext = { note: string | null; position: string };

const NO_DETAIL: DetailIndex = { byId: new Map(), byPage: new Map(), byType: new Map(), captures: new Map() };

/** A shared board offers the details tab only: no brief to generate, no history to browse. */
const SHARED_TABS = TABS.filter(([t]) => t === "details");

type ViewerProps = {
  block: Block | null;
  /** The URL names a block the loaded set does not have. */
  missing?: boolean;
  /** Pairs, similar blocks and captures; without it the window shows the block alone. */
  detail?: DetailIndex | null;
  /** The "More info" side panel is open. */
  info: boolean;
  onInfo: (open: boolean) => void;
  onClose: () => void;
  /** Show another block in place: a similar one. Without it, no "See similar". */
  onShow?: (block: Block) => void;
  /** Previous and next; absent at the ends, or when the block is not in a list. */
  onStep: { prev?: () => void; next?: () => void };
  /** "Found in" chips and tech-stack chips: show every block with that value. */
  onFilter?: (key: FilterKey, value: string) => void;
  /** Library-wide counts for the tech-stack chips. */
  counts?: TechCounts | null;
  /** Opened from a shared board, by a client. */
  shared?: SharedContext;
};

/**
 * The block viewer: one screenshot in a window of its own, the way Mobbin
 * opens a screen. A click on a block anywhere in the app opens it: the wall,
 * a site's pages, a flow, a board, a shared board.
 *
 * The screenshot is the full-resolution capture (2x), not the wall's
 * thumbnail, fitted to the window and never drawn wider than the block was
 * captured, so it stays sharp. The thumbnail the wall already loaded sits
 * underneath while it arrives, so the picture is there at once and sharpens.
 * A click zooms to the capture's real pixels; a second click fits it again.
 *
 * Arrows (on screen and on the keyboard) step through the list it was opened
 * from. "More info" opens the details (and the brief and time machine) in a
 * panel on the right of the window; Escape closes that panel first. "See
 * similar" scrolls to the same kind of block from other stores, below.
 */
export function BlockViewer({ block, missing = false, detail, info, onInfo, onClose, ...rest }: ViewerProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const show = Boolean(block || missing);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (show && !d.open) d.showModal();
    if (!show && d.open) d.close();
  }, [show]);

  return (
    <dialog
      ref={ref}
      aria-label={block ? `${labelFor(block.typeHint)} from ${block.host}` : "Block"}
      onClose={onClose}
      onCancel={(e) => {
        // Escape closes the info panel before the window.
        if (info) {
          e.preventDefault();
          onInfo(false);
        }
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="m-0 h-dvh max-h-dvh w-screen max-w-none overflow-y-auto overscroll-contain bg-transparent p-0 backdrop:bg-black/75 backdrop:backdrop-blur-sm"
    >
      {block ? (
        <Window key={block.id} block={block} detail={detail ?? NO_DETAIL} info={info} onInfo={onInfo} onClose={onClose} {...rest} />
      ) : missing ? (
        <div className="flex min-h-dvh items-center justify-center p-4" onClick={(e) => e.target === e.currentTarget && onClose()}>
          <div className="flex max-w-sm flex-col items-center gap-3 rounded-xl border bg-card p-8 text-center text-card-foreground">
            <p className="text-foreground">This block is not in the loaded set.</p>
            <p className="text-[12px] text-muted-foreground">It may come from a newer capture than the one this page is reading.</p>
            <Button variant="outline" size="sm" onClick={onClose}>
              Back to the wall
            </Button>
          </div>
        </div>
      ) : null}
    </dialog>
  );
}

function Window({
  block: opened,
  detail,
  info,
  onInfo,
  onClose,
  onShow,
  onStep,
  onFilter,
  counts = null,
  shared,
}: Omit<ViewerProps, "block" | "missing" | "detail"> & { block: Block; detail: DetailIndex }) {
  // Earlier captures of this block, once recapture gives it any; the newest
  // is shown, and the info panel steps back through the rest.
  const captures = useMemo(() => capturesOf(detail, opened), [detail, opened]);
  const [captureAt, setCaptureAt] = useState(captures.length - 1);
  const current = captures[captureAt] ?? opened;

  // The same block at the other viewport, when the page has one. Switching to
  // it is local: the arrows still step from the block that was opened.
  const pair = useMemo(() => counterpartOf(detail, current), [detail, current]);
  const [viewport, setViewport] = useState<Viewport>(opened.viewport);
  const block = viewport === current.viewport ? current : (pair ?? current);
  const similar = useMemo(() => (shared || !onShow ? [] : similarTo(detail, block)), [detail, block, shared, onShow]);
  const mobile = block.viewport === "mobile";
  const pageLabel = PAGE_TYPE_LABEL[block.pageType] ?? block.pageType;

  // The info panel's tab. The time machine fetches its history only once
  // its tab is open, and shows its comparison where the screenshot was.
  const [tab, setTab] = useState<Tab>("details");
  const history = info && tab === "history" && !shared;
  const tm = useTimeMachine(block, history);

  const similarRef = useRef<HTMLElement>(null);

  // Arrow keys step through the list, but not while typing (the brief).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable]")) return;
      if (event.key === "ArrowLeft" && onStep.prev) {
        event.preventDefault();
        onStep.prev();
      } else if (event.key === "ArrowRight" && onStep.next) {
        event.preventDefault();
        onStep.next();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onStep]);

  const store = (
    <>
      <StoreIcon host={block.host} brand={block.host} size={34} className="rounded-lg" />
      <span className="truncate font-heading text-[17px] font-semibold min-[700px]:text-[19px]">{block.host}</span>
    </>
  );

  return (
    <>
      <div
        className={cn(
          "relative flex h-dvh flex-col bg-card text-card-foreground shadow-2xl min-[700px]:rounded-2xl min-[700px]:border",
          INSET,
        )}
      >
        <header className="flex h-14 shrink-0 items-center gap-3 px-3 min-[700px]:h-16 min-[700px]:px-5">
          {shared ? (
            <div className="flex min-w-0 items-center gap-2.5">{store}</div>
          ) : (
            <Link
              href={`/sites/${encodeURIComponent(block.host)}`}
              className="flex min-w-0 items-center gap-2.5 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
              title={`${block.host}: every captured page`}
            >
              {store}
            </Link>
          )}
          <div className="ml-auto flex items-center gap-1">
            {pair && <ViewportSwitch value={viewport} onChange={setViewport} size="sm" className="mr-2 hidden sm:inline-flex" />}
            <CopyLink />
            <a
              href={block.pageUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Open the source page"
              title="Open the source page"
              className="inline-flex size-9 items-center justify-center rounded-lg text-muted-foreground outline-none transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring touch:size-11"
            >
              <ExternalLink className="size-[18px]" />
            </a>
            <span aria-hidden className="mx-2 h-6 w-px bg-border" />
            <button
              type="button"
              autoFocus
              aria-label="Close"
              onClick={onClose}
              className="inline-flex size-9 items-center justify-center rounded-full bg-muted text-muted-foreground outline-none transition-colors duration-150 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring touch:size-11"
            >
              <X className="size-[18px]" />
            </button>
          </div>
        </header>

        {pair && (
          <div className="flex justify-center pb-2 sm:hidden">
            <ViewportSwitch value={viewport} onChange={setViewport} size="sm" />
          </div>
        )}

        <div className="relative flex min-h-0 flex-1 border-t">
          <div className="relative flex min-w-0 flex-1 flex-col">
            {history ? (
              <div className="min-h-0 flex-1 overflow-auto">
                <TimeMachineStage tm={tm} />
              </div>
            ) : (
              <Stage key={block.id} block={block} />
            )}

            <Arrow side="left" onClick={onStep.prev} />
            <Arrow side="right" onClick={onStep.next} />

            <footer className="flex shrink-0 items-center justify-between gap-2 px-3 py-3 min-[700px]:px-5 min-[700px]:py-4 md:grid md:grid-cols-[1fr_auto_1fr] md:gap-3">
              <div className="hidden min-w-0 items-center gap-2 text-[13px] md:flex">
                {shared ? (
                  <>
                    <span className="shrink-0 font-mono text-[12px] text-muted-foreground tabular-nums">{shared.position}</span>
                    {shared.note && (
                      <span className="truncate" title={shared.note}>
                        {shared.note}
                      </span>
                    )}
                  </>
                ) : (
                  <>
                    <span className="shrink-0 text-muted-foreground">Found in</span>
                    <FoundIn label={pageLabel} title={`Every block from ${pageLabel.toLowerCase()} pages`} onClick={onFilter && (() => onFilter("page", block.pageType))} />
                    <FoundIn
                      label={labelFor(block.typeHint)}
                      title={`Every ${labelFor(block.typeHint).toLowerCase()} block`}
                      onClick={onFilter && (() => onFilter("block", block.typeHint))}
                    />
                  </>
                )}
              </div>
              <div className="flex items-center gap-2 md:col-start-2">
                {!shared && <SaveToBoard block={block} up className="h-10 rounded-full px-5 text-[14px] touch:h-11" />}
                <CopyImage block={block} />
                <More block={block} site={!shared} />
              </div>
              <div className="flex min-w-0 flex-col items-end text-right text-[13px] leading-tight">
                <span className="hidden truncate text-muted-foreground sm:block">
                  {mobile ? "Mobile" : "Desktop"} <span className="font-mono text-[12px] tabular-nums">({block.w}×{block.h})</span>
                </span>
                <button
                  type="button"
                  onClick={() => onInfo(!info)}
                  aria-expanded={info}
                  aria-controls="block-info"
                  className={cn(
                    "rounded-sm font-medium whitespace-nowrap underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring touch:py-3",
                    info && "text-primary",
                  )}
                >
                  {info ? "Hide info" : "More info"}
                </button>
              </div>
            </footer>
          </div>

          {info && (
            <aside
              id="block-info"
              aria-label="Block info"
              className="flex flex-col overflow-y-auto bg-card max-[899px]:absolute max-[899px]:inset-0 max-[899px]:z-20 min-[900px]:w-[360px] min-[900px]:shrink-0 min-[900px]:border-l min-[700px]:max-[899px]:rounded-b-2xl"
            >
              <div className="sticky top-0 z-10 flex h-12 shrink-0 items-center justify-between border-b bg-card px-4">
                <h3 className="font-heading text-[15px] font-semibold">Info</h3>
                <button
                  type="button"
                  onClick={() => onInfo(false)}
                  aria-label="Close info"
                  className="inline-flex size-8 items-center justify-center rounded-full text-muted-foreground outline-none transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring touch:size-11"
                >
                  <X className="size-4" />
                </button>
              </div>
              <BlockInfoPanel
                block={block}
                tab={shared ? "details" : tab}
                onTab={setTab}
                tm={history ? tm : null}
                captures={captures}
                captureAt={captureAt}
                onCaptureAt={setCaptureAt}
                counts={counts}
                onFilter={shared ? undefined : onFilter}
                tabs={shared ? SHARED_TABS : TABS}
              />
            </aside>
          )}
        </div>

        {similar.length > 0 && (
          <button
            type="button"
            onClick={() => similarRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
            className="absolute bottom-0 left-1/2 z-10 hidden -translate-x-1/2 translate-y-1/2 items-center gap-1.5 rounded-full border bg-card px-4 py-2 text-[13px] font-medium shadow-lg outline-none transition-colors duration-150 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring min-[700px]:inline-flex"
          >
            See similar <ArrowDown className="size-4" />
          </button>
        )}
      </div>

      {similar.length > 0 && onShow && (
        <section ref={similarRef} aria-labelledby="similar-heading" className="mx-auto max-w-[1600px] scroll-mt-6 px-3 pt-8 pb-12 min-[700px]:px-6">
          <h3 id="similar-heading" className="mb-4 font-heading text-[17px] font-semibold text-white">
            More {labelFor(block.typeHint).toLowerCase()} blocks
          </h3>
          <ul
            className={cn(
              "grid gap-3",
              mobile ? "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6" : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4",
            )}
          >
            {similar.map((b) => (
              <li key={b.id}>
                <SimilarCard block={b} onOpen={onShow} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

/**
 * Where the screenshot sits: fitted to the room, or, for a block so tall that
 * fitting would shrink it to a strip, at a readable width and scrolled.
 */
function Stage({ block }: { block: Block }) {
  const mobile = block.viewport === "mobile";
  const scroller = useRef<HTMLDivElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const [room, setRoom] = useState<{ w: number; h: number } | null>(null);
  const [loaded, setLoaded] = useState(false);
  const thumb = thumbOf(block);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => {
      const style = getComputedStyle(el);
      setRoom({
        w: el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
        h: el.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom),
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const fitted = room ? fit(block, room) : null;

  // Zoomed width in CSS pixels, and the point that was clicked, so the zoomed
  // picture can be scrolled to keep that point under the pointer.
  const [zoom, setZoom] = useState<number | null>(null);
  const anchor = useRef<{ fx: number; fy: number; x: number; y: number } | null>(null);

  const toggleZoom = useCallback(
    (at: { clientX: number; clientY: number }) => {
      const img = image.current, el = scroller.current;
      if (!img || !el) return;
      if (zoom) {
        setZoom(null);
        return;
      }
      const box = img.getBoundingClientRect(), view = el.getBoundingClientRect();
      const width = zoomWidth(img.naturalWidth || block.w * 2, box.width, window.devicePixelRatio || 1);
      if (width <= box.width * 1.05) return;
      anchor.current = { fx: (at.clientX - box.left) / box.width, fy: (at.clientY - box.top) / box.height, x: at.clientX - view.left, y: at.clientY - view.top };
      setZoom(width);
    },
    [zoom, block.w],
  );

  useLayoutEffect(() => {
    const img = image.current, el = scroller.current, at = anchor.current;
    anchor.current = null;
    if (!zoom || !img || !el || !at) return;
    const box = img.getBoundingClientRect(), view = el.getBoundingClientRect();
    el.scrollLeft += box.left + at.fx * box.width - (view.left + at.x);
    el.scrollTop += box.top + at.fy * box.height - (view.top + at.y);
  }, [zoom]);

  const width = zoom ?? fitted?.w ?? 0;
  const canZoom = Boolean(fitted && zoomWidth(block.w * 2, fitted.w, 2) > fitted.w * 1.05);

  return (
    <div
      ref={scroller}
      className="min-h-0 flex-1 overflow-auto px-3 py-2 min-[700px]:px-20 min-[700px]:py-3 [scrollbar-width:thin]"
    >
      {/* m-auto rather than centring the flex row: it centres while there is
          room and lets a zoomed picture overflow to the right and bottom,
          where it can be scrolled, instead of off the left edge. */}
      <div className="flex min-h-full">
        {fitted && (
          <div
            className={cn(
              "relative m-auto shrink-0 overflow-hidden",
              mobile ? "rounded-[28px] ring-1 ring-border" : "rounded-lg ring-1 ring-border",
              !zoom && "shadow-xl",
            )}
            style={{ width, aspectRatio: `${block.w} / ${block.h}`, background: block.bg }}
          >
            {/* What the wall already loaded, so there is a picture at once. */}
            {!loaded && thumb && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={assetUrl(thumb)} alt="" aria-hidden className="absolute inset-0 h-full w-full object-cover object-top" />
            )}
            {!loaded && !thumb && <div className="shimmer absolute inset-0 opacity-70" aria-hidden />}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              ref={image}
              src={assetUrl(block.src)}
              alt={`${labelFor(block.typeHint)} block from ${block.host}, ${block.viewport}`}
              width={block.w}
              height={block.h}
              decoding="async"
              fetchPriority="high"
              onLoad={() => setLoaded(true)}
              onClick={(e) => canZoom && toggleZoom(e)}
              className={cn(
                "relative block h-full w-full transition-opacity duration-200",
                loaded ? "opacity-100" : "opacity-0",
                canZoom && (zoom ? "cursor-zoom-out" : "cursor-zoom-in"),
              )}
            />
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The screenshot's width in the room. Fitted whole when that leaves it
 * readable; a tall block that would shrink to a sliver is drawn at a readable
 * width instead and scrolls. Never wider than captured: the capture is 2x, so
 * up to its own width it is sharp on any screen.
 */
function fit(block: Block, room: { w: number; h: number }): { w: number } {
  const cap = Math.min(block.w, room.w);
  const whole = Math.min(cap, (room.h / block.h) * block.w);
  const readable = block.viewport === "mobile" ? Math.min(cap, 340) : Math.min(cap, room.w * 0.6);
  return { w: Math.max(1, Math.round(Math.max(whole, readable))) };
}

function Arrow({ side, onClick }: { side: "left" | "right"; onClick?: () => void }) {
  if (!onClick) return null;
  const Icon = side === "left" ? ArrowLeft : ArrowRight;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={side === "left" ? "Previous block" : "Next block"}
      className={cn(
        "absolute top-1/2 z-10 inline-flex size-10 -translate-y-1/2 items-center justify-center rounded-full border bg-card/90 text-foreground shadow-md backdrop-blur outline-none transition-colors duration-150 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring min-[700px]:size-11",
        side === "left" ? "left-2 min-[700px]:left-5" : "right-2 min-[700px]:right-5",
      )}
    >
      <Icon className="size-5" />
    </button>
  );
}

function FoundIn({ label, title, onClick }: { label: string; title: string; onClick?: () => void }) {
  if (!onClick) return <span className="max-w-40 truncate rounded-lg bg-muted px-2.5 py-1 font-medium">{label}</span>;
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="max-w-40 truncate rounded-lg bg-muted px-2.5 py-1 font-medium outline-none transition-colors duration-150 hover:bg-[color-mix(in_oklch,var(--muted),var(--foreground)_8%)] focus-visible:ring-2 focus-visible:ring-ring touch:py-2.5"
    >
      {label}
    </button>
  );
}

/** Briefly says "Copied" (or that it could not) after a clipboard write. */
function useFlash(): [string | null, (job: () => Promise<void>) => void] {
  const [state, setState] = useState<string | null>(null);
  useEffect(() => {
    if (!state) return;
    const timer = window.setTimeout(() => setState(null), 1800);
    return () => window.clearTimeout(timer);
  }, [state]);
  const run = useCallback(
    (job: () => Promise<void>) =>
      job().then(
        () => setState("Copied"),
        () => setState("Could not copy"),
      ),
    [],
  );
  return [state, run];
}

function CopyImage({ block }: { block: Block }) {
  const [state, run] = useFlash();
  return (
    <>
      <Button
        variant="secondary"
        className="h-10 rounded-full px-5 text-[14px] touch:h-11"
        onClick={() => run(() => copyImage(assetUrl(block.src)))}
      >
        {state === "Copied" ? <Check /> : <Copy />}
        {state ?? "Copy"}
      </Button>
      <span className="sr-only" aria-live="polite">
        {state ?? ""}
      </span>
    </>
  );
}

function CopyLink() {
  const [state, run] = useFlash();
  return (
    <button
      type="button"
      onClick={() => run(() => navigator.clipboard.writeText(window.location.href))}
      aria-label={state ?? "Copy link"}
      title={state ?? "Copy link"}
      className="inline-flex size-9 items-center justify-center rounded-lg text-muted-foreground outline-none transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring touch:size-11"
    >
      {state === "Copied" ? <Check className="size-[18px]" /> : <Link2 className="size-[18px]" />}
    </button>
  );
}

/** The "…" menu: the less common actions. */
function More({ block, site }: { block: Block; site: boolean }) {
  const [open, setOpen] = useState(false);
  const [state, run] = useFlash();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    // Capture phase: Escape closes the menu, not the viewer behind it.
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", down);
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("pointerdown", down);
      document.removeEventListener("keydown", key, true);
    };
  }, [open]);

  const item =
    "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[13px] outline-none transition-colors duration-150 hover:bg-muted focus-visible:bg-muted [&_svg]:size-4 [&_svg]:text-muted-foreground";

  return (
    <div ref={ref} className="relative">
      <Button
        variant="secondary"
        size="icon"
        className="size-10 rounded-full touch:size-11"
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <MoreHorizontal />
      </Button>
      {open && (
        <div role="menu" className="absolute bottom-full left-1/2 z-20 mb-2 w-52 -translate-x-1/2 rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg">
          <button type="button" role="menuitem" className={item} onClick={() => run(() => navigator.clipboard.writeText(window.location.href))}>
            {state === "Copied" ? <Check /> : <Link2 />}
            {state ?? "Copy link"}
          </button>
          <a role="menuitem" href={block.pageUrl} target="_blank" rel="noopener noreferrer" className={item} onClick={() => setOpen(false)}>
            <ExternalLink />
            Open source page
          </a>
          {site && (
            <Link role="menuitem" href={`/sites/${encodeURIComponent(block.host)}`} className={item}>
              <Store />
              View {block.host}
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

function SimilarCard({ block, onOpen }: { block: Block; onOpen: (b: Block) => void }) {
  const mobile = block.viewport === "mobile";
  const thumb = thumbOf(block);
  const [full, setFull] = useState(false);
  return (
    <button
      type="button"
      onClick={() => onOpen(block)}
      className="group block w-full overflow-hidden rounded-xl border border-white/10 bg-card text-left outline-none transition-colors duration-150 hover:border-primary/60 focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={`${labelFor(block.typeHint)} block from ${block.host}`}
    >
      <div className="overflow-hidden" style={{ aspectRatio: mobile ? "9 / 16" : "16 / 10", background: block.bg }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={assetUrl(!full && thumb ? thumb : block.src)}
          alt=""
          loading="lazy"
          decoding="async"
          onError={thumb && !full ? () => setFull(true) : undefined}
          className="block h-full w-full object-cover object-top"
        />
      </div>
      <span className="flex items-center gap-2 px-3 py-2 text-[12px]">
        <StoreIcon host={block.host} brand={block.host} size={18} />
        <span className="truncate text-muted-foreground">{block.host}</span>
      </span>
    </button>
  );
}
