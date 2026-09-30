import { AppShell } from "@/components/app-shell";

/** The library (wall, flows, sites, boards) sits in the app bar; the landing page and share links (/b, /share) do not, so a client sees only the board. */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
