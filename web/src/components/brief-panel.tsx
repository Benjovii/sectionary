"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy, RotateCcw, Sparkles, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { BriefTarget } from "@/contracts/api";
import type { Block } from "@/lib/blocks";

const TARGETS: { id: BriefTarget; label: string; hint: string }[] = [
  { id: "claude-code", label: "Claude Code", hint: "A build prompt with structure, layout, behaviour and acceptance criteria." },
  { id: "cursor", label: "Cursor", hint: "A compact prompt for Cursor's agent: elements, layouts, props, constraints." },
  { id: "designer", label: "Designer", hint: "A design spec: anatomy, hierarchy, spacing, states and why it works." },
];

type State = { status: "idle" | "writing" | "done" | "error"; text: string; source: string | null; error?: string };

/** "Copy as brief": Claude turns the block into a prompt or spec, streamed in, one click to copy. */
export function BriefPanel({ block }: { block: Block }) {
  const [target, setTarget] = useState<BriefTarget>("claude-code");
  const [state, setState] = useState<State>({ status: "idle", text: "", source: null });
  const [copied, setCopied] = useState(false);
  const abort = useRef<AbortController | null>(null);

  // A new block or target starts over; leaving the panel stops the stream.
  useEffect(() => {
    abort.current?.abort();
    setState({ status: "idle", text: "", source: null });
  }, [block.id, target]);
  useEffect(() => () => abort.current?.abort(), []);

  async function write() {
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setCopied(false);
    setState({ status: "writing", text: "", source: null });
    try {
      const res = await fetch("/api/brief", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ blockId: block.id, target }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) {
        const err = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(err?.error ?? `HTTP ${res.status}`);
      }
      const source = res.headers.get("x-brief-source");
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let text = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        text += value;
        setState({ status: "writing", text, source });
      }
      setState({ status: "done", text: text.trim(), source });
    } catch (e) {
      if (ctrl.signal.aborted) return;
      setState((s) => ({ ...s, status: "error", error: (e as Error).message }));
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(state.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setState((s) => ({ ...s, error: "The browser blocked the clipboard. Select the text and copy it." }));
    }
  }

  const hint = TARGETS.find((t) => t.id === target)!.hint;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 py-3">
      <div className="flex flex-col gap-1.5">
        <p className="text-[12px] text-muted-foreground">Write a brief for</p>
        <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Brief for">
          {TARGETS.map((t) => (
            <Button key={t.id} variant="outline" size="sm" role="radio" aria-checked={target === t.id} active={target === t.id} onClick={() => setTarget(t.id)}>
              {t.label}
            </Button>
          ))}
        </div>
        <p className="text-[12px] text-muted-foreground">{hint}</p>
      </div>

      <div className="flex gap-1.5">
        {state.status === "writing" ? (
          <Button variant="outline" size="sm" onClick={() => { abort.current?.abort(); setState((s) => ({ ...s, status: s.text ? "done" : "idle" })); }}>
            <Square /> Stop
          </Button>
        ) : state.status === "idle" ? (
          <Button size="sm" onClick={write}>
            <Sparkles /> Write brief
          </Button>
        ) : (
          <Button variant="outline" size="sm" onClick={write}>
            <RotateCcw /> Write again
          </Button>
        )}
        {state.text && (
          <Button size="sm" variant={state.status === "done" ? "default" : "outline"} onClick={copy} disabled={state.status === "writing"}>
            {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy brief"}
          </Button>
        )}
      </div>

      {state.status === "writing" && !state.text && (
        <div className="flex flex-col gap-2" aria-live="polite" aria-label="Claude is reading the block">
          <p className="text-[12px] text-muted-foreground">Claude is reading the screenshot…</p>
          {[90, 70, 80, 55].map((w, i) => (
            <div key={i} className="shimmer h-3 rounded bg-muted" style={{ width: `${w}%` }} />
          ))}
        </div>
      )}
      {state.text && (
        <pre
          className="min-h-24 flex-1 overflow-auto rounded-lg border bg-background p-3 font-mono text-[12px] leading-relaxed whitespace-pre-wrap"
          aria-live={state.status === "writing" ? "off" : "polite"}
          aria-busy={state.status === "writing"}
        >
          {state.text}
        </pre>
      )}
      {state.source === "template" && state.status === "done" && (
        <p className="text-[11px] text-muted-foreground">Written from the block&apos;s data only: the server has no ANTHROPIC_API_KEY, so Claude did not see the screenshot.</p>
      )}
      {state.error && <p className="text-[12px] text-destructive">{state.error}</p>}
    </div>
  );
}
