"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ExternalLink, Monitor, Smartphone, X } from "lucide-react";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { assetUrl } from "@/lib/data-source";
import { labelFor, type Block } from "@/lib/blocks";

export type SharedItem = { note: string | null; block: Block };

/**
 * What a client sees behind a share link: the board's name and brief, then the
 * blocks in the order the agency set, each with its note. No filters, no nav,
 * nothing to sign in to. Tap a block to see it full size.
 */
export function SharedBoardView({
  name,
  description,
  updatedAt,
  items,
  notice,
}: {
  name: string;
  description: string | null;
  updatedAt: string | null;
  items: SharedItem[];
  notice?: React.ReactNode;
}) {
  const [open, setOpen] = useState<number | null>(null);

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b">
        <div className="mx-auto flex h-12 max-w-[1400px] items-center gap-2 px-4">
          <Logo />
          <span className="text-[12px] text-muted-foreground">Shared board</span>
          <div className="ml-auto">
            <ThemeToggle />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 sm:py-10">
        <div className="mb-6 max-w-2xl sm:mb-10">
          <h1 className="font-heading text-[26px] leading-tight font-semibold text-balance sm:text-[34px]">{name}</h1>
          {description && <p className="mt-3 text-[15px] leading-relaxed whitespace-pre-line text-muted-foreground">{description}</p>}
          <p className="mt-3 font-mono text-[11px] tabular-nums text-muted-foreground">
            {items.length} reference{items.length === 1 ? "" : "s"}
            {updatedAt && ` · updated ${new Date(updatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}`}
          </p>
          {notice}
        </div>

        {items.length === 0 ? (
          <p className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">This board is empty for now.</p>
        ) : (
          <ol className="grid grid-cols-1 items-start gap-x-5 gap-y-8 sm:grid-cols-2 xl:grid-cols-3">
            {items.map((it, i) => (
              <li key={it.block.id}>
                <SharedCard item={it} n={i + 1} onOpen={() => setOpen(i)} />
              </li>
            ))}
          </ol>
        )}
      </main>
      <footer className="border-t">
        <div className="mx-auto flex max-w-[1400px] items-center gap-2 px-4 py-4 text-[12px] text-muted-foreground">
          <Logo />
          Collected with Sectionary: real stores, cut into blocks.
        </div>
      </footer>
      <Lightbox items={items} index={open} onIndex={setOpen} />
    </div>
  );
}

function SharedCard({ item, n, onOpen }: { item: SharedItem; n: number; onOpen: () => void }) {
  const [loaded, setLoaded] = useState(false);
  const { block } = item;
  const mobile = block.viewport === "mobile";
  return (
    <figure className="flex flex-col gap-2.5">
      <button
        type="button"
        onClick={onOpen}
        className="group block overflow-hidden rounded-lg border bg-card text-left outline-none transition-colors duration-150 hover:border-primary/60 focus-visible:ring-3 focus-visible:ring-ring/50"
        aria-label={`Reference ${n}: ${labelFor(block.typeHint)} from ${block.host}. Open full size`}
      >
        {/* Tall blocks are cropped to a card; the full block opens on tap. */}
        <div className={cn("relative w-full overflow-hidden", mobile && "mx-auto max-w-[260px]")} style={{ aspectRatio: `${block.w} / ${Math.min(block.h, block.w * (mobile ? 2 : 1.1))}`, background: block.bg }}>
          {!loaded && <div className="shimmer absolute inset-0 opacity-70" aria-hidden />}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={assetUrl(block.src)}
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
      <figcaption className="flex flex-col gap-1">
        {item.note && <p className="text-[14px] leading-snug whitespace-pre-line">{item.note}</p>}
        <p className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
          <span className="font-mono tabular-nums">{String(n).padStart(2, "0")}</span>
          <span className="truncate">
            {labelFor(block.typeHint)} · {block.host}
          </span>
          {mobile ? <Smartphone className="ml-auto size-3 shrink-0" aria-label="Phone" /> : <Monitor className="ml-auto size-3 shrink-0" aria-label="Desktop" />}
        </p>
      </figcaption>
    </figure>
  );
}

function Lightbox({ items, index, onIndex }: { items: SharedItem[]; index: number | null; onIndex: (i: number | null) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const item = index === null ? null : items[index];

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (item && !d.open) d.showModal();
    if (!item && d.open) d.close();
  }, [item]);

  const step = useCallback((by: number) => index !== null && onIndex((index + by + items.length) % items.length), [index, items.length, onIndex]);
  useEffect(() => {
    if (index === null) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") step(1);
      if (e.key === "ArrowLeft") step(-1);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [index, step]);

  return (
    <dialog
      ref={ref}
      onClose={() => onIndex(null)}
      onClick={(e) => e.target === e.currentTarget && onIndex(null)}
      className="m-0 h-dvh max-h-dvh w-screen max-w-none bg-transparent p-0 backdrop:bg-black/80 open:flex open:items-end open:justify-center md:items-center md:p-6"
    >
      {item && (
        <div className="flex max-h-dvh w-full flex-col overflow-hidden rounded-t-xl border bg-card text-card-foreground md:max-h-[92vh] md:max-w-[1200px] md:rounded-xl">
          <div className="flex items-center gap-2 border-b px-4 py-2.5">
            <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
              {index! + 1} / {items.length}
            </span>
            <span className="truncate text-[13px]">
              {labelFor(item.block.typeHint)} · {item.block.host}
            </span>
            <div className="ml-auto flex items-center gap-1">
              {items.length > 1 && (
                <>
                  <Button variant="ghost" size="icon-sm" aria-label="Previous" onClick={() => step(-1)}>
                    <ChevronLeft />
                  </Button>
                  <Button variant="ghost" size="icon-sm" aria-label="Next" onClick={() => step(1)}>
                    <ChevronRight />
                  </Button>
                </>
              )}
              <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={() => onIndex(null)}>
                <X />
              </Button>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-auto" style={{ background: item.block.bg }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={assetUrl(item.block.src)}
              alt={`${labelFor(item.block.typeHint)} from ${item.block.host}`}
              width={item.block.w}
              height={item.block.h}
              className={item.block.viewport === "mobile" ? "mx-auto block w-full max-w-[390px]" : "block w-full"}
            />
          </div>
          <div className="flex flex-col gap-1.5 border-t px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
            {item.note && <p className="text-[14px] whitespace-pre-line">{item.note}</p>}
            <a
              href={item.block.pageUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex shrink-0 items-center gap-1.5 text-[13px] text-primary underline-offset-4 hover:underline sm:ml-auto"
            >
              See it live <ExternalLink className="size-3.5" />
            </a>
          </div>
        </div>
      )}
    </dialog>
  );
}
