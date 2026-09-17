import type { Metadata } from "next";
import { Suspense } from "react";
import { StoresTable, StoresTableSkeleton } from "@/components/stores-table";

export const metadata: Metadata = { title: "Sites" };

export default function SitesRoute() {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="font-heading text-[15px] font-semibold">Sites</h1>
        <p className="text-[12px] text-muted-foreground">
          The validated seed list: real stores, alive, ranked by Tranco traffic rank, with platform, theme, industry and apps detected on capture.
        </p>
      </div>
      <Suspense fallback={<StoresTableSkeleton />}>
        <StoresTable />
      </Suspense>
    </div>
  );
}
