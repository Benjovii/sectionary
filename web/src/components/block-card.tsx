"use client";

import { useState } from "react";
import { Monitor, Smartphone } from "lucide-react";
import { cn } from "@/lib/utils";
import { assetUrl } from "@/lib/data-source";
import { blurOf, labelFor, type Block } from "@/lib/blocks";

/**
 * A block on the wall. The frame reserves the block's exact aspect ratio and
 * paints its real background colour, so nothing shifts when the screenshot
 * arrives; the shimmer runs until then and the image fades in over 150 ms.
 *
 * On the virtualised wall the height is already known (see lib/wall-layout.ts),
 * so it is passed in and the card fills it exactly rather than deriving its own
 * aspect ratio. That keeps the rendered card and the computed layout identical,
 * which is what stops the wall drifting as you scroll.
 */
export function BlockCard({ block, onOpen, height }: { block: Block; onOpen: (b: Block) => void; height?: number }) {
  const [loaded, setLoaded] = useState(false);
  const mobile = block.viewport === "mobile";
  const fixed = height != null;
  const blur = blurOf(block);
  return (
    <figure
      className={cn(
        "group overflow-hidden rounded-lg border bg-card transition-colors duration-150 hover:border-primary/60",
        fixed ? "flex h-full flex-col" : mobile && "mx-auto max-w-[300px]",
      )}
    >
      <button
        type="button"
        onClick={() => onOpen(block)}
        className={cn(
          "block w-full cursor-zoom-in outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
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
                <img src={blur} alt="" aria-hidden className="absolute inset-0 h-full w-full scale-105 object-cover object-top blur-lg" />
              )}
              <div className="shimmer absolute inset-0 opacity-70" aria-hidden />
            </>
          )}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={assetUrl(block.src)}
            alt=""
            width={block.w}
            height={block.h}
            loading="lazy"
            decoding="async"
            onLoad={() => setLoaded(true)}
            className={cn(
              // Blur to sharp rather than a plain fade, so the screenshot
              // resolves into place. Filter and opacity only: no layout.
              "block h-full w-full object-cover object-top transition-[opacity,filter] duration-150",
              loaded ? "opacity-100 blur-0" : "opacity-0 blur-md",
            )}
          />
        </div>
      </button>
      <figcaption
        className={cn(
          "flex items-center gap-1.5 px-2.5 text-[11px] text-muted-foreground",
          fixed ? "h-8 shrink-0" : "py-2",
        )}
      >
        <span className="truncate font-medium text-foreground">{labelFor(block.typeHint)}</span>
        <span className="truncate">{block.host}</span>
        <span className="ml-auto inline-flex shrink-0 items-center gap-1 font-mono tabular-nums">
          {mobile ? <Smartphone className="size-3" aria-label="Mobile" /> : <Monitor className="size-3" aria-label="Desktop" />}
          {block.h}px
        </span>
      </figcaption>
    </figure>
  );
}

/** The same frame with nothing in it, for loading states. */
export function BlockCardSkeleton({ ratio, mobile }: { ratio: number; mobile?: boolean }) {
  return (
    <div className={cn("overflow-hidden rounded-lg border bg-card", mobile && "mx-auto max-w-[300px]")} aria-hidden>
      <div className="shimmer w-full bg-muted" style={{ aspectRatio: `1 / ${ratio}` }} />
      <div className="flex items-center gap-2 px-2.5 py-2">
        <div className="shimmer h-3 w-20 rounded bg-muted" />
        <div className="shimmer h-3 w-24 rounded bg-muted" />
        <div className="shimmer ml-auto h-3 w-10 rounded bg-muted" />
      </div>
    </div>
  );
}
