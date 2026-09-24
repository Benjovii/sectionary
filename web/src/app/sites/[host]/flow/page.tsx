import type { Metadata } from "next";
import { FlowView } from "@/components/flow-view";

// Params typed by hand, as on the profile route: CI type-checks before
// `next build` has generated the PageProps helper.
type Props = { params: Promise<{ host: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { host } = await params;
  return { title: `${decodeURIComponent(host)} flow` };
}

export default async function FlowRoute({ params }: Props) {
  const { host } = await params;
  return <FlowView host={decodeURIComponent(host).toLowerCase()} />;
}
