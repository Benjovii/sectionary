"use client";

import { useState } from "react";
import { Monitor, Smartphone } from "lucide-react";
import { cn } from "@/lib/utils";
import { assetUrl } from "@/lib/data-source";
import { blurOf, labelFor, thumbOf, type Block } from "@/lib/blocks";
import { PREVIEW_BLUR, usePreviewOnly } from "@/lib/account";

/**
 * A block on the wall. The frame reserves the block's exact aspect ratio and
 * paints its real background colour, so nothing shifts when the screenshot
 * arrives; the shimmer runs until then and the image fades in over 150 ms.
 *
 * On the virtualised wall the height is already known (see lib/wall-layout.ts),
 * so it is passed in and the card fills it exactly rather than deriving its own
 * aspect ratio. That keeps the rendered card and the computed layout identical,
 * which is what stops the wall drifting as you scroll. Every card in a row has
 * the same height, so a screenshot taller than its cell is cropped from the
 * top and a shorter one is shown whole, centred on its background colour
 * (`fit`, decided by the layout).
 */
export function BlockCard({
  block,
  onOpen,
  width,
  height,
  fit = "cover",
}: {
  block: Block;
  onOpen: (b: Block) => void;
  /** The card's width on the wall, which tells the browser which image to fetch. */
  width?: number;
  height?: number;
  fit?: "cover" | "contain";
}) {
  const [loaded, setLoaded] = useState(false);
  // The thumbnail first (see thumbOf); the full screenshot if it will not load.
  const [full, setFull] = useState(false);
  const thumb = full ? undefined : thumbOf(block);
  const mobile = block.viewport === "mobile";
  const fixed = height != null;
  const blur = blurOf(block);
  // Signed out, or Free after the trial (gates on): a blurred preview; opening the block shows it in full.
  const preview = usePreviewOnly();
  // Thumbnail or full capture, the browser's choice (see srcSetOf). A blurred
  // preview never needs the full capture.
  const srcSet = thumb && !preview ? srcSetOf(block, thumb) : undefined;
  const fitClass = fit === "contain" ? "object-contain object-center" : "object-cover object-top";
  // A phone-width cell has no room for the host as well; the label and size stay.
  const narrow = width != null && width < 220;
  return (
    <figure
      className={cn(
        "group relative overflow-hidden rounded-lg border bg-card transition-colors duration-150 hover:border-primary/60",
        fixed ? "flex h-full flex-col" : mobile && "mx-auto max-w-[300px]",
      )}
    >
      {/* The button's ::after stretches over the whole card, caption included,
          so a 26px-tall header block is still a full-size tap target. The
          focus ring is drawn on that layer too, round the whole card. */}
      <button
        type="button"
        onClick={() => onOpen(block)}
        className={cn(
          "block w-full cursor-zoom-in outline-none after:absolute after:inset-0 after:z-10 after:rounded-lg focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-inset",
          fixed && "min-h-0 flex-1",
        )}
        aria-label={`${labelFor(block.typeHint)} block from ${block.host}, ${block.viewport}`}
      >
        <div
          className="relative h-full w-full overflow-hidden"
          style={fixed ? { background: block.bg } : { aspectRatio: `${block.w} / ${block.h}`, background: block.bg }}
        >
          {/* The placeholder: a real blur when SEC-9 ships one, the captured
              background colour until then, with the shimmer over it. Both sit
              inside the card's reserved box, so none of this moves anything. */}
          {!loaded && (
            <>
              {blur && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={blur} alt="" aria-hidden className={cn("absolute inset-0 h-full w-full scale-105 blur-lg", fitClass)} />
              )}
              <div className="shimmer absolute inset-0 opacity-70" aria-hidden />
            </>
          )}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={assetUrl(thumb ?? block.src)}
            srcSet={srcSet}
            sizes={srcSet && width ? `${Math.round(width * SIZES_FACTOR)}px` : undefined}
            alt=""
            width={block.w}
            height={block.h}
            loading="lazy"
            decoding="async"
            onLoad={() => setLoaded(true)}
            onError={thumb ? () => setFull(true) : undefined}
            className={cn(
              // Blur to sharp rather than a plain fade, so the screenshot
              // resolves into place. Filter and opacity only: no layout.
              "block h-full w-full transition-[opacity,filter] duration-150",
              fitClass,
              loaded ? "opacity-100 blur-0" : "opacity-0 blur-md",
              preview && PREVIEW_BLUR,
            )}
          />
        </div>
      </button>
      <figcaption
        className={cn(
          "flex cursor-zoom-in items-center gap-1.5 px-2.5 text-[11px] text-muted-foreground",
          fixed ? "h-8 shrink-0" : "py-2",
        )}
      >
        <span className="truncate font-medium text-foreground">{labelFor(block.typeHint)}</span>
        {!narrow && <span className="truncate">{block.host}</span>}
        <span className="ml-auto inline-flex shrink-0 items-center gap-1 font-mono tabular-nums">
          {mobile ? <Smartphone className="size-3" aria-label="Mobile" /> : <Monitor className="size-3" aria-label="Desktop" />}
          {block.h}px
        </span>
      </figcaption>
    </figure>
  );
}

/**
 * The thumbnail is 600 pixels wide; the full capture is 2x the block's width
 * (2,880 on desktop). Offered both, the browser fetches the thumbnail while a
 * card is small and the full capture once the page is zoomed in or the card
 * is drawn wider, which is when the thumbnail went blurry.
 */
function srcSetOf(block: Block, thumb: string): string {
  return `${assetUrl(thumb)} 600w, ${assetUrl(block.src)} ${block.w * 2}w`;
}

/**
 * `sizes` is declared a little under the card's real width. A wall card is
 * 300 to 340 pixels, so on a 2x screen the 600px thumbnail is 1.75 to 2 image
 * pixels per CSS pixel, which reads sharp; without the margin the browser
 * would skip it for the full capture on every retina screen, at several times
 * the bytes. At 110% zoom and up it takes the full capture.
 */
const SIZES_FACTOR = 0.85;

/**
 * The same frame with nothing in it, for loading states. `fill` takes its
 * cell's full width with the wall's fixed caption height, as on the grid.
 */
export function BlockCardSkeleton({ ratio, mobile, fill }: { ratio: number; mobile?: boolean; fill?: boolean }) {
  return (
    <div className={cn("overflow-hidden rounded-lg border bg-card", mobile && !fill && "mx-auto max-w-[300px]")} aria-hidden>
      <div className="shimmer w-full bg-muted" style={{ aspectRatio: `1 / ${ratio}` }} />
      <div className={cn("flex items-center gap-2 px-2.5", fill ? "h-8" : "py-2")}>
        <div className="shimmer h-3 w-20 rounded bg-muted" />
        <div className="shimmer h-3 w-24 rounded bg-muted" />
        <div className="shimmer ml-auto h-3 w-10 rounded bg-muted" />
      </div>
    </div>
  );
}
