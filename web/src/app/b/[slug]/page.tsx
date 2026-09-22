import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { SharedBoardView } from "@/components/shared-board";
import { hasDatabase } from "@/server/blocks";
import { sharedBoard } from "@/server/boards";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

// Rendered on the server so the link unfurls with the board's name in Slack, email or WhatsApp.
const load = cache(async (slug: string) => (hasDatabase() ? sharedBoard(slug) : null));

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const board = await load((await params).slug);
  return {
    title: board?.name ?? "Board not found",
    description: board?.description ?? `${board?.items.length ?? 0} website references, collected with Sectionary.`,
    // Share links are unlisted: reachable by link, never by search.
    robots: { index: false, follow: false },
  };
}

export default async function SharedBoardRoute({ params }: Props) {
  const board = await load((await params).slug);
  if (!board) notFound();
  return <SharedBoardView name={board.name} description={board.description} updatedAt={board.updatedAt} items={board.items} />;
}
