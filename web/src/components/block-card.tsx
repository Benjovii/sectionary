"use client";

import { useState } from "react";
import { Monitor, Smartphone } from "lucide-react";
import { cn } from "@/lib/utils";
import { labelFor, type Block } from "@/lib/blocks";

/**
 * A block on the wall. The frame reserves the block's exact aspect ratio and
 * paints its real background colour, so nothing shifts when the screenshot
 * arrives; the shimmer runs until then and the image fades in over 150 ms.
 */
export function BlockCard({ block, onOpen }: { block: Block; onOpen: (b: Block) => void }) {
  const [loaded, setLoaded] = useState(false);
  const mobile = block.viewport === "mobile";
  return (
    <figure
      className={cn(
        "group overflow-hidden rounded-lg border bg-card transition-colors duration-150 hover:border-primary/60",
        mobile && "mx-auto max-w-[300px]",
      )}
    >
      <button
        type="button"
        onClick={() => onOpen(block)}
        className="block w-full cursor-zoom-in outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        aria-label={`${labelFor(block.typeHint)} block from ${block.host}, ${block.viewport}`}
      >
        <div className="relative w-full overflow-hidden" style={{ aspectRatio: `${block.w} / ${block.h}`, background: block.bg }}>
          {!loaded && <div className="shimmer absolute inset-0 opacity-70" aria-hidden />}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={block.src}
            alt=""
            width={block.w}
            height={block.h}
            loading="lazy"
            decoding="async"
            onLoad={() => setLoaded(true)}
            className={cn("block h-full w-full object-cover object-top transition-opacity duration-150", loaded ? "opacity-100" : "opacity-0")}
          />
        </div>
      </button>
      <figcaption className="flex items-center gap-1.5 px-2.5 py-2 text-[11px] text-muted-foreground">
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
