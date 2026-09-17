import type { Metadata } from "next";

export const metadata: Metadata = { title: "Sites" };

export default function SitesRoute() {
  return (
    <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
      <h1 className="font-heading text-[15px] font-semibold text-foreground">Sites</h1>
      <p className="mt-1">One profile per store: platform, theme, apps, every captured page, capture history. Coming with SEC-19.</p>
    </div>
  );
}
