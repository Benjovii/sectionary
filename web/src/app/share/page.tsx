import type { Metadata } from "next";
import { SnapshotBoard } from "@/components/snapshot-board";

export const metadata: Metadata = { title: "Shared board", robots: { index: false, follow: false } };

/** A board carried entirely in the link (#...), for sample mode where there is no database. */
export default function SnapshotRoute() {
  return <SnapshotBoard />;
}
