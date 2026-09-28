import type { Metadata } from "next";
import Link from "next/link";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ArrowRight } from "lucide-react";
import type { Block, BlockSet } from "@/contracts/block";
import type { Store } from "@/lib/stores";
import { platformLabel } from "@/lib/stores";
import { assetUrl } from "@/lib/data-source";
import { WaitlistForm } from "@/components/waitlist-form";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: { absolute: "Sectionary · Every storefront, cut into blocks" },
  description:
    "A reference library of real online stores, cut into blocks: hero, buy box, reviews, cart. Desktop and phone side by side, with the platform, theme and apps behind each one. Join the waitlist.",
  openGraph: { title: "Every storefront, cut into blocks", siteName: "Sectionary", type: "website", url: "/welcome" },
  twitter: { card: "summary_large_image", title: "Every storefront, cut into blocks" },
};

// Everything on this page comes from the committed sample: the one store we
// have captured end to end (our own client, myzoobox.com) and the validated
// seed list. Nothing is invented, so the numbers move when the data does.
async function sample() {
  const dir = join(process.cwd(), "public/sample");
  const [blocks, stores] = await Promise.all([
    readFile(join(dir, "blocks.json"), "utf8").then((t) => JSON.parse(t) as BlockSet),
    readFile(join(dir, "stores.json"), "utf8").then((t) => JSON.parse(t) as { stores: Store[] }),
  ]);
  const pick = (src: string) => {
    const b = blocks.blocks.find((x) => x.src.endsWith(src));
    if (!b) throw new Error(`Landing page: sample block ${src} is missing`);
    return b;
  };
  const s = stores.stores;
  const distinct = (values: (string | null | undefined)[]) => new Set(values.filter(Boolean)).size;
  return {
    capturedAt: blocks.generatedAt,
    stats: {
      stores: s.length,
      shopify: s.filter((x) => x.platform === "shopify").length,
      platforms: distinct(s.map((x) => x.platform)),
      themes: distinct(s.map((x) => x.theme)),
      apps: distinct(s.flatMap((x) => x.apps ?? [])),
    },
    hero: {
      page: [
        { block: pick("home/blocks/d-01-header.jpg"), label: "Header" },
        { block: pick("home/blocks/d-02-hero.jpg"), label: "Hero" },
        { block: pick("home/blocks/d-08-zoo-home-part.jpg"), label: "How it works", crop: 0.62 },
        { block: pick("home/blocks/d-11-faq.jpg"), label: "FAQ", crop: 0.5 },
      ],
      phone: pick("home/blocks/m-02-hero.jpg"),
    },
    buyBox: {
      desktop: pick("products-zoologist-club-sibling-kit-easy-reader-3-month-plan/blocks/d-02-product.jpg"),
      mobile: pick("products-zoologist-club-sibling-kit-easy-reader-3-month-plan/blocks/m-02-product.jpg"),
    },
    flow: [
      { step: "Home", block: pick("home/blocks/d-02-hero.jpg") },
      { step: "Collection", block: pick("collections-edventures/blocks/d-03-product-grid.jpg") },
      { step: "Product", block: pick("products-zoologist-club-sibling-kit-easy-reader-3-month-plan/blocks/d-02-product.jpg") },
      { step: "Cart", block: pick("cart/blocks/d-02-cart-items.jpg") },
    ],
  };
}

const fmt = (n: number) => n.toLocaleString("en-US");

// The names people actually search for, which "hero, features, footer"
// galleries do not have. From docs/PLAN.md section 4.
const TAXONOMY = [
  "Buy box",
  "Variant picker",
  "Subscription picker",
  "Bundle builder",
  "Sticky add to cart",
  "Cart drawer",
  "Upsell",
  "Reviews",
  "Size guide",
  "Shipping promise",
  "Featured collection",
  "Product grid",
  "Filters",
  "Mega menu",
  "Announcement bar",
  "Hero",
  "FAQ",
  "How it works",
  "Trust badges",
  "Order confirmation",
];

const AUDIENCE = [
  {
    who: "Agencies and freelancers",
    job: "Five subscription product pages with a how-it-works stepper, on mobile, before tomorrow's client call.",
  },
  {
    who: "In-house design and CRO",
    job: "Benchmark competitors, brief a redesign, and prove a pattern exists before anyone builds it.",
  },
  {
    who: "Theme and app developers",
    job: "See how real stores put your theme or your app to work, on real pages, at both widths.",
  },
];

export default async function Welcome() {
  const data = await sample();
  const { stats } = data;
  const captured = new Date(data.capturedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

  return (
    <>
      {/* ─── Hero ─────────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        <div className="mx-auto grid max-w-[1200px] items-center gap-12 px-4 pt-14 pb-16 sm:px-6 md:pt-20 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-10 lg:pb-24">
          <div className="max-w-[560px]">
            <h1 className="font-heading text-[44px] leading-[0.98] font-semibold tracking-[-0.025em] text-balance sm:text-[64px] lg:text-[72px]">
              Every storefront, cut into blocks.
            </h1>
            <p className="mt-6 max-w-[34em] text-[17px] leading-relaxed text-muted-foreground text-pretty">
              Real online stores, sliced into the parts you design: hero, buy box, reviews, cart. Desktop and phone side
              by side, with the platform, theme and apps behind every one.
            </p>
            <div id="join" className="mt-8 max-w-[480px] scroll-mt-24">
              <WaitlistForm source="hero" />
              <p className="mt-3 text-[13px] text-muted-foreground">Free during the beta. One email, when your invite is ready.</p>
            </div>
          </div>
          <HeroCut page={data.hero.page} phone={data.hero.phone} />
        </div>
      </section>

      {/* ─── The library so far ───────────────────────────────────────────── */}
      <section className="border-y bg-card/60">
        <div className="mx-auto flex max-w-[1200px] flex-col gap-2 px-4 py-5 font-mono text-[12px] leading-relaxed text-muted-foreground sm:flex-row sm:items-baseline sm:gap-8 sm:px-6 sm:text-[13px]">
          <h2 className="shrink-0 text-foreground">The library so far</h2>
          <ul className="flex flex-wrap gap-x-6 gap-y-1">
            <Stat n={stats.stores}>stores lined up for capture</Stat>
            <Stat n={stats.shopify}>on Shopify</Stat>
            <Stat n={stats.platforms}>platforms</Stat>
            <Stat n={stats.themes}>themes</Stat>
            <Stat n={stats.apps}>apps detected</Stat>
          </ul>
        </div>
      </section>

      {/* ─── The wedge, in one screen ─────────────────────────────────────── */}
      <section aria-labelledby="wedge" className="mx-auto max-w-[1200px] px-4 py-20 sm:px-6 md:py-28">
        <div className="max-w-[640px]">
          <h2 id="wedge" className="font-heading text-[34px] leading-[1.05] font-semibold tracking-[-0.02em] text-balance sm:text-[44px]">
            One block, and everything behind it.
          </h2>
          <p className="mt-4 text-[16px] leading-relaxed text-muted-foreground text-pretty">
            Galleries show you a pretty screenshot. Sectionary tells you what it is, where it lives, how it looks on a
            phone, and what the store runs to make it work.
          </p>
        </div>
        <Anatomy desktop={data.buyBox.desktop} mobile={data.buyBox.mobile} captured={captured} />
        <ol className="mt-16 grid gap-x-10 gap-y-8 border-t pt-10 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["Named like a store", "Buy box, variant picker, cart drawer, upsell. The blocks commerce is built from, not just hero and footer."],
            ["Tech stack on every block", `Platform, theme and version, page builder, and ${stats.apps} apps and pixels, detected when the page is captured.`],
            ["Phone and desktop, paired", "Every page is captured at 1440 and 390 pixels wide, so the mobile version is never a guess."],
            ["Captured, not curated", "A polite crawler does the collecting, so the library grows by thousands of stores instead of a few hundred."],
          ].map(([title, body], i) => (
            <li key={title} className="space-y-2">
              <span className="font-mono text-[12px] text-link">{String(i + 1).padStart(2, "0")}</span>
              <h3 className="font-heading text-[18px] leading-snug font-semibold">{title}</h3>
              <p className="text-[14px] leading-relaxed text-muted-foreground text-pretty">{body}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* ─── Find a pattern ───────────────────────────────────────────────── */}
      <section aria-labelledby="find" className="border-t bg-card/40">
        <div className="mx-auto grid max-w-[1200px] gap-12 px-4 py-20 sm:px-6 md:py-28 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16">
          <div>
            <h2 id="find" className="font-heading text-[34px] leading-[1.05] font-semibold tracking-[-0.02em] text-balance sm:text-[44px]">
              Ask for the exact pattern.
            </h2>
            <p className="mt-4 max-w-[30em] text-[16px] leading-relaxed text-muted-foreground text-pretty">
              Filter by block, page, platform, theme and app at once. The question you would ask a colleague is a
              search here.
            </p>
            <Link
              href="/"
              className="mt-8 inline-flex items-center gap-1.5 rounded-md text-[14px] font-medium text-link underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
            >
              Browse the preview library <ArrowRight className="size-4" />
            </Link>
          </div>
          <div className="space-y-8">
            <figure className="rounded-xl border bg-background p-4 sm:p-5">
              <figcaption className="text-[15px] leading-snug">
                <span className="text-muted-foreground">&ldquo;</span>Product pages on the Impact theme that run Skio, on
                a phone<span className="text-muted-foreground">&rdquo;</span>
              </figcaption>
              <div className="mt-4 flex flex-wrap gap-1.5" aria-label="The same question as filters">
                {["Page: Product", "Theme: Impact", "App: Skio", "Phone"].map((f) => (
                  <span key={f} className="inline-flex h-7 items-center rounded-lg bg-foreground px-2.5 text-[12px] font-medium text-background">
                    {f}
                  </span>
                ))}
              </div>
            </figure>
            <div>
              <p className="font-mono text-[11px] tracking-wider text-muted-foreground uppercase">Blocks you can ask for</p>
              <ul className="mt-3 flex flex-wrap gap-1.5">
                {TAXONOMY.map((t) => (
                  <li key={t} className="inline-flex h-8 items-center rounded-lg border bg-background px-3 text-[13px] dark:border-input dark:bg-input/30">
                    {t}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ─── Flows ────────────────────────────────────────────────────────── */}
      <section aria-labelledby="flows" className="border-t">
        <div className="mx-auto max-w-[1200px] px-4 py-20 sm:px-6 md:py-28">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="max-w-[620px]">
              <h2 id="flows" className="font-heading text-[34px] leading-[1.05] font-semibold tracking-[-0.02em] text-balance sm:text-[44px]">
                Follow the whole path to checkout.
              </h2>
              <p className="mt-4 text-[16px] leading-relaxed text-muted-foreground text-pretty">
                A block makes sense next to the pages around it. Flows line up one store from home to cart, so you see
                how the pieces hand off.
              </p>
            </div>
            <Link
              href="/flows"
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md text-[14px] font-medium text-link underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
            >
              Open the flows <ArrowRight className="size-4" />
            </Link>
          </div>
          <ol className="-mx-4 mt-12 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:grid-cols-4 sm:overflow-visible sm:px-0 sm:pb-0">
            {data.flow.map(({ step, block }, i) => (
              <li key={step} className="w-[70%] shrink-0 snap-start sm:w-auto">
                <div className="flex items-center gap-2 pb-2.5">
                  <span className="font-mono text-[12px] text-link">{String(i + 1).padStart(2, "0")}</span>
                  <span className="text-[13px] font-medium">{step}</span>
                  {i < data.flow.length - 1 && <ArrowRight aria-hidden className="ml-auto hidden size-3.5 text-muted-foreground sm:block" />}
                </div>
                <Shot block={block} className="aspect-[4/3] rounded-lg border" alt={`${step} page of myzoobox.com`} />
              </li>
            ))}
          </ol>
          <p className="mt-4 font-mono text-[11px] text-muted-foreground">myzoobox.com · captured {captured}</p>
        </div>
      </section>

      {/* ─── Who it's for ─────────────────────────────────────────────────── */}
      <section aria-labelledby="for" className="border-t">
        <div className="mx-auto max-w-[1200px] px-4 py-20 sm:px-6 md:py-24">
          <h2 id="for" className="font-heading text-[28px] leading-tight font-semibold tracking-[-0.02em] sm:text-[34px]">
            Built for people who ship stores.
          </h2>
          <dl className="mt-10 divide-y border-y">
            {AUDIENCE.map((a) => (
              <div key={a.who} className="grid gap-1 py-6 md:grid-cols-[minmax(0,4fr)_minmax(0,8fr)] md:gap-10">
                <dt className="font-heading text-[19px] font-semibold">{a.who}</dt>
                <dd className="max-w-[60ch] text-[16px] leading-relaxed text-muted-foreground text-pretty">{a.job}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* ─── Closing call ─────────────────────────────────────────────────── */}
      <section aria-labelledby="cta" className="bg-primary text-primary-foreground">
        <div className="mx-auto grid max-w-[1200px] items-end gap-10 px-4 py-20 sm:px-6 md:py-24 lg:grid-cols-2">
          <div>
            <h2 id="cta" className="font-heading text-[40px] leading-[1] font-semibold tracking-[-0.025em] text-balance sm:text-[56px]">
              Get in before the library opens.
            </h2>
            <p className="mt-5 max-w-[30em] text-[16px] leading-relaxed text-pretty opacity-80">
              Agencies get invites first. We&apos;ll email you once, when yours is ready, and not again unless you ask.
            </p>
          </div>
          <WaitlistForm source="closing" tone="accent" className="lg:justify-self-end lg:max-w-[480px]" />
        </div>
      </section>
    </>
  );
}

function Stat({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="whitespace-nowrap">
      <span className="text-foreground tabular-nums">{fmt(n)}</span> {children}
    </li>
  );
}

/** A screenshot, top-aligned, painted with the block's own background while it loads. */
function Shot({ block, className, alt, ratio, eager = false }: { block: Block; className?: string; alt: string; ratio?: string; eager?: boolean }) {
  return (
    <div className={cn("overflow-hidden", className)} style={{ backgroundColor: block.bg, aspectRatio: ratio }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={assetUrl(block.src)}
        alt={alt}
        width={block.w}
        height={block.h}
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        className="block h-full w-full object-cover object-top"
      />
    </div>
  );
}

/**
 * The hero picture: a real home page, pulled apart at its seams. Each block
 * slides out from the page it was cut from and gets its label; the phone
 * version of the hero sits in front. Transforms only (no layout animation),
 * and the global reduced-motion rule makes it land instantly.
 */
function HeroCut({ page, phone }: { page: { block: Block; label: string; crop?: number }[]; phone: Block }) {
  return (
    <figure className="relative mx-auto w-full max-w-[600px] lg:mr-0" aria-label="A store's home page, cut into blocks">
      <div className="space-y-2 pr-8 sm:pr-14">
        {page.map(({ block, label, crop }, i) => (
          <div
            key={block.id}
            className="cut-in relative"
            style={{ "--cut-from": `${-(i * 10 + 4)}px`, "--cut-delay": `${120 + i * 90}ms` } as React.CSSProperties}
          >
            <Shot
              block={block}
              eager
              alt={`${label} block`}
              ratio={`${block.w} / ${Math.round(block.h * (crop ?? 1))}`}
              className="rounded-md border"
            />
            <span className="cut-label absolute top-1.5 left-1.5 rounded-md bg-background/90 px-1.5 py-0.5 font-mono text-[10px] text-foreground/80 ring-1 ring-border backdrop-blur-sm sm:text-[11px]">
              {String(i + 1).padStart(2, "0")} {label.toLowerCase()}
            </span>
          </div>
        ))}
      </div>
      <div
        className="cut-in absolute right-0 -bottom-6 w-[26%] min-w-[92px] rounded-[18px] border-[5px] border-[#2a2622] bg-[#2a2622] shadow-2xl ring-1 ring-white/10 sm:-bottom-8"
        style={{ "--cut-from": "24px", "--cut-delay": "560ms" } as React.CSSProperties}
      >
        <Shot block={phone} eager alt="The same hero on a phone" ratio="390 / 620" className="rounded-[13px]" />
      </div>
      <figcaption className="sr-only">myzoobox.com home page: header, hero, how it works and FAQ blocks, with the phone hero.</figcaption>
    </figure>
  );
}

/** The wedge in one screen: a buy box at both widths, with its record beside it. */
function Anatomy({ desktop, mobile, captured }: { desktop: Block; mobile: Block; captured: string }) {
  const rows: [string, React.ReactNode][] = [
    ["Block", "Buy box"],
    ["Page", <>Product page · {desktop.host}</>],
    ["Widths", "Desktop 1440 · Phone 390, captured together"],
    ["Platform", platformLabel(desktop.platform ?? "")],
    ["Theme", desktop.theme ?? "Unknown"],
    [
      "Apps",
      <ul key="apps" className="flex flex-wrap gap-1">
        {(desktop.apps ?? []).map((a) => (
          <li key={a} className="rounded-md bg-muted px-1.5 py-0.5 text-[12px]">
            {a}
          </li>
        ))}
      </ul>,
    ],
    ["Captured", captured],
  ];
  return (
    <div className="mt-12 grid items-start gap-8 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-12">
      <div className="relative pb-10 sm:pb-0">
        <Shot block={desktop} alt="A buy box on desktop" ratio="1400 / 695" className="rounded-lg border" />
        {/* Bottom left, over the product photo, so the buy box itself stays readable. */}
        <div className="absolute -bottom-2 left-3 w-[24%] min-w-[96px] rounded-[16px] border-[4px] border-[#2a2622] bg-[#2a2622] shadow-2xl ring-1 ring-white/10 sm:-bottom-10 sm:left-6">
          <Shot block={mobile} alt="The same buy box on a phone" ratio="375 / 700" className="rounded-[12px]" />
        </div>
      </div>
      <dl className="divide-y rounded-xl border bg-card text-[14px]">
        {rows.map(([k, v]) => (
          <div key={k} className="grid grid-cols-[88px_minmax(0,1fr)] gap-3 px-4 py-3">
            <dt className="font-mono text-[12px] leading-6 text-muted-foreground">{k}</dt>
            <dd className="leading-6">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
