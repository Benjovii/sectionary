import type { Metadata } from "next";
import { Suspense } from "react";
import { SitesGrid, SitesGridSkeleton } from "@/components/sites-grid";

export const metadata: Metadata = { title: "Sites" };

export default function SitesRoute() {
  return (
    <Suspense fallback={<SitesGridSkeleton />}>
      <SitesGrid />
    </Suspense>
  );
}
