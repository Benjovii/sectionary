"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { ExternalLink, Lock, RectangleVertical, Rows3, X } from "lucide-react";
import { StoreIcon } from "@/components/store-icon";
import { INSET } from "@/components/block-viewer";
import { ViewportSwitch } from "@/components/viewport-switch";
import { useViewCheck, ViewLimitPanel } from "@/components/view-limit";
import { useAccess } from "@/lib/account";
import { assetUrl } from "@/lib/data-source";
import { cn } from "@/lib/utils";
import { labelFor, PAGE_TYPE_LABEL, type Block } from "@/lib/blocks";
import type { ProfilePage } from "@/lib/site-profile";
import type { Viewport } from "@/contracts/block";

/** How a site's page is open: the whole page in one scroll, or one block at a time. */
export type PageMode = "page" | "blocks";

export type PageBlocks = { desktop: Block[]; mobile: Block[] };

/** A phone's width: the mobile capture is drawn no wider than this. */
const PHONE_W = 390;

const MODES: { value: PageMode; label: string; icon: typeof Rows3 }[] = [
  { value: "page", label: "Full page", icon: RectangleVertical },
  { value: "blocks", label: "Blocks", icon: Rows3 },
];

/**
 * Full page or block by block, as one pill, the same shape as the Web / Mobile
 * switch beside it. Below `sm` the labels drop and the icons stay.
 */
export function PageModeSwitch({ value, onChange, className }: { value: PageMode; onChange: (mode: PageMode) => void; className?: string }) {
  return (
    <div
      role="radiogroup"
      aria-label="Show the page"
      className={cn("inline-flex shrink-0 rounded-full border bg-muted/60 p-1", className)}
      onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        // Arrows switch here and stop: the block viewer listens for them to step blocks.
        event.preventDefault();
        event.stopPropagation();
        const next = value === "page" ? "blocks" : "page";
        onChange(next);
        (event.currentTarget.querySelector(`[data-value="${next}"]`) as HTMLElement | null)?.focus();
      }}
    >
      {MODES.map(({ value: mode, label, icon: Icon }) => {
        const on = mode === value;
        return (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={label}
            title={label}
            data-value={mode}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(mode)}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-[12px] font-medium transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring touch:h-11",
              on ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="size-3.5" aria-hidden />
            <span className="hidden sm:inline">{label}</span>
          </button>
        );
      })}
    </div>
  );
}

type PageViewerProps = {
  /** The page to show; null keeps the window closed. */
  page: ProfilePage | null;
  /** Its blocks per viewport; null while they load. */
  blocks: PageBlocks | null;
  viewport: Viewport;
  onViewport: (viewport: Viewport) => void;
  /** Open block `at` of the shown viewport, block by block. */
  onBlock: (at: number) => void;
  onMode: (mode: PageMode) => void;
  /** The block to bring into view on opening: the one the Blocks view was on. */
  focus: number;
  onClose: () => void;
};

/**
 * A site's page, whole: every block of it stacked in page order, the way the
 * page reads in a browser, in the same window the block viewer uses. Web shows
 * the desktop capture at its own width (or the window's, if narrower), Mobile
 * the phone capture in a phone-shaped frame. A click on a block opens it in
 * the block viewer, and the Full page / Blocks switch moves between the two.
 *
 * Without blocks (an API page whose blocks have not been split out), the
 * full-page screenshot stands in, when there is one.
 */
export function PageViewer({ page, blocks, onClose, ...rest }: PageViewerProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const show = Boolean(page);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (show && !d.open) d.showModal();
    if (!show && d.open) d.close();
  }, [show]);

  // Opening a page counts as opening its first block, against the Free plan's
  // daily cap: the whole page is the blocks in full.
  const first = blocks ? (blocks.desktop[0] ?? blocks.mobile[0] ?? null) : null;
  const check = useViewCheck(page && first ? first.id : null);
  const limited = check?.allowed === false;

  return (
    <dialog
      ref={ref}
      aria-label={page ? `${PAGE_TYPE_LABEL[page.type] ?? page.type} page from ${new URL(page.url).host}` : "Page"}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="m-0 h-dvh max-h-dvh w-screen max-w-none overflow-hidden overscroll-contain bg-transparent p-0 backdrop:bg-black/75 backdrop:backdrop-blur-sm"
    >
      {page && limited && check ? (
        <div className="flex min-h-dvh items-center justify-center p-4" onClick={(e) => e.target === e.currentTarget && onClose()}>
          <ViewLimitPanel check={check} onClose={onClose} />
        </div>
      ) : page ? (
        <Window key={page.key} page={page} blocks={blocks} onClose={onClose} {...rest} />
      ) : null}
    </dialog>
  );
}

function Window({
  page,
  blocks,
  viewport: wanted,
  onViewport,
  onBlock,
  onMode,
  focus,
  onClose,
}: Omit<PageViewerProps, "page"> & { page: ProfilePage }) {
  const host = new URL(page.url).host;
  const path = page.url.replace(/^https?:\/\/[^/]+/, "") || "/";
  const pageLabel = PAGE_TYPE_LABEL[page.type] ?? page.type;
  const access = useAccess();

  // Which viewports have something to show: blocks, or a full-page shot.
  const has = {
    desktop: Boolean(blocks?.desktop.length || page.desktop),
    mobile: Boolean(blocks?.mobile.length || page.mobile),
  };
  const viewport: Viewport = has[wanted] || !blocks ? wanted : wanted === "desktop" ? "mobile" : "desktop";
  const list = blocks?.[viewport] ?? [];
  const both = has.desktop && has.mobile;

  const switches = (
    <>
      <PageModeSwitch value="page" onChange={onMode} />
      {both && <ViewportSwitch value={viewport} onChange={onViewport} size="sm" />}
    </>
  );

  return (
    <div className={cn("relative flex h-dvh flex-col bg-card text-card-foreground shadow-2xl min-[700px]:rounded-2xl min-[700px]:border", INSET)}>
      <header className="flex h-14 shrink-0 items-center gap-3 px-3 min-[700px]:h-16 min-[700px]:px-5">
        <div className="flex min-w-0 items-center gap-2.5">
          <StoreIcon host={host} brand={host} size={34} className="rounded-lg" />
          <span className="flex min-w-0 flex-col leading-tight">
            <span className="truncate font-heading text-[17px] font-semibold min-[700px]:text-[19px]">{pageLabel}</span>
            <span className="truncate font-mono text-[11px] text-muted-foreground">
              {host}
              {path === "/" ? "" : path}
            </span>
          </span>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <div className="mr-2 hidden items-center gap-2 sm:flex">{switches}</div>
          {access.can("source-link") ? (
            <a
              href={page.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Open the source page"
              title="Open the source page"
              className="inline-flex size-9 items-center justify-center rounded-lg text-muted-foreground outline-none transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring touch:size-11"
            >
              <ExternalLink className="size-[18px]" />
            </a>
          ) : (
            <Link
              href="/account"
              aria-label="The source page link comes with Pro"
              title="The source page link comes with Pro"
              className="inline-flex size-9 items-center justify-center rounded-lg text-muted-foreground outline-none transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring touch:size-11"
            >
              <Lock className="size-4" />
            </Link>
          )}
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

      <div className="flex justify-center gap-2 pb-2 sm:hidden">{switches}</div>

      <div className="relative flex min-h-0 flex-1 flex-col border-t">
        <FullPage key={viewport} page={page} blocks={blocks ? list : null} viewport={viewport} focus={focus} onBlock={onBlock} />

        <footer className="flex shrink-0 items-center justify-between gap-3 border-t px-3 py-3 text-[13px] min-[700px]:px-5">
          <span className="truncate text-muted-foreground">
            {viewport === "mobile" ? "Mobile" : "Desktop"}
            {list[0] && <span className="font-mono text-[12px] tabular-nums"> ({list[0].w} wide)</span>}
          </span>
          {list.length > 0 && (
            <span className="flex shrink-0 items-center gap-3">
              <span className="hidden text-muted-foreground sm:inline">Click a block to open it</span>
              <span className="font-mono text-[12px] text-muted-foreground tabular-nums">
                {list.length} block{list.length === 1 ? "" : "s"}
              </span>
            </span>
          )}
        </footer>
      </div>
    </div>
  );
}

/**
 * The page in one scroll: its blocks top to bottom, each a button into the
 * block viewer. The full-page screenshot when there are no blocks; a shimmer
 * the shape of a page while they load.
 */
function FullPage({
  page,
  blocks,
  viewport,
  focus,
  onBlock,
}: {
  page: ProfilePage;
  blocks: Block[] | null;
  viewport: Viewport;
  focus: number;
  onBlock: (at: number) => void;
}) {
  const mobile = viewport === "mobile";
  const scroller = useRef<HTMLDivElement>(null);
  const native = blocks?.[0]?.w ?? (mobile ? PHONE_W : 1440);
  const width = mobile ? Math.min(native, PHONE_W) : native;
  const shot = page[viewport];

  // Back from the Blocks view: bring the block it was on into view. Instant,
  // since the page has only just been drawn.
  const ready = Boolean(blocks?.length);
  useEffect(() => {
    if (!ready || focus <= 0) return;
    const el = scroller.current?.querySelector(`[data-at="${focus}"]`);
    el?.scrollIntoView({ block: "center" });
  }, [ready, focus]);

  return (
    <div ref={scroller} className="min-h-0 flex-1 overflow-auto bg-muted/40 px-3 py-4 min-[700px]:px-10 min-[700px]:py-8 [scrollbar-width:thin]">
      <div
        className={cn(
          "mx-auto overflow-hidden bg-background shadow-xl",
          mobile ? "rounded-[28px] ring-1 ring-border" : "rounded-lg ring-1 ring-border",
        )}
        style={{ width: `min(100%, ${width}px)` }}
      >
        {blocks === null ? (
          <div className="shimmer bg-muted" style={{ aspectRatio: mobile ? "9 / 19" : "16 / 20" }} aria-busy="true" aria-label="Loading the page" />
        ) : blocks.length > 0 ? (
          <ol aria-label="Blocks on this page">
            {blocks.map((block, i) => (
              <li key={block.id}>
                <button
                  type="button"
                  data-at={i}
                  onClick={() => onBlock(i)}
                  aria-label={`${labelFor(block.typeHint)}, block ${i + 1} of ${blocks.length}: open it`}
                  className="group relative block w-full cursor-zoom-in outline-none"
                  style={{ aspectRatio: `${block.w} / ${block.h}`, background: block.bg }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={assetUrl(block.src)}
                    alt=""
                    width={block.w}
                    height={block.h}
                    loading={i < 3 ? "eager" : "lazy"}
                    decoding="async"
                    className="block h-full w-full"
                  />
                  {/* Which block a click opens: an outline and its name. */}
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-0 opacity-0 ring-2 ring-primary ring-inset transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
                  >
                    <span className="absolute top-2 left-2 rounded-full bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground shadow-sm">
                      {labelFor(block.typeHint)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ol>
        ) : shot ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={assetUrl(shot)} alt={`${PAGE_TYPE_LABEL[page.type] ?? page.type} page, ${viewport}`} className="block w-full" />
        ) : (
          <p className="p-8 text-center text-[13px] text-muted-foreground">Nothing captured at this viewport.</p>
        )}
      </div>
    </div>
  );
}
