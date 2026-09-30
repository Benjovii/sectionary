"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { assetUrl } from "@/lib/data-source";
import { boardStore, onBoardsChanged, type BoardSummary } from "@/lib/boards";

/** Your boards, newest first, and a field to start one. */
export function BoardsList() {
  const [boards, setBoards] = useState<BoardSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  useEffect(() => {
    let alive = true;
    const load = () => boardStore.list().then((b) => alive && setBoards(b)).catch((e: Error) => alive && setError(e.message));
    load();
    const off = onBoardsChanged(load);
    return () => {
      alive = false;
      off();
    };
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      const b = await boardStore.create(name);
      router.push(`/boards/${b.id}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="font-heading text-[15px] font-semibold">Boards</h1>
        <p className="text-[12px] text-muted-foreground">
          Collect blocks for a project, put them in order, add a note to each, and send the client one link.
        </p>
      </div>

      <form onSubmit={create} className="flex max-w-md gap-1.5">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name a new board, e.g. Acme PDP refresh"
          aria-label="New board name"
          maxLength={120}
          className="h-8 min-w-0 flex-1 rounded-lg border bg-background px-2.5 text-[13px] outline-none placeholder:text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
        />
        <Button type="submit" disabled={!name.trim() || busy}>
          <Plus /> Create
        </Button>
      </form>

      {error && <p className="text-[12px] text-destructive">{error}</p>}

      {boards === null ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-busy="true" aria-label="Loading boards">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="overflow-hidden rounded-lg border bg-card">
              <div className="shimmer aspect-[16/10] bg-muted" />
              <div className="p-3">
                <div className="shimmer h-3 w-32 rounded bg-muted" />
              </div>
            </div>
          ))}
        </div>
      ) : boards.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
          <p>No boards yet.</p>
          <p className="mt-1 text-[12px]">
            Name one above, or open any block on the{" "}
            <Link href="/" className="text-primary underline-offset-4 hover:underline">
              wall
            </Link>{" "}
            and press Save.
          </p>
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {boards.map((b) => (
            <li key={b.id}>
              <Link
                href={`/boards/${b.id}`}
                className="group block overflow-hidden rounded-lg border bg-card outline-none transition-colors duration-150 hover:border-primary/60 focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <div className="aspect-[16/10] overflow-hidden bg-muted" style={{ background: b.cover?.bg }}>
                  {b.cover && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={assetUrl(b.cover.src)} alt="" loading="lazy" className="h-full w-full object-cover object-top" />
                  )}
                </div>
                <div className="flex items-baseline gap-2 px-3 py-2.5">
                  <span className="truncate text-[13px] font-medium">{b.name}</span>
                  <span className="ml-auto shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
                    {b.blockIds.length} block{b.blockIds.length === 1 ? "" : "s"}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[11px] text-muted-foreground">Until accounts arrive, your boards are tied to this browser.</p>
    </div>
  );
}
