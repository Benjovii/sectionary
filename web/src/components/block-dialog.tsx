"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  Link2,
  Monitor,
  Smartphone,
  Maximize2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { BriefPanel } from "@/components/brief-panel";
import { SaveToBoard } from "@/components/save-to-board";
import { TimeMachineControls, TimeMachineStage, useTimeMachine } from "@/components/time-machine";
import { cn } from "@/lib/utils";
import { assetUrl } from "@/lib/data-source";
import { labelFor, PAGE_TYPE_LABEL, type Block } from "@/lib/blocks";
import { platformLabel } from "@/lib/stores";
import { bucketFor, COLOUR_LABEL } from "@/lib/colour";
import { countOf, type TechCounts, type TechKey } from "@/lib/tech";
import { capturedAtOf, capturesOf, counterpartOf, similarTo, type DetailIndex } from "@/lib/block-detail";

type View = "both" | "desktop" | "mobile";

type Tab = "details" | "brief" | "history";
const TABS: [Tab, string][] = [
  ["details", "Details"],
  ["brief", "Copy as brief"],
  ["history", "Time machine"],
];

type TechProps = {
  /** Library-wide block counts per platform, theme and app, shown on the tech-stack chips. */
  counts?: TechCounts | null;
  /** When given, a tech-stack chip filters the wall to that platform, theme or app. */
  onFilter?: (key: TechKey, value: string) => void;
};

/** From here up the panel is centred and both viewports sit side by side. */
const WIDE = "(min-width: 900px)";

/**
 * Block detail (SEC-18): full-screen sheet on phones, centred panel from 900px.
 *
 * The URL owns which block is open (`?open=<id>`, see the wall), so every
 * detail view is a link and Back closes it. This component only renders what
 * it is handed and reports what the person asked for.
 */
export function BlockDialog({
  block,
  missing,
  detail,
  onClose,
  onOpen,
  onStep,
  counts = null,
  onFilter,
}: {
  block: Block | null;
  /** The URL names a block the loaded set does not have. */
  missing: boolean;
  detail: DetailIndex | null;
  onClose: () => void;
  /** Show another block in place: a similar block, or the other viewport. */
  onOpen: (block: Block) => void;
  /** Previous and next on the wall; absent when this block is not on it. */
  onStep: { prev?: () => void; next?: () => void };
} & TechProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const show = Boolean(block || missing);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (show && !d.open) d.showModal();
    if (!show && d.open) d.close();
  }, [show]);

  // Arrow keys walk the wall, as they do in every gallery. Not while typing,
  // and not with a modifier, so browser shortcuts keep working.
  useEffect(() => {
    if (!block) return;
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
  }, [block, onStep]);

  return (
    <dialog
      ref={ref}
      aria-label={block ? `${labelFor(block.typeHint)} block from ${block.host}` : "Block"}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="m-0 h-dvh max-h-dvh w-screen max-w-none bg-transparent p-0 backdrop:bg-black/70 open:flex open:items-stretch open:justify-center min-[900px]:open:items-center min-[900px]:p-6"
    >
      {block && detail ? (
        <Detail key={block.id} block={block} detail={detail} onClose={onClose} onOpen={onOpen} onStep={onStep} counts={counts} onFilter={onFilter} />
      ) : missing ? (
        <div className="m-auto flex max-w-sm flex-col items-center gap-3 rounded-xl border bg-card p-8 text-center text-card-foreground">
          <p className="text-foreground">This block is not in the loaded set.</p>
          <p className="text-[12px] text-muted-foreground">It may come from a newer capture than the one this page is reading.</p>
          <Button variant="outline" size="sm" onClick={onClose}>
            Back to the wall
          </Button>
        </div>
      ) : null}
    </dialog>
  );
}

function Detail({
  block,
  detail,
  onClose,
  onOpen,
  onStep,
  counts,
  onFilter,
}: {
  block: Block;
  detail: DetailIndex;
  onClose: () => void;
  onOpen: (block: Block) => void;
  onStep: { prev?: () => void; next?: () => void };
} & TechProps) {
  const [tab, setTab] = useState<Tab>("details");
  const tm = useTimeMachine(block);
  const pair = useMemo(() => counterpartOf(detail, block), [detail, block]);
  const similar = useMemo(() => similarTo(detail, block), [detail, block]);
  const captures = useMemo(() => capturesOf(detail, block), [detail, block]);

  // Which capture is on screen. The newest by default; the strip below the
  // metadata steps back through the rest.
  const [captureAt, setCaptureAt] = useState(captures.length - 1);
  const shown = captures[captureAt] ?? block;

  const desktop = shown.viewport === "desktop" ? shown : pair?.viewport === "desktop" ? pair : null;
  const mobile = shown.viewport === "mobile" ? shown : pair?.viewport === "mobile" ? pair : null;

  // Side by side when there is room and a pair to show; otherwise the viewport
  // that was opened. Read once, on open: the choice is the person's after that.
  const [view, setView] = useState<View>(() =>
    pair && typeof window !== "undefined" && window.matchMedia(WIDE).matches ? "both" : shown.viewport,
  );
  // The screenshot shown full screen over everything, if any.
  const [expanded, setExpanded] = useState<Block | null>(null);
  const collapse = useCallback(() => setExpanded(null), []);

  // The block the metadata describes: the one opened, unless the person
  // switched to its other viewport.
  const focus = view === "both" ? shown : view === "desktop" ? (desktop ?? shown) : (mobile ?? shown);
  const bucket = bucketFor(focus.bg);
  const pageLabel = PAGE_TYPE_LABEL[focus.pageType] ?? focus.pageType;

  // Back to the top of the stage when the block changes under a kept-open sheet.
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
  }, [block.id]);

  return (
    <div className="flex h-dvh w-full flex-col overflow-hidden bg-card text-card-foreground min-[900px]:h-[92vh] min-[900px]:max-w-[1400px] min-[900px]:rounded-xl min-[900px]:border">
      <header className="flex h-12 shrink-0 items-center gap-1 border-b px-2 min-[900px]:px-3">
        <Button variant="ghost" size="icon" aria-label="Close" onClick={onClose}>
          <X />
        </Button>
        <div className="min-w-0 flex-1 px-1">
          <h2 className="truncate font-heading text-[15px] leading-tight font-semibold">{labelFor(focus.typeHint)}</h2>
          <p className="truncate text-[11px] text-muted-foreground">
            {focus.host} · {pageLabel}
          </p>
        </div>
        <Button variant="ghost" size="icon" aria-label="Previous block" disabled={!onStep.prev} onClick={onStep.prev}>
          <ChevronLeft />
        </Button>
        <Button variant="ghost" size="icon" aria-label="Next block" disabled={!onStep.next} onClick={onStep.next}>
          <ChevronRight />
        </Button>
      </header>

      <div ref={scroller} className="min-h-0 flex-1 overflow-auto min-[900px]:flex min-[900px]:overflow-hidden">
        <div className="flex min-w-0 flex-col min-[900px]:flex-1 min-[900px]:overflow-auto">
          {tab === "history" ? (
            <TimeMachineStage tm={tm} />
          ) : (
            <>
              <Toolbar view={view} setView={setView} onExpand={() => setExpanded(focus)} hasPair={Boolean(pair)} shown={shown} />
              <Stage view={view} onExpand={setExpanded} desktop={desktop} mobile={mobile} opened={shown} />
              <Similar blocks={similar} onOpen={onOpen} className="hidden min-[900px]:block" />
            </>
          )}
        </div>

        <aside className="flex flex-col border-t min-[900px]:w-[340px] min-[900px]:shrink-0 min-[900px]:overflow-auto min-[900px]:border-t-0 min-[900px]:border-l">
          <Actions block={focus} />
          <div role="tablist" aria-label="Block tools" className="flex gap-1 border-b px-3 py-1.5">
            {TABS.map(([t, l]) => (
              <button
                key={t}
                role="tab"
                type="button"
                id={`tab-${t}`}
                aria-selected={tab === t}
                aria-controls={`panel-${t}`}
                onClick={() => setTab(t)}
                className={cn(
                  "rounded-md px-2 py-1 text-[12px] text-muted-foreground outline-none transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
                  tab === t && "bg-muted text-foreground",
                )}
              >
                {l}
              </button>
            ))}
          </div>
          {tab === "brief" && (
            <div role="tabpanel" id="panel-brief" aria-labelledby="tab-brief" className="flex min-h-0 flex-1 flex-col">
              <BriefPanel block={focus} />
            </div>
          )}
          {tab === "history" && (
            <div role="tabpanel" id="panel-history" aria-labelledby="tab-history" className="flex min-h-0 flex-1 flex-col">
              <TimeMachineControls tm={tm} />
            </div>
          )}
          {tab === "details" && (
            <div role="tabpanel" id="panel-details" aria-labelledby="tab-details">
              <dl className="grid grid-cols-[88px_1fr] gap-x-3 gap-y-2.5 px-4 py-4 text-[13px]">
                <dt className="text-muted-foreground">Site</dt>
                <dd className="min-w-0">
                  <Link
                    href={`/sites/${encodeURIComponent(focus.host)}`}
                    className="block truncate underline-offset-4 hover:text-primary hover:underline"
                    title={`${focus.host}: tech stack and every captured page`}
                  >
                    {focus.host}
                  </Link>
                </dd>
                <dt className="text-muted-foreground">Page</dt>
                <dd className="min-w-0">
                  {pageLabel}
                  {focus.pageTitle && <span className="block truncate text-[12px] text-muted-foreground">{focus.pageTitle}</span>}
                </dd>
                <dt className="text-muted-foreground">Block</dt>
                <dd>{labelFor(focus.typeHint)}</dd>
                <dt className="text-muted-foreground">Style</dt>
                <dd>
                  {platformLabel(focus.platform)}
                  {focus.theme ? <span className="text-muted-foreground"> · {focus.theme}</span> : null}
                </dd>
                <dt className="text-muted-foreground">Colours</dt>
                <dd className="flex items-center gap-2">
                  <span aria-hidden className="size-4 shrink-0 rounded-full border" style={{ background: focus.bg }} />
                  <span>{bucket ? COLOUR_LABEL[bucket] : "Unknown"}</span>
                  <span className="truncate font-mono text-[11px] text-muted-foreground">{focus.bg}</span>
                </dd>
                {focus.headline && (
                  <>
                    <dt className="text-muted-foreground">Headline</dt>
                    <dd>{focus.headline}</dd>
                  </>
                )}
                <dt className="text-muted-foreground">Contains</dt>
                <dd className="text-muted-foreground">
                  {focus.buttons} buttons · {focus.images} images · {focus.videos} videos
                </dd>
                <dt className="text-muted-foreground">Size</dt>
                <dd className="font-mono text-[12px] tabular-nums">
                  {focus.w} × {focus.h}
                </dd>
              </dl>
              <TechStack block={focus} counts={counts ?? null} onFilter={onFilter} />
              <Captures captures={captures} at={captureAt} onAt={setCaptureAt} />
              <Similar blocks={similar} onOpen={onOpen} className="min-[900px]:hidden" />
            </div>
          )}
        </aside>
      </div>
      {expanded && <Expanded start={expanded} desktop={desktop} mobile={mobile} onClose={collapse} />}
    </div>
  );
}

/** Viewport switch and the expand button above the screenshots. */
function Toolbar({
  view,
  setView,
  onExpand,
  hasPair,
  shown,
}: {
  view: View;
  setView: (v: View) => void;
  onExpand: () => void;
  hasPair: boolean;
  shown: Block;
}) {
  const options: { value: View; label: string; icon?: typeof Monitor; wideOnly?: boolean }[] = [
    { value: "both", label: "Both", wideOnly: true },
    { value: "desktop", label: "Desktop", icon: Monitor },
    { value: "mobile", label: "Mobile", icon: Smartphone },
  ];
  return (
    <div className="sticky top-0 z-10 flex items-center gap-2 border-b bg-card/95 px-3 py-2 backdrop-blur">
      <div role="radiogroup" aria-label="Viewport" className="flex rounded-lg border p-0.5">
        {options.map((option) => {
          // Without a pair only the captured viewport exists, so the others are
          // shown but disabled: the absence is information.
          const available = hasPair || option.value === shown.viewport;
          const Icon = option.icon;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={view === option.value}
              disabled={!available}
              onClick={() => setView(option.value)}
              className={cn(
                "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12px] font-medium transition-colors duration-150 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-40",
                option.wideOnly && "hidden min-[900px]:inline-flex",
                view === option.value ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {Icon && <Icon className="size-3.5" />}
              {option.label}
            </button>
          );
        })}
      </div>
      {!hasPair && (
        <span className="hidden text-[11px] text-muted-foreground sm:inline">
          No {shown.viewport === "desktop" ? "mobile" : "desktop"} match on this page
        </span>
      )}
      <Button variant="ghost" size="sm" className="ml-auto" onClick={onExpand}>
        <Maximize2 />
        Expand
      </Button>
    </div>
  );
}

/** The screenshots, each fitted to its column. Clicking one expands it. */
function Stage({
  view,
  onExpand,
  desktop,
  mobile,
  opened,
}: {
  view: View;
  onExpand: (block: Block) => void;
  desktop: Block | null;
  mobile: Block | null;
  opened: Block;
}) {
  const showDesktop = desktop && (view === "both" || view === "desktop");
  const showMobile = mobile && (view === "both" || view === "mobile");
  const both = Boolean(showDesktop && showMobile);
  return (
    <div className={cn("flex gap-4 bg-muted/40 p-3 min-[900px]:p-4", both ? "items-start" : "justify-center")}>
      {showDesktop && (
        <Shot block={desktop} onExpand={onExpand} highlight={both && opened.id === desktop.id} className={both ? "min-w-0 flex-[3]" : "w-full"} />
      )}
      {showMobile && (
        <Shot
          block={mobile}
          onExpand={onExpand}
          highlight={both && opened.id === mobile.id}
          className={both ? "min-w-[180px] flex-1" : "w-full max-w-[390px]"}
        />
      )}
    </div>
  );
}

function Shot({
  block,
  onExpand,
  highlight,
  className,
}: {
  block: Block;
  onExpand: (block: Block) => void;
  highlight: boolean;
  className?: string;
}) {
  const [loaded, setLoaded] = useState(false);
  return (
    <figure className={cn("flex flex-col gap-1.5", className)}>
      <figcaption className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        {block.viewport === "mobile" ? <Smartphone className="size-3" /> : <Monitor className="size-3" />}
        <span className={cn(highlight && "font-medium text-foreground")}>{block.viewport === "mobile" ? "Mobile" : "Desktop"}</span>
        {/* Said in words as well as the ring, so it does not rest on colour alone. */}
        {highlight && (
          <span className="shrink-0 rounded-full bg-primary px-1.5 py-px text-[10px] font-medium whitespace-nowrap text-primary-foreground">Opened</span>
        )}
        <span className="ml-auto font-mono whitespace-nowrap tabular-nums">
          {block.w} × {block.h}
        </span>
      </figcaption>
      <div
        className={cn(
          "overflow-hidden rounded-lg border",
          // A 2px ring with a gap, so it reads against any screenshot edge.
          highlight && "border-transparent ring-2 ring-primary ring-offset-2 ring-offset-card",
        )}
      >
        <button
          type="button"
          onClick={() => onExpand(block)}
          className="relative block w-full cursor-zoom-in outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          style={{ background: block.bg, aspectRatio: `${block.w} / ${block.h}` }}
          aria-label={`Expand the ${block.viewport} screenshot`}
        >
          {!loaded && <div className="shimmer absolute inset-0 opacity-70" aria-hidden />}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={assetUrl(block.src)}
            alt={`${labelFor(block.typeHint)} block from ${block.host}, ${block.viewport}`}
            width={block.w}
            height={block.h}
            decoding="async"
            onLoad={() => setLoaded(true)}
            className={cn("block h-full w-full transition-opacity duration-150", loaded ? "opacity-100" : "opacity-0")}
          />
        </button>
      </div>
    </figure>
  );
}

/**
 * One screenshot over everything, as wide as the screen allows but never wider
 * than it was captured, so it is never upscaled into blur. Scrolls top to
 * bottom. When the block has both viewports a switch in the header flips
 * between them without leaving full screen. Escape, the close button or a
 * click on the image closes it and leaves the detail view open underneath.
 */
function Expanded({
  start,
  desktop,
  mobile,
  onClose,
}: {
  start: Block;
  desktop: Block | null;
  mobile: Block | null;
  onClose: () => void;
}) {
  const close = useRef<HTMLButtonElement>(null);
  const [viewport, setViewport] = useState(start.viewport);
  const block = (viewport === "desktop" ? desktop : mobile) ?? start;
  const both = Boolean(desktop && mobile);

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    close.current?.focus();
    // Capture phase, ahead of the dialog: Escape closes only this layer, and
    // the arrows do not step the wall behind it.
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.stopPropagation();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      before?.focus();
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${labelFor(block.typeHint)}, ${block.viewport}, full screen`}
      className="fixed inset-0 z-50 flex flex-col bg-black/95"
      onClick={onClose}
    >
      <div className="flex h-12 shrink-0 items-center gap-2 px-2 text-white">
        <Button
          ref={close}
          variant="ghost"
          size="icon"
          aria-label="Close full screen"
          className="text-white hover:bg-white/10 hover:text-white"
          onClick={onClose}
        >
          <X />
        </Button>
        {both ? (
          // Clicks here switch rather than close, so they stop at the group.
          <div role="radiogroup" aria-label="Viewport" className="flex rounded-lg border border-white/15 p-0.5" onClick={(e) => e.stopPropagation()}>
            {(["desktop", "mobile"] as const).map((v) => {
              const Icon = v === "mobile" ? Smartphone : Monitor;
              return (
                <button
                  key={v}
                  type="button"
                  role="radio"
                  aria-checked={viewport === v}
                  onClick={() => setViewport(v)}
                  className={cn(
                    "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12px] font-medium transition-colors duration-150 outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                    viewport === v ? "bg-white text-black" : "text-white/70 hover:text-white",
                  )}
                >
                  <Icon className="size-3.5" />
                  {v === "mobile" ? "Mobile" : "Desktop"}
                </button>
              );
            })}
          </div>
        ) : (
          <>
            {block.viewport === "mobile" ? <Smartphone className="size-3.5" /> : <Monitor className="size-3.5" />}
            <span className="text-[13px] font-medium">{block.viewport === "mobile" ? "Mobile" : "Desktop"}</span>
          </>
        )}
        <span className="ml-auto pr-2 font-mono text-[11px] text-white/60 tabular-nums">
          {block.w} × {block.h}
        </span>
      </div>
      <div key={block.id} className="min-h-0 flex-1 cursor-zoom-out overflow-auto px-3 pb-6 min-[900px]:px-8">
        <div className="mx-auto w-full" style={{ maxWidth: block.w, aspectRatio: `${block.w} / ${block.h}`, background: block.bg }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={assetUrl(block.src)}
            alt={`${labelFor(block.typeHint)} block from ${block.host}, ${block.viewport}`}
            width={block.w}
            height={block.h}
            className="block h-full w-full"
          />
        </div>
      </div>
    </div>
  );
}

type Status = { key: string; ok: boolean } | null;

/** Copy image, copy link, open the source page. */
function Actions({ block }: { block: Block }) {
  const [status, setStatus] = useState<Status>(null);

  useEffect(() => {
    if (!status) return;
    const timer = window.setTimeout(() => setStatus(null), 1800);
    return () => window.clearTimeout(timer);
  }, [status]);

  const run = (key: string, job: () => Promise<void>) =>
    job().then(
      () => setStatus({ key, ok: true }),
      () => setStatus({ key, ok: false }),
    );

  const label = (key: string, idle: string) =>
    status?.key === key ? (status.ok ? "Copied" : "Could not copy") : idle;

  return (
    <div className="flex flex-wrap gap-2 border-b px-4 py-3">
      <Button variant="default" size="sm" onClick={() => run("image", () => copyImage(assetUrl(block.src)))}>
        {status?.key === "image" && status.ok ? <Check /> : <Copy />}
        {label("image", "Copy image")}
      </Button>
      <Button variant="outline" size="sm" onClick={() => run("link", () => navigator.clipboard.writeText(window.location.href))}>
        {status?.key === "link" && status.ok ? <Check /> : <Link2 />}
        {label("link", "Copy link")}
      </Button>
      <SaveToBoard block={block} />
      <a
        href={block.pageUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-medium text-muted-foreground transition-colors duration-150 outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        Source page <ExternalLink className="size-3.5" />
      </a>
      <span className="sr-only" aria-live="polite">
        {status ? (status.ok ? "Copied to the clipboard" : "Could not copy") : ""}
      </span>
    </div>
  );
}

/**
 * Put the screenshot on the clipboard as a PNG, the one image type every
 * clipboard accepts. The ClipboardItem gets a promise rather than a blob so
 * Safari still sees the write as part of the click.
 */
async function copyImage(url: string): Promise<void> {
  const png = (async () => {
    const response = await fetch(url, { mode: "cors" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    if (blob.type === "image/png") return blob;
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
    bitmap.close();
    return new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not encode PNG"))), "image/png"),
    );
  })();
  await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
}

const dateFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });

/** Earlier and later captures of this block, once recapture gives it any. */
function Captures({ captures, at, onAt }: { captures: Block[]; at: number; onAt: (i: number) => void }) {
  const when = (b: Block) => {
    const iso = capturedAtOf(b);
    return iso ? dateFormat.format(new Date(iso)) : "Date unknown";
  };
  return (
    <section className="border-t px-4 py-3" aria-label="Captures">
      <div className="flex items-center gap-1">
        <h3 className="text-[12px] font-medium">Captures</h3>
        <span className="ml-1 font-mono text-[11px] text-muted-foreground tabular-nums">{captures.length}</span>
        {captures.length > 1 && (
          <div className="ml-auto flex items-center gap-1">
            <Button variant="ghost" size="icon-sm" aria-label="Earlier capture" disabled={at === 0} onClick={() => onAt(at - 1)}>
              <ChevronLeft />
            </Button>
            <span className="min-w-24 text-center text-[12px] tabular-nums">{when(captures[at])}</span>
            <Button variant="ghost" size="icon-sm" aria-label="Later capture" disabled={at === captures.length - 1} onClick={() => onAt(at + 1)}>
              <ChevronRight />
            </Button>
          </div>
        )}
      </div>
      {captures.length === 1 && (
        <p className="mt-1 text-[12px] text-muted-foreground">
          One capture so far{capturedAtOf(captures[0]) ? `, ${when(captures[0])}` : ""}. Recaptures will line up here so you can
          see how the block changed.
        </p>
      )}
    </section>
  );
}

/** Platform, theme and apps as chips with library-wide counts; a chip filters the wall to it. */
function TechStack({ block, counts, onFilter }: { block: Block; counts: TechCounts | null; onFilter?: (key: TechKey, value: string) => void }) {
  const chips: [TechKey, string, string][] = [
    ...(block.platform ? [["platform", block.platform, platformLabel(block.platform)] as [TechKey, string, string]] : []),
    ...(block.theme ? [["theme", block.theme, block.theme] as [TechKey, string, string]] : []),
    ...block.apps.map((a) => ["app", a, a] as [TechKey, string, string]),
  ];
  if (chips.length === 0) return null;
  return (
    <section aria-labelledby="tech-heading" className="border-t px-4 py-3">
      <h3 id="tech-heading" className="mb-2 text-[12px] font-medium">
        Tech stack
        {onFilter && <span className="font-normal text-muted-foreground"> · tap to see every block built with it</span>}
      </h3>
      <ul className="flex flex-wrap gap-1.5">
        {chips.map(([key, value, label]) => {
          const n = countOf(counts, key, value);
          const inner = (
            <>
              <span className="text-muted-foreground">{key === "app" ? "" : key === "platform" ? "Platform " : "Theme "}</span>
              {label}
              {n !== null && <span className="font-mono text-[10px] tabular-nums text-muted-foreground">{n.toLocaleString("en-US")}</span>}
            </>
          );
          const cls = "inline-flex items-center gap-1 rounded-full border bg-muted/50 px-2 py-0.5 text-[12px]";
          return (
            <li key={`${key}:${value}`}>
              {onFilter ? (
                <button
                  type="button"
                  onClick={() => onFilter(key, value)}
                  aria-label={`Show ${n ?? "all"} blocks with ${label}`}
                  className={cn(cls, "outline-none transition-colors duration-150 hover:border-primary/60 hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50")}
                >
                  {inner}
                </button>
              ) : (
                <span className={cls}>{inner}</span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** "More like this": the same kind of block from other stores. */
function Similar({ blocks, onOpen, className }: { blocks: Block[]; onOpen: (b: Block) => void; className?: string }) {
  if (blocks.length === 0) return null;
  const mobile = blocks[0].viewport === "mobile";
  return (
    <section className={cn("border-t px-3 py-4 min-[900px]:px-4", className)} aria-label="Similar blocks">
      <h3 className="mb-2.5 px-1 text-[12px] font-medium min-[900px]:px-0">More like this</h3>
      <ul className={cn("grid gap-2.5", mobile ? "grid-cols-3 min-[900px]:grid-cols-6" : "grid-cols-2 min-[900px]:grid-cols-4")}>
        {blocks.map((b) => (
          <li key={b.id}>
            <button
              type="button"
              onClick={() => onOpen(b)}
              className="group block w-full overflow-hidden rounded-lg border bg-card text-left transition-colors duration-150 outline-none hover:border-primary/60 focus-visible:ring-3 focus-visible:ring-ring/50"
              aria-label={`${labelFor(b.typeHint)} block from ${b.host}`}
            >
              <div className="overflow-hidden" style={{ aspectRatio: mobile ? "9 / 14" : "16 / 10", background: b.bg }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={assetUrl(b.src)} alt="" loading="lazy" decoding="async" className="block h-full w-full object-cover object-top" />
              </div>
              <span className="block truncate px-2 py-1.5 text-[11px] text-muted-foreground">{b.host}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
