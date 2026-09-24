"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/", label: "Blocks" },
  { href: "/flows", label: "Flows" },
  { href: "/sites", label: "Sites" },
];

/** The three sections. A client component only to mark the current one, which
 *  screen readers announce ("current page") and the style picks up. */
export function NavLinks() {
  const pathname = usePathname();
  return (
    <nav aria-label="Primary" className="ml-1 flex items-center gap-0.5 sm:ml-2">
      {NAV.map((n) => {
        const current = n.href === "/" ? pathname === "/" : pathname === n.href || pathname.startsWith(`${n.href}/`);
        return (
          <Link
            key={n.href}
            href={n.href}
            aria-current={current ? "page" : undefined}
            className="inline-flex h-7 items-center rounded-md px-2 text-[13px] text-muted-foreground transition-colors duration-150 outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring aria-[current=page]:text-foreground aria-[current=page]:font-medium touch:h-11"
          >
            {n.label}
          </Link>
        );
      })}
    </nav>
  );
}
