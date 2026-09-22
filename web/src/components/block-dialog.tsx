"use client";

import { useEffect, useRef, useState } from "react";
import { ExternalLink, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BriefPanel } from "@/components/brief-panel";
import { SaveToBoard } from "@/components/save-to-board";
import { TimeMachineControls, TimeMachineStage, useTimeMachine } from "@/components/time-machine";
import { cn } from "@/lib/utils";
import { assetUrl } from "@/lib/data-source";
import { platformLabel } from "@/lib/stores";
import { countOf, type TechCounts, type TechKey } from "@/lib/tech";
import { labelFor, PAGE_TYPE_LABEL, type Block } from "@/lib/blocks";

type Tab = "details" | "brief" | "history";
const TABS: [Tab, string][] = [
  ["details", "Details"],
  ["brief", "Copy as brief"],
  ["history", "Time machine"],
];

type Props = {
  block: Block | null;
  onClose: () => void;
  /** Library-wide block counts per platform, theme and app, shown on the tech-stack chips. */
  counts?: TechCounts | null;
  /** When given, a tech-stack chip filters the wall to that platform, theme or app. */
  onFilter?: (key: TechKey, value: string) => void;
};

/** Block detail: full-height sheet on phones, centred panel from 900px up. */
export function BlockDialog({ block, onClose, counts = null, onFilter }: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (block && !d.open) d.showModal();
    if (!block && d.open) d.close();
  }, [block]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="m-0 h-dvh max-h-dvh w-screen max-w-none bg-transparent p-0 backdrop:bg-black/70 open:flex open:items-end open:justify-center md:items-center md:p-6"
    >
      {block && <DialogBody key={block.id} block={block} onClose={onClose} counts={counts} onFilter={onFilter} />}
    </dialog>
  );
}

function DialogBody({ block, onClose, counts, onFilter }: Props & { block: Block }) {
  const [tab, setTab] = useState<Tab>("details");
  const tm = useTimeMachine(block);

  return (
    <div className="flex max-h-dvh w-full flex-col overflow-hidden rounded-t-xl border bg-card text-card-foreground md:max-h-[92vh] md:max-w-[1280px] md:flex-row md:rounded-xl">
      <div className="relative min-h-0 flex-1 overflow-auto" style={{ background: tab === "history" ? undefined : block.bg }}>
        {tab === "history" ? (
          <TimeMachineStage tm={tm} />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={assetUrl(block.src)}
            alt={`${labelFor(block.typeHint)} block from ${block.host}`}
            width={block.w}
            height={block.h}
            className={block.viewport === "mobile" ? "mx-auto block w-full max-w-[390px]" : "block w-full"}
          />
        )}
      </div>
      <aside className="flex max-h-[55vh] w-full shrink-0 flex-col border-t md:max-h-none md:w-[360px] md:border-t-0 md:border-l">
        <div className="flex items-center gap-2 border-b px-4 py-3">
          <h2 className="truncate font-heading text-[15px] font-semibold">{labelFor(block.typeHint)}</h2>
          <span className="font-mono text-[11px] text-muted-foreground">{block.viewport}</span>
          <div className="ml-auto flex items-center gap-1">
            <SaveToBoard block={block} />
            <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={onClose}>
              <X />
            </Button>
          </div>
        </div>
        <div role="tablist" aria-label="Block tools" className="flex gap-1 border-b px-3 py-1.5">
          {TABS.map(([t, l]) => (
            <button
              key={t}
              role="tab"
              type="button"
              id={`tab-${t}`}
              aria-selected={tab === t}
              aria-controls={`panel-${t}`}
              onClick={() => setTab(t)}
              className={cn(
                "rounded-md px-2 py-1 text-[12px] text-muted-foreground outline-none transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
                tab === t && "bg-muted text-foreground",
              )}
            >
              {l}
            </button>
          ))}
        </div>
        <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="flex min-h-0 flex-1 flex-col overflow-auto">
          {tab === "details" && <Details block={block} counts={counts ?? null} onFilter={onFilter} />}
          {tab === "brief" && <BriefPanel block={block} />}
          {tab === "history" && <TimeMachineControls tm={tm} />}
        </div>
        {tab === "details" && (
          <div className="border-t px-4 py-3">
            <a
              href={block.pageUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-[13px] text-primary underline-offset-4 hover:underline"
            >
              Open the source page <ExternalLink className="size-3.5" />
            </a>
          </div>
        )}
      </aside>
    </div>
  );
}

function Details({ block, counts, onFilter }: { block: Block; counts: TechCounts | null; onFilter?: (key: TechKey, value: string) => void }) {
  const chips: [TechKey, string, string][] = [
    ...(block.platform ? [["platform", block.platform, platformLabel(block.platform)] as [TechKey, string, string]] : []),
    ...(block.theme ? [["theme", block.theme, block.theme] as [TechKey, string, string]] : []),
    ...block.apps.map((a) => ["app", a, a] as [TechKey, string, string]),
  ];
  return (
    <div className="flex flex-col">
      <dl className="grid grid-cols-[88px_1fr] gap-x-3 gap-y-2 px-4 py-3 text-[13px]">
        <dt className="text-muted-foreground">Site</dt>
        <dd className="truncate">{block.host}</dd>
        <dt className="text-muted-foreground">Page</dt>
        <dd>{PAGE_TYPE_LABEL[block.pageType] ?? block.pageType}</dd>
        <dt className="text-muted-foreground">Size</dt>
        <dd className="font-mono tabular-nums">
          {block.w} × {block.h}
        </dd>
        {block.headline && (
          <>
            <dt className="text-muted-foreground">Headline</dt>
            <dd>{block.headline}</dd>
          </>
        )}
        <dt className="text-muted-foreground">Contains</dt>
        <dd className="text-muted-foreground">
          {block.buttons} buttons · {block.images} images · {block.videos} videos
        </dd>
      </dl>
      {chips.length > 0 && (
        <section aria-labelledby="tech-heading" className="border-t px-4 py-3">
          <h3 id="tech-heading" className="mb-2 text-[12px] font-medium">
            Tech stack
            {onFilter && <span className="font-normal text-muted-foreground"> · tap to see every block built with it</span>}
          </h3>
          <ul className="flex flex-wrap gap-1.5">
            {chips.map(([key, value, label]) => {
              const n = countOf(counts, key, value);
              const inner = (
                <>
                  <span className="text-muted-foreground">{key === "app" ? "" : key === "platform" ? "Platform " : "Theme "}</span>
                  {label}
                  {n !== null && <span className="font-mono text-[10px] tabular-nums text-muted-foreground">{n.toLocaleString("en-US")}</span>}
                </>
              );
              const cls = "inline-flex items-center gap-1 rounded-full border bg-muted/50 px-2 py-0.5 text-[12px]";
              return (
                <li key={`${key}:${value}`}>
                  {onFilter ? (
                    <button
                      type="button"
                      onClick={() => onFilter(key, value)}
                      aria-label={`Show ${n ?? "all"} blocks with ${label}`}
                      className={cn(cls, "outline-none transition-colors duration-150 hover:border-primary/60 hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50")}
                    >
                      {inner}
                    </button>
                  ) : (
                    <span className={cls}>{inner}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
