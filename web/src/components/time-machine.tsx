"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { API_MODE, assetUrl } from "@/lib/data-source";
import type { BlockHistory } from "@/contracts/api";
import { labelFor, type Block } from "@/lib/blocks";

type Capture = BlockHistory["captures"][number];
type Mode = "side" | "swipe";
type View = "block" | "page";

const date = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

/**
 * Time machine state for one block: every capture of its page, and which two
 * are being compared (newest on the right). Shared by the stage (the image
 * pane) and the controls (the side panel).
 */
export function useTimeMachine(block: Block) {
  const [history, setHistory] = useState<BlockHistory | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "sample" | "error">(API_MODE ? "loading" : "sample");
  const [before, setBefore] = useState(1);
  const [after, setAfter] = useState(0);
  const [mode, setMode] = useState<Mode>("side");
  const [view, setView] = useState<View>("block");

  useEffect(() => {
    if (!API_MODE) return;
    // The dialog remounts this hook per block (keyed by id), so it starts in "loading".
    let alive = true;
    fetch(`/api/blocks/${encodeURIComponent(block.id)}/history`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((h: BlockHistory) => {
        if (!alive) return;
        setHistory(h);
        setAfter(0);
        setBefore(Math.min(1, h.captures.length - 1));
        setStatus("ready");
      })
      .catch(() => alive && setStatus("error"));
    return () => {
      alive = false;
    };
  }, [block.id]);

  const captures = useMemo(() => history?.captures ?? [], [history]);
  return { block, status, captures, before, setBefore, after, setAfter, mode, setMode, view, setView };
}
export type TimeMachine = ReturnType<typeof useTimeMachine>;

function Shot({ capture, view, block }: { capture: Capture; view: View; block: Block }) {
  const shot = view === "page" ? capture.fullPage : capture.block ? { src: capture.block.src, w: capture.block.w, h: capture.block.h } : null;
  if (!shot) {
    return (
      <div className="grid aspect-[4/3] place-items-center rounded-md border border-dashed p-4 text-center text-[12px] text-muted-foreground">
        {view === "page" ? "No full-page screenshot for this capture." : `No ${labelFor(block.typeHint).toLowerCase()} on the page that day.`}
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={assetUrl(shot.src)} alt={`${view === "page" ? "Full page" : labelFor(block.typeHint)} on ${date(capture.capturedAt)}`} width={shot.w} height={shot.h} className="block h-auto w-full" style={{ background: capture.block?.bg }} />
  );
}

/** The image pane: two captures side by side, or one over the other with a swipe handle. */
export function TimeMachineStage({ tm }: { tm: TimeMachine }) {
  const [split, setSplit] = useState(50);
  const { status, captures, before, after, mode, view, block } = tm;

  if (status !== "ready" || captures.length < 2) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={assetUrl(block.src)} alt="" width={block.w} height={block.h} className="max-h-[50vh] w-auto max-w-full rounded-md border object-contain opacity-80" />
        <p className="max-w-sm text-[13px] text-muted-foreground">
          {status === "loading"
            ? "Loading the captures of this page…"
            : status === "error"
              ? "The capture history could not be loaded."
              : "This is the only capture of this page so far. Each recapture adds a date here, so you can put any two side by side."}
        </p>
      </div>
    );
  }

  const a = captures[before], b = captures[after];
  if (mode === "side") {
    return (
      <div className="grid grid-cols-2 gap-2 p-2 sm:gap-3 sm:p-3">
        {[a, b].map((c, i) => (
          <figure key={i} className="min-w-0">
            <figcaption className="sticky top-0 z-[1] mb-1.5 rounded bg-card/90 px-1.5 py-1 font-mono text-[11px] tabular-nums backdrop-blur">
              {i === 0 ? "Before" : "After"} · {date(c.capturedAt)}
            </figcaption>
            <Shot capture={c} view={view} block={block} />
          </figure>
        ))}
      </div>
    );
  }
  return (
    <div className="p-2 sm:p-3">
      <div className="mb-2 flex items-center gap-2 font-mono text-[11px] tabular-nums">
        <span>{date(a.capturedAt)}</span>
        <input
          type="range"
          min={0}
          max={100}
          value={split}
          onChange={(e) => setSplit(Number(e.target.value))}
          aria-label="Swipe between the two captures"
          className="flex-1 accent-[var(--primary)]"
        />
        <span>{date(b.capturedAt)}</span>
      </div>
      <div className="relative">
        <Shot capture={b} view={view} block={block} />
        <div className="absolute inset-0 overflow-hidden" style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }}>
          <Shot capture={a} view={view} block={block} />
        </div>
        <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-primary" style={{ left: `${split}%` }} aria-hidden />
      </div>
    </div>
  );
}

const selectClass =
  "h-7 min-w-0 flex-1 rounded-lg border bg-background px-2 text-[12px] outline-none focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

/** The side panel: pick two dates, how to compare them, and see what changed on each recapture. */
export function TimeMachineControls({ tm }: { tm: TimeMachine }) {
  const { status, captures, before, setBefore, after, setAfter, mode, setMode, view, setView } = tm;
  const options = captures.map((c, i) => (
    <option key={c.capturedAt} value={i}>
      {date(c.capturedAt)}
      {c.block ? "" : " (not on page)"}
    </option>
  ));

  return (
    <div className="flex flex-col gap-3 overflow-auto px-4 py-3 text-[13px]">
      <p className="flex items-center gap-1.5 text-muted-foreground">
        <History className="size-3.5" aria-hidden />
        {status === "ready" ? `${captures.length} capture${captures.length === 1 ? "" : "s"} of this page` : status === "loading" ? "Loading…" : "One capture so far"}
      </p>

      {status === "ready" && captures.length >= 2 && (
        <>
          <div className="flex items-center gap-1.5">
            <select aria-label="Before" value={before} onChange={(e) => setBefore(Number(e.target.value))} className={selectClass}>
              {options}
            </select>
            <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <select aria-label="After" value={after} onChange={(e) => setAfter(Number(e.target.value))} className={selectClass}>
              {options}
            </select>
          </div>
          <div className="flex flex-wrap gap-1">
            <div className="flex gap-1" role="group" aria-label="Compare as">
              {(
                [
                  ["side", "Side by side"],
                  ["swipe", "Swipe"],
                ] as const
              ).map(([m, l]) => (
                <Button key={m} variant="outline" size="sm" active={mode === m} aria-pressed={mode === m} onClick={() => setMode(m)}>
                  {l}
                </Button>
              ))}
            </div>
            <div className="flex gap-1" role="group" aria-label="Show">
              {(
                [
                  ["block", "Block"],
                  ["page", "Full page"],
                ] as const
              ).map(([v, l]) => (
                <Button key={v} variant="outline" size="sm" active={view === v} aria-pressed={view === v} onClick={() => setView(v)}>
                  {l}
                </Button>
              ))}
            </div>
          </div>
        </>
      )}

      {status === "ready" && (
        <ol className="flex flex-col">
          {captures.map((c, i) => (
            <li key={c.capturedAt} className={cn("flex items-baseline gap-2 border-t py-1.5 first:border-t-0", (i === before || i === after) && "text-foreground", i !== before && i !== after && "text-muted-foreground")}>
              <span className="font-mono text-[11px] tabular-nums">{date(c.capturedAt)}</span>
              <span className="ml-auto text-[11px]">
                {c.diff ? `+${c.diff.added} −${c.diff.removed} ~${c.diff.changed} blocks` : i === captures.length - 1 ? "first capture" : "no change recorded"}
              </span>
            </li>
          ))}
        </ol>
      )}

      {status === "sample" && (
        <p className="text-[12px] text-muted-foreground">
          The sample data holds one capture per page. With the database connected, every recapture of this page appears here and any two dates can be compared.
        </p>
      )}
    </div>
  );
}
