import { AppShell } from "@/components/app-shell";

/** The browsing app: top bar and nav. Share links (/b, /share) sit outside it, so a client sees only the board. */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
