import type { Metadata } from "next";
import { Suspense } from "react";
import { FlowsIndex, FlowsSkeleton } from "@/components/flows-index";

export const metadata: Metadata = { title: "Flows" };

export default function FlowsRoute() {
  return (
    <Suspense fallback={<FlowsSkeleton />}>
      <FlowsIndex />
    </Suspense>
  );
}
