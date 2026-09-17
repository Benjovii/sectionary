import Link from "next/link";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";

const NAV = [
  { href: "/", label: "Blocks" },
  { href: "/pages", label: "Pages" },
  { href: "/sites", label: "Sites" },
];

/** Top bar (48px, hairline) plus the page. Mobile first: the nav stays inline
 *  because it is three short words; the search field grows on wider screens. */
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto flex h-12 max-w-[1800px] items-center gap-2 px-3 sm:gap-4 sm:px-4">
          <Link href="/" className="flex items-center gap-2 rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
            <Logo />
            <span className="font-heading text-[15px] font-semibold tracking-[0.01em]">Sectionary</span>
          </Link>
          <nav aria-label="Primary" className="ml-1 flex items-center gap-0.5 sm:ml-2">
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className="rounded-md px-2 py-1 text-[13px] text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 outline-none aria-[current=page]:text-foreground"
              >
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-1">
            <span className="hidden font-mono text-[11px] tabular-nums text-muted-foreground md:inline">preview · sample data</span>
            <ThemeToggle />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1800px] flex-1 px-3 py-3 sm:px-4 sm:py-4">{children}</main>
    </div>
  );
}
