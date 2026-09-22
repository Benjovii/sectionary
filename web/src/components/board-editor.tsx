"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowLeft, ArrowUp, Check, Copy, ExternalLink, GripVertical, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { assetUrl } from "@/lib/data-source";
import { boardStore } from "@/lib/boards";
import { labelFor } from "@/lib/blocks";
import type { Board, BoardItem } from "@/contracts/api";

const fieldClass =
  "w-full rounded-lg border bg-background px-2.5 outline-none placeholder:text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

/** One board: rename it, brief it, order the blocks, note each one, and share it. */
export function BoardEditor({ id }: { id: string }) {
  const [board, setBoard] = useState<Board | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [saving, setSaving] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    let alive = true;
    boardStore
      .get(id)
      .then((b) => {
        if (!alive) return;
        setBoard(b);
        setStatus("ready");
      })
      .catch((e: { status?: number }) => alive && setStatus(e.status === 404 || e.status === 403 ? "missing" : "error"));
    return () => {
      alive = false;
    };
  }, [id]);

  /** Apply a change: optimistic when `optimistic` is given, then the store's answer wins. */
  async function save(job: () => Promise<Board>, optimistic?: Board) {
    if (optimistic) setBoard(optimistic);
    setSaving((n) => n + 1);
    setError(null);
    try {
      setBoard(await job());
    } catch (e) {
      setError((e as Error).message);
      boardStore.get(id).then(setBoard).catch(() => {});
    } finally {
      setSaving((n) => n - 1);
    }
  }

  if (status === "loading") {
    return (
      <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading board">
        <div className="shimmer h-5 w-48 rounded bg-muted" />
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="shimmer h-28 rounded-lg bg-muted" />
        ))}
      </div>
    );
  }
  if (status !== "ready" || !board) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
        <p>{status === "missing" ? "This board is not in this browser. It may have been deleted, or made in another browser." : "The board could not be loaded."}</p>
        <Link href="/boards" className="mt-2 inline-block text-primary underline-offset-4 hover:underline">
          All boards
        </Link>
      </div>
    );
  }

  const reorder = (from: number, to: number) => {
    if (from === to || to < 0 || to >= board.items.length) return;
    const items = [...board.items];
    const [moved] = items.splice(from, 1);
    items.splice(to, 0, moved);
    const next = { ...board, items: items.map((it, position) => ({ ...it, position })) };
    save(() => boardStore.update(board.id, { order: items.map((i) => i.blockId) }), next);
  };

  return (
    <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-5">
      <div className="flex items-center gap-2">
        <Link href="/boards" className="inline-flex items-center gap-1 rounded-md text-[12px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50">
          <ArrowLeft className="size-3.5" /> Boards
        </Link>
        <span className="ml-auto font-mono text-[11px] text-muted-foreground" aria-live="polite">
          {saving > 0 ? "saving…" : error ? "" : "saved"}
        </span>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="flex min-w-0 flex-col gap-2">
          <BlurInput
            key={`n-${board.updatedAt}`}
            value={board.name}
            label="Board name"
            className={cn(fieldClass, "h-10 font-heading text-[20px] font-semibold")}
            onCommit={(name) => name.trim() && name !== board.name && save(() => boardStore.update(board.id, { name }))}
          />
          <BlurInput
            key={`d-${board.updatedAt}`}
            multiline
            value={board.description ?? ""}
            label="Brief for the client"
            placeholder="A line or two for the client: what these references are for and what to look at."
            className={cn(fieldClass, "min-h-16 py-2 text-[13px]")}
            onCommit={(description) => description !== (board.description ?? "") && save(() => boardStore.update(board.id, { description }))}
          />
          {error && <p className="text-[12px] text-destructive">{error}</p>}
        </div>
        <SharePanel board={board} onShared={(shared) => save(() => boardStore.update(board.id, { shared }), { ...board, shared })} />
      </div>

      {board.items.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
          <p>No blocks on this board yet.</p>
          <p className="mt-1 text-[12px]">
            Open any block on the{" "}
            <Link href="/" className="text-primary underline-offset-4 hover:underline">
              wall
            </Link>
            , press Save and tick this board.
          </p>
        </div>
      ) : (
        <ItemList
          items={board.items}
          onMove={reorder}
          onNote={(blockId, note) => save(() => boardStore.setNote(board.id, blockId, note))}
          onRemove={(blockId) => save(() => boardStore.removeItem(board.id, blockId), { ...board, items: board.items.filter((i) => i.blockId !== blockId) })}
        />
      )}

      <div className="border-t pt-4">
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive"
          onClick={async () => {
            if (!confirm(`Delete "${board.name}"? Its share link stops working.`)) return;
            try {
              await boardStore.remove(board.id);
              router.push("/boards");
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          <Trash2 /> Delete board
        </Button>
      </div>
    </div>
  );
}

/** A field that saves when it loses focus (or on Enter for single-line). */
function BlurInput({
  value,
  onCommit,
  label,
  placeholder,
  className,
  multiline,
}: {
  value: string;
  onCommit: (v: string) => void;
  label: string;
  placeholder?: string;
  className?: string;
  multiline?: boolean;
}) {
  const [v, setV] = useState(value);
  const common = { value: v, "aria-label": label, placeholder, className, onBlur: () => onCommit(v) };
  return multiline ? (
    <textarea {...common} maxLength={2000} onChange={(e) => setV(e.target.value)} />
  ) : (
    <input {...common} maxLength={120} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} />
  );
}

function SharePanel({ board, onShared }: { board: Board; onShared: (shared: boolean) => void }) {
  const [copied, setCopied] = useState(false);
  const url = boardStore.shareUrl(board);
  const live = boardStore.linkKind === "live";
  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      prompt("Copy the link", url);
    }
  };

  return (
    <section aria-labelledby="share-heading" className="flex flex-col gap-2.5 rounded-lg border bg-card p-3">
      <div className="flex items-center gap-2">
        <h2 id="share-heading" className="text-[13px] font-medium">
          Share with a client
        </h2>
        {live && (
          <label className="ml-auto inline-flex cursor-pointer items-center gap-2 text-[12px] text-muted-foreground">
            {board.shared ? "On" : "Off"}
            <button
              type="button"
              role="switch"
              aria-checked={board.shared}
              aria-label="Anyone with the link can view"
              onClick={() => onShared(!board.shared)}
              className={cn(
                "relative h-5 w-9 rounded-full border transition-colors duration-150 outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                board.shared ? "border-primary bg-primary" : "bg-muted",
              )}
            >
              <span className={cn("absolute top-0.5 left-0.5 size-3.5 rounded-full bg-background transition-transform duration-150", board.shared && "translate-x-4")} />
            </button>
          </label>
        )}
      </div>
      <p className="text-[12px] text-muted-foreground">
        {live
          ? board.shared
            ? "Anyone with the link sees a clean, read-only page of these blocks in this order, with your notes. Edits show up for them on reload."
            : "Turn sharing on for a read-only link. Turning it off later stops the link; turning it on again brings the same link back."
          : "Anyone with the link sees a clean, read-only page of these blocks in this order, with your notes. The link holds the board as it is now: copy it again after changes."}
      </p>
      {url && (
        <>
          <input readOnly value={url} aria-label="Share link" onFocus={(e) => e.currentTarget.select()} className={cn(fieldClass, "h-8 font-mono text-[11px]")} />
          <div className="flex gap-1.5">
            <Button size="sm" onClick={copy} disabled={board.items.length === 0}>
              {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy link"}
            </Button>
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-7 items-center gap-1.5 rounded-lg border px-2.5 text-[12px] font-medium outline-none transition-colors duration-150 hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 dark:border-input dark:bg-input/30"
            >
              See what they see <ExternalLink className="size-3.5" />
            </a>
          </div>
        </>
      )}
    </section>
  );
}

function ItemList({
  items,
  onMove,
  onNote,
  onRemove,
}: {
  items: BoardItem[];
  onMove: (from: number, to: number) => void;
  onNote: (blockId: string, note: string) => void;
  onRemove: (blockId: string) => void;
}) {
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const live = useRef<HTMLParagraphElement>(null);

  const move = (from: number, to: number) => {
    onMove(from, to);
    const item = items[from];
    if (live.current && item?.block) live.current.textContent = `${labelFor(item.block.typeHint)} moved to position ${to + 1} of ${items.length}.`;
  };

  return (
    <>
      <p ref={live} className="sr-only" aria-live="polite" />
      <p className="text-[12px] text-muted-foreground">
        {items.length} block{items.length === 1 ? "" : "s"} · drag to reorder, or use the arrows. The client sees them in this order.
      </p>
      <ol className="flex flex-col gap-2">
        {items.map((it, i) => {
          const b = it.block;
          return (
            <li
              key={it.blockId}
              draggable
              onDragStart={(e) => {
                setDrag(i);
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(e) => {
                if (drag === null) return;
                e.preventDefault();
                setOver(i);
              }}
              onDragLeave={() => setOver((o) => (o === i ? null : o))}
              onDrop={(e) => {
                e.preventDefault();
                if (drag !== null) move(drag, i);
                setDrag(null);
                setOver(null);
              }}
              onDragEnd={() => {
                setDrag(null);
                setOver(null);
              }}
              className={cn(
                "flex gap-2 rounded-lg border bg-card p-2 transition-colors duration-150 sm:gap-3",
                drag === i && "opacity-50",
                over === i && drag !== i && "border-primary",
              )}
            >
              <div className="flex shrink-0 flex-col items-center gap-0.5">
                <GripVertical className="mt-1 size-4 cursor-grab text-muted-foreground" aria-hidden />
                <span className="font-mono text-[11px] tabular-nums text-muted-foreground">{String(i + 1).padStart(2, "0")}</span>
              </div>
              <div className="w-24 shrink-0 overflow-hidden rounded-md border sm:w-44" style={{ background: b?.bg }}>
                {b ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={assetUrl(b.src)} alt="" loading="lazy" className="block max-h-40 w-full object-cover object-top" />
                ) : (
                  <div className="grid h-20 place-items-center text-[11px] text-muted-foreground">Removed from library</div>
                )}
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-[12px]">
                  <span className="font-medium">{b ? labelFor(b.typeHint) : "Block"}</span>
                  <span className="min-w-0 truncate text-muted-foreground">
                    {b?.host} · {b?.viewport}
                  </span>
                </div>
                <BlurInput
                  key={`${it.blockId}-${it.note ?? ""}`}
                  multiline
                  value={it.note ?? ""}
                  label={`Note for block ${i + 1}`}
                  placeholder="Note for the client: what to look at here"
                  className={cn(fieldClass, "min-h-14 flex-1 py-1.5 text-[12px]")}
                  onCommit={(note) => note !== (it.note ?? "") && onNote(it.blockId, note)}
                />
              </div>
              <div className="flex shrink-0 flex-col gap-0.5">
                <Button variant="ghost" size="icon-sm" aria-label={`Move block ${i + 1} up`} disabled={i === 0} onClick={() => move(i, i - 1)}>
                  <ArrowUp />
                </Button>
                <Button variant="ghost" size="icon-sm" aria-label={`Move block ${i + 1} down`} disabled={i === items.length - 1} onClick={() => move(i, i + 1)}>
                  <ArrowDown />
                </Button>
                <Button variant="ghost" size="icon-sm" aria-label={`Remove block ${i + 1}`} onClick={() => onRemove(it.blockId)}>
                  <X />
                </Button>
              </div>
            </li>
          );
        })}
      </ol>
    </>
  );
}
