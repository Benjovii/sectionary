"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bookmark, BookmarkCheck, Check, Lock, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { boardStore, onBoardsChanged, type BoardSummary } from "@/lib/boards";
import { gateOf, useAccess, type Gate } from "@/lib/account";
import type { Block } from "@/lib/blocks";

/**
 * "Save" in the detail view and the viewer: tick the boards this block belongs
 * to, or start a new one. `className` restyles the button; `up` opens the list
 * above it, for a button that sits at the bottom of the screen.
 */
export function SaveToBoard({ block, className, up }: { block: Block; className?: string; up?: boolean }) {
  const [open, setOpen] = useState(false);
  const [boards, setBoards] = useState<BoardSummary[] | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gate, setGate] = useState<Gate | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const access = useAccess();
  // Free after the trial, or signed out: no new boards and nothing added (the API agrees, see server/boards.ts).
  const locked = !access.can("boards");

  useEffect(() => {
    let alive = true;
    const load = () => boardStore.list().then((b) => alive && setBoards(b)).catch((e: Error) => alive && setError(e.message));
    load();
    const off = onBoardsChanged(load);
    return () => {
      alive = false;
      off();
    };
  }, []);

  // Close on outside click and on Escape (without closing the dialog behind it).
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
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

  const saved = boards?.filter((b) => b.blockIds.includes(block.id)) ?? [];

  const run = async (id: string, job: () => Promise<unknown>) => {
    setBusy(id);
    setError(null);
    setGate(null);
    try {
      await job();
    } catch (e) {
      setError((e as Error).message);
      setGate(gateOf(e));
    } finally {
      setBusy(null);
    }
  };
  const toggle = (b: BoardSummary) =>
    run(b.id, () => (b.blockIds.includes(block.id) ? boardStore.removeItem(b.id, block.id) : boardStore.add(b.id, block)));
  const create = (e: React.FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    run("new", async () => {
      const board = await boardStore.create(n);
      await boardStore.add(board.id, block);
      setName("");
    });
  };

  return (
    <div ref={ref} className="relative">
      <Button variant={saved.length ? "secondary" : "default"} size="sm" className={className} aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((o) => !o)}>
        {locked ? <Lock /> : saved.length ? <BookmarkCheck /> : <Bookmark />}
        {saved.length ? `Saved${saved.length > 1 ? ` · ${saved.length}` : ""}` : "Save"}
      </Button>
      {open && (
        <div role="dialog" aria-label="Save to board" className={cn("absolute z-10 w-64", up ? "bottom-full left-1/2 mb-2 -translate-x-1/2" : "top-full right-0 mt-1.5", "rounded-lg border bg-popover p-1.5 text-popover-foreground shadow-lg")}>
          {locked ? (
            <div className="flex flex-col items-start gap-2 px-2 py-1.5">
              <p className="text-[12px] text-muted-foreground text-pretty">
                {access.signedIn
                  ? "Saving to boards comes with Pro. The boards you have stay readable and shareable."
                  : "Sign in to save blocks to boards. New accounts get Pro free for 7 days."}
              </p>
              <Link
                href={access.signedIn ? "/account" : "/account?next=/boards"}
                className="inline-flex h-7 items-center rounded-lg bg-primary px-2.5 text-[12px] font-medium text-primary-foreground outline-none transition-colors duration-150 hover:bg-primary/80 focus-visible:ring-2 focus-visible:ring-ring touch:h-11"
              >
                {access.signedIn ? "See plans" : "Start free trial"}
              </Link>
            </div>
          ) : boards === null ? (
            <p className="px-2 py-1.5 text-[12px] text-muted-foreground">Loading boards…</p>
          ) : boards.length === 0 ? (
            <p className="px-2 py-1.5 text-[12px] text-muted-foreground">No boards yet. Name one below: it is how you send a set of references to a client.</p>
          ) : (
            <ul className="max-h-56 overflow-auto">
              {boards.map((b) => {
                const on = b.blockIds.includes(block.id);
                return (
                  <li key={b.id}>
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => toggle(b)}
                      aria-pressed={on}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] outline-none transition-colors duration-150 hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60"
                    >
                      <span className={cn("grid size-4 shrink-0 place-items-center rounded border", on && "border-primary bg-primary text-primary-foreground")}>
                        {on && <Check className="size-3" />}
                      </span>
                      <span className="truncate">{b.name}</span>
                      <span className="ml-auto font-mono text-[11px] tabular-nums text-muted-foreground">{b.blockIds.length}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {!locked && (
            <form onSubmit={create} className="mt-1 flex gap-1 border-t pt-1.5">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="New board"
                aria-label="New board name"
                maxLength={120}
                className="h-7 min-w-0 flex-1 rounded-lg border bg-background px-2 text-[12px] outline-none placeholder:text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
              />
              <Button type="submit" size="icon-sm" variant="outline" aria-label="Create board and save" disabled={!name.trim() || busy !== null}>
                <Plus />
              </Button>
            </form>
          )}
          {error && (
            <p className="px-2 pt-1.5 text-[12px] text-destructive">
              {error}
              <GateLink gate={gate} />
            </p>
          )}
          <Link href="/boards" className="mt-1 block rounded-md px-2 py-1.5 text-[12px] text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50">
            Manage and share boards
          </Link>
        </div>
      )}
    </div>
  );
}

/** "Sign in" or "See plans" after a board error the plan gate caused. */
function GateLink({ gate }: { gate: Gate | null }) {
  if (!gate) return null;
  return (
    <Link href={gate === "SIGN_IN_REQUIRED" ? "/account?next=/boards" : "/account"} className="ml-1 text-link underline-offset-4 hover:underline">
      {gate === "SIGN_IN_REQUIRED" ? "Sign in" : "See plans"}
    </Link>
  );
}
