"use client";

import { useEffect, useState } from "react";
import { SharedBoardView, type SharedItem } from "@/components/shared-board";
import { decodeSnapshot, type Snapshot } from "@/lib/boards";
import { BLOCKS_SRC } from "@/lib/data-source";
import type { Block, BlockSet } from "@/lib/blocks";

/** Reads the board from the URL fragment and finds its blocks in the block set. */
export function SnapshotBoard() {
  const [state, setState] = useState<{ snap: Snapshot; items: SharedItem[]; missing: number } | "loading" | "invalid" | "error">("loading");

  useEffect(() => {
    const snap = decodeSnapshot(location.hash);
    let alive = true;
    (snap ? fetch(BLOCKS_SRC) : Promise.reject(new Error("invalid")))
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((set: BlockSet & { items?: Block[] }) => {
        if (!alive || !snap) return;
        const byId = new Map((set.blocks ?? set.items ?? []).map((b) => [b.id, b]));
        const items = snap.items.flatMap((it) => {
          const block = byId.get(it.blockId);
          return block ? [{ note: it.note, block }] : [];
        });
        setState({ snap, items, missing: snap.items.length - items.length });
      })
      .catch(() => alive && setState(snap ? "error" : "invalid"));
    return () => {
      alive = false;
    };
  }, []);

  if (state === "loading") {
    return (
      <div className="mx-auto grid max-w-[1400px] grid-cols-1 gap-5 px-4 py-10 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true" aria-label="Loading board">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="shimmer aspect-[4/3] rounded-lg bg-muted" />
        ))}
      </div>
    );
  }
  if (state === "invalid" || state === "error") {
    return (
      <div className="mx-auto max-w-md px-4 py-24 text-center">
        <h1 className="font-heading text-[20px] font-semibold">This link does not open a board</h1>
        <p className="mt-2 text-muted-foreground">
          {state === "invalid" ? "It may have been cut off when it was pasted. Ask for the link again." : "The references could not be loaded. Try again in a moment."}
        </p>
      </div>
    );
  }
  return (
    <SharedBoardView
      name={state.snap.name}
      description={state.snap.description}
      updatedAt={null}
      items={state.items}
      notice={
        state.missing > 0 ? (
          <p className="mt-2 text-[12px] text-muted-foreground">
            {state.missing} reference{state.missing === 1 ? " is" : "s are"} no longer in the library.
          </p>
        ) : undefined
      }
    />
  );
}
