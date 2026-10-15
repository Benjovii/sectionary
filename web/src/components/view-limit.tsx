"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { ViewCheck } from "@/contracts/api";
import { Button } from "@/components/ui/button";
import { API_MODE } from "@/lib/data-source";

/**
 * The Free plan's daily cap (SEC-28) as the detail view sees it: asks
 * /api/views each time a block opens. Shows the block while it asks, and on
 * any error, so a slow or broken count never hides the library.
 */
export function useViewCheck(blockId: string | null): ViewCheck | null {
  const [check, setCheck] = useState<{ id: string; result: ViewCheck } | null>(null);
  useEffect(() => {
    if (!API_MODE || !blockId) return;
    let alive = true;
    fetch("/api/views", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ blockId }) })
      .then((r) => (r.ok ? (r.json() as Promise<ViewCheck>) : null))
      .then((result) => alive && result && setCheck({ id: blockId, result }))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [blockId]);
  return check && check.id === blockId ? check.result : null;
}

export function ViewLimitPanel({ check, onClose }: { check: ViewCheck; onClose: () => void }) {
  const signedIn = check.plan !== null;
  return (
    <div className="m-auto flex max-w-sm flex-col items-center gap-3 rounded-xl border bg-card p-8 text-center text-card-foreground">
      <p className="font-heading text-[15px] font-semibold">That&apos;s today&apos;s {check.limit} blocks</p>
      <p className="text-[13px] text-muted-foreground text-pretty">
        The Free plan opens {check.limit} blocks a day; the count starts again at midnight UTC. Pro opens as many as you like and adds boards.
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        <Link href={signedIn ? "/account" : "/account?next=/"} className="inline-flex h-8 items-center rounded-lg bg-primary px-3 text-[13px] font-medium text-primary-foreground outline-none transition-colors duration-150 hover:bg-primary/80 focus-visible:ring-2 focus-visible:ring-ring touch:h-11">
          {signedIn ? "See plans" : "Sign in"}
        </Link>
        <Button variant="outline" onClick={onClose}>
          Back to the wall
        </Button>
      </div>
    </div>
  );
}
