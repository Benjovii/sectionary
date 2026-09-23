"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, ExternalLink, Monitor, Smartphone, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StoreIcon } from "@/components/store-icon";
import { cn } from "@/lib/utils";
import { assetUrl } from "@/lib/data-source";
import { loadSiteView } from "@/lib/load-blocks";
import { labelFor, PAGE_TYPE_LABEL, type Block } from "@/lib/blocks";
import { industryLabel, platformLabel, rankLabel } from "@/lib/stores";
import type { ProfilePage, SiteView } from "@/lib/site-profile";

type Viewport = "desktop" | "mobile";

const dateFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });
const when = (iso: string | null) => (iso ? dateFormat.format(new Date(iso)) : "Date not recorded");

/** Page thumbnails are cut to this shape, tall enough to show a page's opening screens. */
const THUMB_RATIO = 5 / 4;

/**
 * A site's profile (SEC-19): who the store is, what it runs on, every page we
 * captured, and when. Loads on the client, like the wall, because the sample
 * set is only on the client; with NEXT_PUBLIC_SITES_SRC set it reads the API.
 */
export function SiteProfileView({ host }: { host: string }) {
  const [state, setState] = useState<{ host: string; view: SiteView | null; error: string | null } | null>(null);
  const [open, setOpen] = useState<ProfilePage | null>(null);

  useEffect(() => {
    let alive = true;
    loadSiteView(host).then(
      (view) => alive && setState({ host, view, error: null }),
      (e: Error) => alive && setState({ host, view: null, error: e.message }),
    );
    return () => {
      alive = false;
    };
  }, [host]);

  if (!state || state.host !== host) return <SiteProfileSkeleton />;

  if (state.error) {
    return (
      <Empty>
        <p>This profile could not be loaded ({state.error}).</p>
      </Empty>
    );
  }

  if (!state.view) {
    return (
      <Empty>
        <p className="text-foreground">We have no store at {host}.</p>
        <p className="mt-1 text-[12px]">It is not in the validated list and nothing from it has been captured.</p>
        <Link href="/sites" className="mt-3 inline-block text-[13px] text-primary underline-offset-4 hover:underline">
          Browse every site
        </Link>
      </Empty>
    );
  }

  const { store, listed, pages, captures } = state.view;
  const blockTotal = pages.reduce((n, p) => n + p.blockCount, 0);

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-3">
        <Link
          href="/sites"
          className="inline-flex w-fit items-center gap-1 rounded-md text-[12px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <ArrowLeft className="size-3.5" /> Sites
        </Link>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <StoreIcon key={store.host} host={store.host} brand={store.brand} size={44} className="rounded-lg" />
          <div className="min-w-0">
            <h1 className="font-heading text-[22px] leading-tight font-semibold">{store.brand}</h1>
            <a
              href={`https://${store.host}/`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-0.5 inline-flex items-center gap-1 font-mono text-[12px] text-muted-foreground underline-offset-4 hover:text-primary hover:underline"
            >
              {store.host} <ExternalLink className="size-3" />
            </a>
          </div>
          {blockTotal > 0 && (
            <Link
              href={`/?host=${encodeURIComponent(store.host)}`}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-2.5 text-[13px] font-medium text-primary-foreground transition-colors duration-150 outline-none hover:bg-primary/80 focus-visible:ring-3 focus-visible:ring-ring/50 sm:ml-auto"
            >
              See all {blockTotal.toLocaleString("en-US")} blocks <ArrowRight className="size-3.5" />
            </Link>
          )}
        </div>
      </header>

      <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
        <aside className="flex flex-col gap-3 lg:sticky lg:top-16 lg:order-2 lg:w-[320px] lg:shrink-0">
          <Card title="Tech stack">
            <Facts>
              <Fact label="Platform">{platformLabel(store.platform)}</Fact>
              <Fact label="Theme">
                {store.theme ?? <Unknown />}
                {store.themeVersion && <span className="font-mono text-[11px] text-muted-foreground"> {store.themeVersion}</span>}
              </Fact>
              {store.builder && <Fact label="Page builder">{store.builder}</Fact>}
              <Fact label="Apps">
                {store.apps.length ? (
                  <span className="flex flex-wrap gap-1">
                    {store.apps.map((a) => (
                      <span key={a} className="rounded-full bg-muted px-2 py-0.5 text-[11px]">
                        {a}
                      </span>
                    ))}
                  </span>
                ) : (
                  <span className="text-muted-foreground">None detected</span>
                )}
              </Fact>
            </Facts>
          </Card>
          <Card title="About">
            {listed ? (
              <Facts>
                <Fact label="Industry">{industryLabel(store.industry)}</Fact>
                <Fact label="Country">{store.country ?? <Unknown />}</Fact>
                <Fact label="Currency">{store.currency ?? <Unknown />}</Fact>
                <Fact label="Traffic rank">
                  <span className="font-mono text-[12px] tabular-nums">{rankLabel(store.rank)}</span>
                </Fact>
              </Facts>
            ) : (
              <p className="text-[12px] text-muted-foreground">
                Not in the validated store list yet, so industry, country and traffic rank are unknown. Everything here
                comes from its captures.
              </p>
            )}
          </Card>
          <Timeline captures={captures} className="hidden lg:block" />
        </aside>

        <section className="min-w-0 flex-1 lg:order-1" aria-label="Captured pages">
          <h2 className="mb-2.5 flex items-baseline gap-2 text-[13px] font-medium">
            Pages
            <span className="font-mono text-[11px] text-muted-foreground tabular-nums">{pages.length}</span>
          </h2>
          {pages.length === 0 ? (
            <Empty>
              <p>Not captured yet.</p>
              <p className="mt-1 text-[12px]">This store is on the list; its pages will appear here after the next crawl.</p>
            </Empty>
          ) : (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
              {pages.map((page) => (
                <li key={page.key}>
                  <PageCard page={page} onOpen={() => setOpen(page)} />
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* On one column the history reads after the pages, not before them. */}
        <Timeline captures={captures} className="lg:hidden" />
      </div>

      <PageViewer page={open} onClose={() => setOpen(null)} />
    </div>
  );
}

function PageCard({ page, onOpen }: { page: ProfilePage; onOpen: () => void }) {
  const path = page.url.replace(/^https?:\/\/[^/]+/, "") || "/";
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex w-full flex-col overflow-hidden rounded-lg border bg-card text-left transition-colors duration-150 outline-none hover:border-primary/60 focus-visible:ring-3 focus-visible:ring-ring/50"
      aria-label={`${PAGE_TYPE_LABEL[page.type] ?? page.type} page, ${path}`}
    >
      <PageThumb page={page} />
      <span className="flex flex-col gap-0.5 border-t px-2.5 py-2">
        <span className="flex items-baseline gap-2">
          <span className="text-[13px] font-medium">{PAGE_TYPE_LABEL[page.type] ?? page.type}</span>
          <span className="ml-auto font-mono text-[11px] text-muted-foreground tabular-nums">{page.blockCount} blocks</span>
        </span>
        <span className="truncate font-mono text-[11px] text-muted-foreground">{path}</span>
      </span>
    </button>
  );
}

/**
 * The page's opening screens. A full-page screenshot when the source has one;
 * otherwise the page's own blocks stacked in order, which is the page. The
 * mobile capture sits over the corner, so both viewports read at a glance.
 */
function PageThumb({ page }: { page: ProfilePage }) {
  return (
    <span className="relative block overflow-hidden bg-muted" style={{ aspectRatio: `1 / ${THUMB_RATIO}` }}>
      <Stack src={page.desktop} blocks={page.desktopBlocks} ratio={THUMB_RATIO} />
      {(page.mobile || page.mobileBlocks.length > 0) && (
        <span
          className="absolute right-2 bottom-2 block w-[28%] overflow-hidden rounded-md border-2 border-card shadow-lg"
          style={{ aspectRatio: "9 / 19" }}
        >
          <Stack src={page.mobile} blocks={page.mobileBlocks} ratio={19 / 9} />
        </span>
      )}
    </span>
  );
}

/** Enough of the page to fill a frame of height `ratio` × width, and no more. */
export function Stack({ src, blocks, ratio }: { src: string | null; blocks: Block[]; ratio: number }) {
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={assetUrl(src)} alt="" loading="lazy" decoding="async" className="block h-full w-full object-cover object-top" />;
  }
  const shown: Block[] = [];
  let filled = 0;
  for (const block of blocks) {
    shown.push(block);
    filled += block.h / block.w;
    if (filled >= ratio) break;
  }
  return (
    <span className="block h-full w-full">
      {shown.map((b) => (
        <span key={b.id} className="block" style={{ aspectRatio: `${b.w} / ${b.h}`, background: b.bg }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={assetUrl(b.src)} alt="" loading="lazy" decoding="async" className="block h-full w-full" />
        </span>
      ))}
    </span>
  );
}

/**
 * The whole page, full screen, top to bottom, with a switch between viewports.
 * Each block opens its detail view.
 */
function PageViewer({ page, onClose }: { page: ProfilePage | null; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [viewport, setViewport] = useState<Viewport>("desktop");

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (page && !d.open) d.showModal();
    if (!page && d.open) d.close();
  }, [page]);

  const hasDesktop = Boolean(page && (page.desktop || page.desktopBlocks.length));
  const hasMobile = Boolean(page && (page.mobile || page.mobileBlocks.length));
  // Desktop unless the page only has mobile.
  const current: Viewport = viewport === "mobile" ? (hasMobile ? "mobile" : "desktop") : hasDesktop ? "desktop" : "mobile";
  const blocks = page ? (current === "desktop" ? page.desktopBlocks : page.mobileBlocks) : [];
  const full = page ? (current === "desktop" ? page.desktop : page.mobile) : null;

  return (
    <dialog
      ref={ref}
      aria-label={page ? `${PAGE_TYPE_LABEL[page.type] ?? page.type} page, full screen` : "Page"}
      onClose={onClose}
      className="m-0 h-dvh max-h-dvh w-screen max-w-none bg-black/95 p-0 text-white backdrop:bg-black/70 open:flex open:flex-col"
    >
      {page && (
        <>
          <div className="flex h-12 shrink-0 items-center gap-2 px-2">
            <Button variant="ghost" size="icon" aria-label="Close" className="text-white hover:bg-white/10 hover:text-white" onClick={onClose}>
              <X />
            </Button>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium">{page.title ?? PAGE_TYPE_LABEL[page.type] ?? page.type}</p>
              <p className="truncate font-mono text-[11px] text-white/60">{page.url.replace(/^https?:\/\//, "")}</p>
            </div>
            {hasDesktop && hasMobile && (
              <div role="radiogroup" aria-label="Viewport" className="flex shrink-0 rounded-lg border border-white/15 p-0.5">
                {(["desktop", "mobile"] as const).map((v) => {
                  const Icon = v === "mobile" ? Smartphone : Monitor;
                  return (
                    <button
                      key={v}
                      type="button"
                      role="radio"
                      aria-checked={current === v}
                      aria-label={v === "mobile" ? "Mobile" : "Desktop"}
                      onClick={() => setViewport(v)}
                      className={cn(
                        "inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] font-medium transition-colors duration-150 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:px-2.5",
                        current === v ? "bg-white text-black" : "text-white/70 hover:text-white",
                      )}
                    >
                      <Icon className="size-3.5" />
                      <span className="hidden sm:inline">{v === "mobile" ? "Mobile" : "Desktop"}</span>
                    </button>
                  );
                })}
              </div>
            )}
            <a
              href={page.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Open the source page"
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-white/70 outline-none hover:bg-white/10 hover:text-white focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <ExternalLink className="size-4" />
            </a>
          </div>
          <div key={`${page.key}:${current}`} className="min-h-0 flex-1 overflow-auto px-3 pb-6 min-[900px]:px-8">
            <div className="mx-auto w-full" style={{ maxWidth: current === "desktop" ? 1440 : 390 }}>
              {full ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={assetUrl(full)} alt={`${page.title ?? page.type}, ${current}`} className="block w-full" />
              ) : (
                blocks.map((b) => (
                  <Link
                    key={b.id}
                    href={`/?open=${encodeURIComponent(b.id)}`}
                    className="group relative block outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                    style={{ aspectRatio: `${b.w} / ${b.h}`, background: b.bg }}
                    aria-label={`${labelFor(b.typeHint)} block, open its detail`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={assetUrl(b.src)} alt="" loading="lazy" decoding="async" className="block h-full w-full" />
                    {/* Where one block ends and the next begins, on hover. */}
                    <span className="pointer-events-none absolute inset-0 ring-2 ring-primary ring-inset opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100" />
                    <span className="pointer-events-none absolute top-2 left-2 rounded-full bg-primary px-2 py-0.5 text-[11px] font-medium text-primary-foreground opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100">
                      {labelFor(b.typeHint)}
                    </span>
                  </Link>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </dialog>
  );
}

/** When the site was captured, newest first. */
function Timeline({ captures, className }: { captures: SiteView["captures"]; className?: string }) {
  return (
    <Card title="Capture history" className={className}>
      {captures.length === 0 ? (
        <p className="text-[12px] text-muted-foreground">No captures yet.</p>
      ) : (
        <ol className="flex flex-col">
          {captures.map((c, i) => (
            <li key={c.capturedAt ?? "undated"} className="relative flex gap-3 pb-3 last:pb-0">
              {/* The rail: a dot per capture, joined by a line. */}
              <span className="relative flex w-3 shrink-0 justify-center">
                <span className={cn("mt-1 size-2 rounded-full", i === 0 ? "bg-primary" : "bg-muted-foreground/50")} />
                {i < captures.length - 1 && <span className="absolute top-3.5 bottom-[-4px] w-px bg-border" />}
              </span>
              <span className="flex flex-1 items-baseline gap-2 text-[13px]">
                {when(c.capturedAt)}
                <span className="ml-auto font-mono text-[11px] text-muted-foreground tabular-nums">
                  {c.pages} page{c.pages === 1 ? "" : "s"}
                </span>
              </span>
            </li>
          ))}
        </ol>
      )}
      {captures.length === 1 && (
        <p className="mt-2 text-[12px] text-muted-foreground">One capture so far. Weekly recaptures will add to this line.</p>
      )}
    </Card>
  );
}

function Card({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-lg border bg-card px-4 py-3", className)} aria-label={title}>
      <h2 className="mb-2.5 text-[12px] font-medium">{title}</h2>
      {children}
    </section>
  );
}

function Facts({ children }: { children: React.ReactNode }) {
  return <dl className="grid grid-cols-[96px_1fr] gap-x-3 gap-y-2 text-[13px]">{children}</dl>;
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </>
  );
}

function Unknown() {
  return <span className="text-muted-foreground">Unknown</span>;
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">{children}</div>;
}

/** The profile's shape with nothing in it, so nothing jumps when it loads. */
export function SiteProfileSkeleton() {
  return (
    <div className="flex flex-col gap-5" aria-busy="true" aria-label="Loading site">
      <div className="flex flex-col gap-3">
        <div className="shimmer h-3 w-12 rounded bg-muted" />
        <div className="shimmer h-6 w-48 rounded bg-muted" />
        <div className="shimmer h-3 w-32 rounded bg-muted" />
      </div>
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
        <div className="flex flex-col gap-3 lg:order-2 lg:w-[320px]">
          <div className="shimmer h-40 rounded-lg bg-muted" />
          <div className="shimmer h-28 rounded-lg bg-muted" />
        </div>
        <div className="grid flex-1 grid-cols-2 gap-3 sm:grid-cols-3 lg:order-1 xl:grid-cols-4">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="shimmer rounded-lg bg-muted" style={{ aspectRatio: `1 / ${THUMB_RATIO + 0.2}` }} />
          ))}
        </div>
      </div>
    </div>
  );
}
