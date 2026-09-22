import type { Metadata } from "next";
import { BoardEditor } from "@/components/board-editor";

export const metadata: Metadata = { title: "Board" };

export default async function BoardRoute({ params }: { params: Promise<{ id: string }> }) {
  return <BoardEditor id={(await params).id} />;
}
