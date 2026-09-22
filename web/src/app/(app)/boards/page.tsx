import type { Metadata } from "next";
import { BoardsList } from "@/components/boards-list";

export const metadata: Metadata = { title: "Boards" };

export default function BoardsRoute() {
  return <BoardsList />;
}
