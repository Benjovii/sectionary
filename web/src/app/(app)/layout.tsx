import { AppShell } from "@/components/app-shell";

/** The library (wall, flows, sites) sits in the app bar; the landing page does not. */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
