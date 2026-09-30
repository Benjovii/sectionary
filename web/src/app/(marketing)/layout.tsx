import Link from "next/link";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { LEGAL_PAGES } from "@/lib/site";

const NAV = [
  { href: "/", label: "Blocks" },
  { href: "/flows", label: "Flows" },
  { href: "/sites", label: "Sites" },
];

/**
 * The landing page's frame (SEC-25): the app bar's wordmark and hairline, a
 * little taller, with the waitlist as the one orange action. The legal pages
 * (SEC-29) share it.
 */
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only z-30 rounded-lg bg-primary px-3 py-2 text-[13px] font-medium text-primary-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto flex h-14 max-w-[1200px] items-center gap-2 px-4 sm:gap-4 sm:px-6">
          <Link href="/welcome" className="flex items-center gap-2 rounded-md outline-none touch:h-11 focus-visible:ring-2 focus-visible:ring-ring">
            <Logo />
            <span className="font-heading text-[16px] font-semibold tracking-[0.01em]">Sectionary</span>
          </Link>
          <nav aria-label="Library" className="ml-2 hidden items-center gap-0.5 sm:flex">
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className="inline-flex h-8 items-center rounded-md px-2.5 text-[13px] text-muted-foreground transition-colors duration-150 outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring touch:h-11"
              >
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-1.5">
            <ThemeToggle />
            {/* Also used by /terms, /privacy and /bot, so it names the page. */}
            <Link
              href="/welcome#join"
              className="inline-flex h-8 items-center rounded-lg bg-primary px-3 text-[13px] font-semibold text-primary-foreground outline-none transition-colors duration-150 hover:bg-primary/85 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background touch:h-11"
            >
              Join the waitlist
            </Link>
          </div>
        </div>
      </header>
      <main id="main" tabIndex={-1} data-landing className="flex-1 outline-none">
        {children}
      </main>
      <footer className="border-t">
        <div className="mx-auto flex max-w-[1200px] flex-col gap-6 px-4 py-10 sm:flex-row sm:items-start sm:justify-between sm:px-6">
          <div className="max-w-sm space-y-3">
            <div className="flex items-center gap-2">
              <Logo />
              <span className="font-heading text-[15px] font-semibold">Sectionary</span>
            </div>
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              Every block links back to the store it came from. Brand names identify a store; they don&apos;t mean it
              endorses us. We host our screenshots only, never a store&apos;s code or images.
            </p>
          </div>
          <nav aria-label="Footer" className="flex gap-10 text-[13px]">
            <ul className="space-y-2">
              <li className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">Library</li>
              {NAV.map((n) => (
                <li key={n.href}>
                  <Link href={n.href} className="rounded-sm outline-none hover:text-link focus-visible:ring-2 focus-visible:ring-ring">
                    {n.label}
                  </Link>
                </li>
              ))}
            </ul>
            <ul className="space-y-2">
              <li className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">Legal</li>
              {LEGAL_PAGES.map((n) => (
                <li key={n.href}>
                  <Link href={n.href} className="rounded-sm outline-none hover:text-link focus-visible:ring-2 focus-visible:ring-ring">
                    {n.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
        <div className="mx-auto max-w-[1200px] px-4 pb-8 font-mono text-[11px] text-muted-foreground sm:px-6">© 2026 Sectionary</div>
      </footer>
    </div>
  );
}
