import type { Metadata } from "next";
import { Suspense } from "react";
import { FlowSkeleton, FlowView } from "@/components/flow-view";

// Params typed by hand, as on the profile route: CI type-checks before
// `next build` has generated the PageProps helper.
type Props = { params: Promise<{ host: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { host } = await params;
  return { title: `${decodeURIComponent(host)} flow` };
}

export default async function FlowRoute({ params }: Props) {
  const { host } = await params;
  // Suspense: the view reads its switches from the URL (useSearchParams).
  return (
    <Suspense fallback={<FlowSkeleton />}>
      <FlowView host={decodeURIComponent(host).toLowerCase()} />
    </Suspense>
  );
}
