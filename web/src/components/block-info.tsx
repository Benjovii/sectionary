"use client";

import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BriefPanel } from "@/components/brief-panel";
import { ProOnly } from "@/components/view-limit";
import { useAccess } from "@/lib/account";
import { TimeMachineControls, type TimeMachine } from "@/components/time-machine";
import { cn } from "@/lib/utils";
import { labelFor, PAGE_TYPE_LABEL, type Block } from "@/lib/blocks";
import { platformLabel } from "@/lib/stores";
import { bucketFor, COLOUR_LABEL } from "@/lib/colour";
import { countOf, type TechCounts, type TechKey } from "@/lib/tech";
import { capturedAtOf } from "@/lib/block-detail";

// What the block viewer's "More info" panel shows, and the two helpers the
// viewer needs for its screenshot (zoom and copy). Taken out of the detail
// dialog (SEC-18), which the viewer replaced.

export type Tab = "details" | "brief" | "history";
export const TABS: [Tab, string][] = [
  ["details", "Details"],
  ["brief", "Copy as brief"],
  ["history", "Time machine"],
];

type TechProps = {
  /** Library-wide block counts per platform, theme and app, shown on the tech-stack chips. */
  counts?: TechCounts | null;
  /** When given, a tech-stack chip filters the wall to that platform, theme or app. */
  onFilter?: (key: TechKey, value: string) => void;
};

/**
 * What "More info" shows: the tabs (details, brief, time machine), then the
 * details list, tech stack and captures. The detail dialog and the block
 * viewer's side panel both use it. `tabs` narrows the tabs (a shared board
 * shows only the details); `children` goes at the end of the details.
 */
export function BlockInfoPanel({
  block: focus,
  tab,
  onTab,
  tm,
  captures,
  captureAt,
  onCaptureAt,
  counts,
  onFilter,
  tabs = TABS,
  children,
}: {
  block: Block;
  tab: Tab;
  onTab: (tab: Tab) => void;
  /** The time machine's state; the history tab needs it. */
  tm: TimeMachine | null;
  captures: Block[];
  captureAt: number;
  onCaptureAt: (at: number) => void;
  tabs?: [Tab, string][];
  children?: React.ReactNode;
} & TechProps) {
  const access = useAccess();
  const bucket = bucketFor(focus.bg);
  const pageLabel = PAGE_TYPE_LABEL[focus.pageType] ?? focus.pageType;
  return (
    <>
      {tabs.length > 1 && (
        <div role="tablist" aria-label="Block tools" className="flex gap-1 border-b px-3 py-1.5">
          {tabs.map(([t, l]) => (
            <button
              key={t}
              role="tab"
              type="button"
              id={`tab-${t}`}
              aria-selected={tab === t}
              aria-controls={`panel-${t}`}
              onClick={() => onTab(t)}
              className={cn(
                "rounded-md px-2 py-1 text-[12px] text-muted-foreground outline-none transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring touch:min-h-11",
                tab === t && "bg-muted text-foreground",
              )}
            >
              {l}
            </button>
          ))}
        </div>
      )}
      {tab === "brief" && (
        <div role="tabpanel" id="panel-brief" aria-labelledby="tab-brief" className="flex min-h-0 flex-1 flex-col">
          {access.can("brief") ? (
            <BriefPanel block={focus} />
          ) : (
            <ProOnly title="Copy as brief comes with Pro" signedIn={access.signedIn}>
              A ready-to-paste brief of this block for Claude Code, Cursor or a designer. Included in Pro and in the 7-day trial.
            </ProOnly>
          )}
        </div>
      )}
      {tab === "history" && (
        <div role="tabpanel" id="panel-history" aria-labelledby="tab-history" className="flex min-h-0 flex-1 flex-col">
          {!access.can("history") ? (
            <ProOnly title="The time machine comes with Pro" signedIn={access.signedIn}>
              See how this block changed across every capture of the page, side by side or as an overlay. Included in Pro and in the 7-day trial.
            </ProOnly>
          ) : (
            tm && <TimeMachineControls tm={tm} />
          )}
        </div>
      )}
      {tab === "details" && (
        <div role="tabpanel" id="panel-details" aria-labelledby="tab-details">
          <dl className="grid grid-cols-[88px_1fr] gap-x-3 gap-y-2.5 px-4 py-4 text-[13px]">
            <dt className="text-muted-foreground">Site</dt>
            <dd className="min-w-0">
              <Link
                href={`/sites/${encodeURIComponent(focus.host)}`}
                className="block truncate rounded-sm underline-offset-4 outline-none hover:text-link hover:underline focus-visible:ring-2 focus-visible:ring-ring touch:-my-3 touch:py-3"
                title={`${focus.host}: tech stack and every captured page`}
              >
                {focus.host}
              </Link>
            </dd>
            <dt className="text-muted-foreground">Page</dt>
            <dd className="min-w-0">
              {pageLabel}
              {focus.pageTitle && <span className="block truncate text-[12px] text-muted-foreground">{focus.pageTitle}</span>}
            </dd>
            <dt className="text-muted-foreground">Block</dt>
            <dd>{labelFor(focus.typeHint)}</dd>
            <dt className="text-muted-foreground">Style</dt>
            <dd>
              {platformLabel(focus.platform)}
              {focus.theme ? <span className="text-muted-foreground"> · {focus.theme}</span> : null}
            </dd>
            <dt className="text-muted-foreground">Colours</dt>
            <dd className="flex items-center gap-2">
              <span aria-hidden className="size-4 shrink-0 rounded-full border" style={{ background: focus.bg }} />
              <span>{bucket ? COLOUR_LABEL[bucket] : "Unknown"}</span>
              <span className="truncate font-mono text-[11px] text-muted-foreground">{focus.bg}</span>
            </dd>
            {focus.headline && (
              <>
                <dt className="text-muted-foreground">Headline</dt>
                <dd>{focus.headline}</dd>
              </>
            )}
            <dt className="text-muted-foreground">Contains</dt>
            <dd className="text-muted-foreground">
              {focus.buttons} buttons · {focus.images} images · {focus.videos} videos
            </dd>
            <dt className="text-muted-foreground">Size</dt>
            <dd className="font-mono text-[12px] tabular-nums">
              {focus.w} × {focus.h}
            </dd>
          </dl>
          <TechStack block={focus} counts={counts ?? null} onFilter={onFilter} />
          <Captures captures={captures} at={captureAt} onAt={onCaptureAt} />
          {children}
        </div>
      )}
    </>
  );
}

/**
 * How wide to draw a screenshot zoomed in, in CSS pixels. One image pixel per
 * screen pixel is as sharp as it gets, and where the fitted picture is already
 * close to that (a retina laptop), twice the fitted width, so a click always
 * gets visibly closer. Never past one image pixel per CSS pixel: the
 * screenshots are captured at 2x, so beyond that there is nothing more to see.
 */
export function zoomWidth(natural: number, fitted: number, dpr: number): number {
  return Math.min(natural, Math.max(natural / dpr, fitted * 2));
}

/**
 * Put the screenshot on the clipboard as a PNG, the one image type every
 * clipboard accepts. The ClipboardItem gets a promise rather than a blob so
 * Safari still sees the write as part of the click.
 */
export async function copyImage(url: string): Promise<void> {
  const png = (async () => {
    const response = await fetch(url, { mode: "cors" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    if (blob.type === "image/png") return blob;
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
    bitmap.close();
    return new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not encode PNG"))), "image/png"),
    );
  })();
  await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
}

const dateFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });

/** Earlier and later captures of this block, once recapture gives it any. */
function Captures({ captures, at, onAt }: { captures: Block[]; at: number; onAt: (i: number) => void }) {
  const when = (b: Block) => {
    const iso = capturedAtOf(b);
    return iso ? dateFormat.format(new Date(iso)) : "Date unknown";
  };
  return (
    <section className="border-t px-4 py-3" aria-label="Captures">
      <div className="flex items-center gap-1">
        <h3 className="text-[12px] font-medium">Captures</h3>
        <span className="ml-1 font-mono text-[11px] text-muted-foreground tabular-nums">{captures.length}</span>
        {captures.length > 1 && (
          <div className="ml-auto flex items-center gap-1">
            <Button variant="ghost" size="icon-sm" aria-label="Earlier capture" disabled={at === 0} onClick={() => onAt(at - 1)}>
              <ChevronLeft />
            </Button>
            <span className="min-w-24 text-center text-[12px] tabular-nums">{when(captures[at])}</span>
            <Button variant="ghost" size="icon-sm" aria-label="Later capture" disabled={at === captures.length - 1} onClick={() => onAt(at + 1)}>
              <ChevronRight />
            </Button>
          </div>
        )}
      </div>
      {captures.length === 1 && (
        <p className="mt-1 text-[12px] text-muted-foreground">
          One capture so far{capturedAtOf(captures[0]) ? `, ${when(captures[0])}` : ""}. Recaptures will line up here so you can
          see how the block changed.
        </p>
      )}
    </section>
  );
}

/** Platform, theme and apps as chips with library-wide counts; a chip filters the wall to it. */
function TechStack({ block, counts, onFilter }: { block: Block; counts: TechCounts | null; onFilter?: (key: TechKey, value: string) => void }) {
  const chips: [TechKey, string, string][] = [
    ...(block.platform ? [["platform", block.platform, platformLabel(block.platform)] as [TechKey, string, string]] : []),
    ...(block.theme ? [["theme", block.theme, block.theme] as [TechKey, string, string]] : []),
    ...block.apps.map((a) => ["app", a, a] as [TechKey, string, string]),
  ];
  if (chips.length === 0) return null;
  return (
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
                  className={cn(cls, "outline-none transition-colors duration-150 hover:border-primary/60 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring touch:min-h-11")}
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
  );
}
