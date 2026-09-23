import type { Metadata } from "next";
import { SiteProfileView } from "@/components/site-profile";

// Params typed by hand rather than with the generated PageProps helper: CI
// type-checks before `next build` has generated it.
type Props = { params: Promise<{ host: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { host } = await params;
  return { title: decodeURIComponent(host) };
}

export default async function SiteRoute({ params }: Props) {
  const { host } = await params;
  // Hosts are stored lower-case, and a pasted link may not be.
  return <SiteProfileView host={decodeURIComponent(host).toLowerCase()} />;
}
