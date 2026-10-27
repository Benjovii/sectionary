"use client";

import { useMemo, useState } from "react";
import { Monitor, Smartphone } from "lucide-react";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";
import { assetUrl } from "@/lib/data-source";
import { labelFor, type Block } from "@/lib/blocks";
import { BlockViewer } from "@/components/block-viewer";

export type SharedItem = { note: string | null; block: Block };

/**
 * What a client sees behind a share link: the board's name and brief, then the
 * blocks in the order the agency set, each with its note. No filters, no nav,
 * nothing to sign in to. Tap a block to open it in the block viewer, with its
 * note, the arrows walking the board in order.
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
  const [info, setInfo] = useState(false);
  const item = open === null ? null : (items[open] ?? null);
  const step = useMemo(() => {
    if (open === null || items.length < 2) return {};
    return { prev: () => setOpen((open - 1 + items.length) % items.length), next: () => setOpen((open + 1) % items.length) };
  }, [open, items.length]);

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
      <BlockViewer
        block={item?.block ?? null}
        info={info}
        onInfo={setInfo}
        onClose={() => setOpen(null)}
        onStep={step}
        shared={item ? { note: item.note, position: `${String(open! + 1).padStart(2, "0")} / ${String(items.length).padStart(2, "0")}` } : undefined}
      />
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
