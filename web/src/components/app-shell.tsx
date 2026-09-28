import Link from "next/link";
import { Logo } from "@/components/logo";
import { NavLinks } from "@/components/nav-links";
import { ThemeToggle } from "@/components/theme-toggle";

/** Top bar (48px, hairline) plus the page. Mobile first: the nav stays inline
 *  because it is three short words; the search field grows on wider screens. */
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      {/* The first thing Tab reaches, so keyboard users can go straight past the bar. */}
      <a
        href="#main"
        className="sr-only z-30 rounded-lg bg-primary px-3 py-2 text-[13px] font-medium text-primary-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto flex h-12 max-w-[1800px] items-center gap-2 px-3 sm:gap-4 sm:px-4">
          <Link href="/welcome" aria-label="Sectionary home" className="flex items-center gap-2 rounded-md outline-none touch:h-11 focus-visible:ring-2 focus-visible:ring-ring">
            <Logo />
            <span className="font-heading text-[15px] font-semibold tracking-[0.01em]">Sectionary</span>
          </Link>
          <NavLinks />
          <div className="ml-auto flex items-center gap-1">
            <span className="hidden font-mono text-[11px] tabular-nums text-muted-foreground md:inline">preview · sample data</span>
            <ThemeToggle />
          </div>
        </div>
      </header>
      <main id="main" tabIndex={-1} className="mx-auto outline-none w-full max-w-[1800px] flex-1 px-3 py-3 sm:px-4 sm:py-4">{children}</main>
    </div>
  );
}
