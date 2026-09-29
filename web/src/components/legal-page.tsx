import Link from "next/link";
import { CONTACT_EMAIL, LEGAL_PAGES, LEGAL_UPDATED } from "@/lib/site";
import { cn } from "@/lib/utils";

export type LegalSection = { id: string; title: string; body: React.ReactNode };

/**
 * The frame Terms, Privacy and /bot share (SEC-29): the landing page's type
 * (Bricolage titles, mono labels, the orange for links), a reading column of
 * about 68 characters, and the section list pinned beside it on wide screens.
 */
export function LegalPage({
  eyebrow,
  title,
  lede,
  sections,
  current,
  aside,
}: {
  eyebrow: string;
  title: string;
  lede: React.ReactNode;
  sections: LegalSection[];
  current: (typeof LEGAL_PAGES)[number]["href"];
  /** Sits under the lede, full width; /bot puts its robots.txt card here. */
  aside?: React.ReactNode;
}) {
  const updated = new Date(LEGAL_UPDATED).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  return (
    <>
      <section className="border-b">
        <div className="mx-auto max-w-[1200px] px-4 pt-14 pb-12 sm:px-6 md:pt-20 md:pb-16">
          <p className="hero-rise font-mono text-[12px] tracking-wider text-link uppercase">{eyebrow}</p>
          <h1 className="hero-rise mt-4 max-w-[16em] font-heading text-[40px] leading-[1] font-semibold tracking-[-0.025em] text-balance sm:text-[56px]" style={rise(100)}>
            {title}
          </h1>
          <div className="hero-rise mt-5 max-w-[38em] text-[17px] leading-relaxed text-muted-foreground text-pretty" style={rise(200)}>
            {lede}
          </div>
          <p className="hero-rise mt-6 font-mono text-[12px] text-muted-foreground" style={rise(300)}>
            Last updated <time dateTime={LEGAL_UPDATED}>{updated}</time>
          </p>
          {aside && (
            <div className="hero-rise mt-10" style={rise(400)}>
              {aside}
            </div>
          )}
        </div>
      </section>

      <div className="mx-auto grid max-w-[1200px] gap-10 px-4 py-14 sm:px-6 md:py-20 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-16">
        <nav aria-label="On this page" className="hidden lg:block">
          <div className="sticky top-24">
            <p className="font-mono text-[11px] tracking-wider text-muted-foreground uppercase">On this page</p>
            <ol className="mt-3 space-y-1 border-l text-[13px]">
              {sections.map((s, i) => (
                <li key={s.id}>
                  <a
                    href={`#${s.id}`}
                    className="-ml-px flex gap-2 border-l border-transparent py-1 pl-3 text-muted-foreground outline-none transition-colors duration-150 hover:border-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="font-mono text-[11px] leading-5 text-link">{num(i)}</span>
                    <span className="leading-5">{s.title}</span>
                  </a>
                </li>
              ))}
            </ol>
          </div>
        </nav>

        <article className="legal max-w-[68ch]">
          {sections.map((s, i) => (
            <section key={s.id} id={s.id} aria-labelledby={`${s.id}-h`} className="scroll-mt-24 border-t pt-8 pb-10 first:border-t-0 first:pt-0">
              <h2 id={`${s.id}-h`} className="flex items-baseline gap-3 font-heading text-[22px] leading-tight font-semibold tracking-[-0.01em] sm:text-[26px]">
                <span className="font-mono text-[12px] font-normal text-link">{num(i)}</span>
                {s.title}
              </h2>
              <div className="mt-4">{s.body}</div>
            </section>
          ))}

          <nav aria-label="Legal" className="mt-4 flex flex-wrap gap-2 border-t pt-8">
            {LEGAL_PAGES.map((p) => (
              <Link
                key={p.href}
                href={p.href}
                aria-current={p.href === current ? "page" : undefined}
                className={cn(
                  "inline-flex h-8 items-center rounded-lg border px-3 text-[13px] outline-none transition-colors duration-150 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring touch:h-11 dark:border-input",
                  p.href === current && "border-foreground bg-foreground text-background hover:bg-foreground dark:border-foreground",
                )}
              >
                {p.label}
              </Link>
            ))}
          </nav>
        </article>
      </div>
    </>
  );
}

/** The contact address as a link, or an honest note while it doesn't exist yet. */
export function Contact({ subject }: { subject?: string }) {
  if (!CONTACT_EMAIL) return <>our contact address, which goes up here with our domain in the coming weeks</>;
  const href = `mailto:${CONTACT_EMAIL}${subject ? `?subject=${encodeURIComponent(subject)}` : ""}`;
  return <a href={href}>{CONTACT_EMAIL}</a>;
}

const num = (i: number) => String(i + 1).padStart(2, "0");
const rise = (ms: number) => ({ "--rise-delay": `${ms}ms` }) as React.CSSProperties;
