import type { Metadata } from "next";
import { SiteProfileView } from "@/components/site-profile";

export async function generateMetadata(props: PageProps<"/sites/[host]">): Promise<Metadata> {
  const { host } = await props.params;
  return { title: decodeURIComponent(host) };
}

export default async function SiteRoute(props: PageProps<"/sites/[host]">) {
  const { host } = await props.params;
  // Hosts are stored lower-case, and a pasted link may not be.
  return <SiteProfileView host={decodeURIComponent(host).toLowerCase()} />;
}
