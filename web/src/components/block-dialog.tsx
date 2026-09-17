"use client";

import { useEffect, useRef } from "react";
import { ExternalLink, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { labelFor, PAGE_TYPE_LABEL, type Block } from "@/lib/blocks";

/** Block detail: full-height sheet on phones, centred panel from 900px up. */
export function BlockDialog({ block, onClose }: { block: Block | null; onClose: () => void }) {
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
      {block && (
        <div className="flex max-h-dvh w-full flex-col overflow-hidden rounded-t-xl border bg-card text-card-foreground md:max-h-[92vh] md:max-w-[1200px] md:flex-row md:rounded-xl">
          <div className="relative flex-1 overflow-auto bg-white" style={{ background: block.bg }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={block.src}
              alt={`${labelFor(block.typeHint)} block from ${block.host}`}
              width={block.w}
              height={block.h}
              className={block.viewport === "mobile" ? "mx-auto block w-full max-w-[390px]" : "block w-full"}
            />
          </div>
          <aside className="flex max-h-[45vh] w-full shrink-0 flex-col border-t md:max-h-none md:w-[320px] md:border-t-0 md:border-l">
            <div className="flex items-center gap-2 border-b px-4 py-3">
              <h2 className="font-heading text-[15px] font-semibold">{labelFor(block.typeHint)}</h2>
              <span className="font-mono text-[11px] text-muted-foreground">{block.viewport}</span>
              <Button variant="ghost" size="icon-sm" className="ml-auto" aria-label="Close" onClick={onClose}>
                <X />
              </Button>
            </div>
            <dl className="grid grid-cols-[88px_1fr] gap-x-3 gap-y-2 overflow-auto px-4 py-3 text-[13px]">
              <dt className="text-muted-foreground">Site</dt>
              <dd className="truncate">{block.host}</dd>
              <dt className="text-muted-foreground">Page</dt>
              <dd>{PAGE_TYPE_LABEL[block.pageType] ?? block.pageType}</dd>
              <dt className="text-muted-foreground">Platform</dt>
              <dd>
                {block.platform ?? "unknown"}
                {block.theme ? ` · ${block.theme}` : ""}
              </dd>
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
              {block.apps.length > 0 && (
                <>
                  <dt className="text-muted-foreground">Apps</dt>
                  <dd className="flex flex-wrap gap-1">
                    {block.apps.map((a) => (
                      <span key={a} className="rounded-full bg-muted px-2 py-0.5 text-[11px]">
                        {a}
                      </span>
                    ))}
                  </dd>
                </>
              )}
            </dl>
            <div className="mt-auto border-t px-4 py-3">
              <a
                href={block.pageUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-[13px] text-primary underline-offset-4 hover:underline"
              >
                Open the source page <ExternalLink className="size-3.5" />
              </a>
            </div>
          </aside>
        </div>
      )}
    </dialog>
  );
}
