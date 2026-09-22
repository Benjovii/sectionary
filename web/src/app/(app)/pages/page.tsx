import type { Metadata } from "next";

export const metadata: Metadata = { title: "Pages" };

export default function PagesRoute() {
  return (
    <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
      <h1 className="font-heading text-[15px] font-semibold text-foreground">Pages</h1>
      <p className="mt-1">Full desktop and mobile captures, side by side, with the tech stack. Coming with SEC-19 and SEC-20.</p>
    </div>
  );
}
