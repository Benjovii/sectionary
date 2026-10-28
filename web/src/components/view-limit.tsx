"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Lock } from "lucide-react";
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
  if (check.reason === "SIGN_IN_REQUIRED") {
    return (
      <div className="m-auto flex max-w-sm flex-col items-center gap-3 rounded-xl border bg-card p-8 text-center text-card-foreground">
        <p className="font-heading text-[15px] font-semibold">Sign in to open blocks</p>
        <p className="text-[13px] text-muted-foreground text-pretty">
          New accounts get every Pro feature free for 7 days: full-size screenshots, Copy as brief, the time machine and boards. No card needed.
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          <Link href={`/account?next=${encodeURIComponent(typeof window === "undefined" ? "/" : window.location.pathname + window.location.search)}`} className="inline-flex h-8 items-center rounded-lg bg-primary px-3 text-[13px] font-medium text-primary-foreground outline-none transition-colors duration-150 hover:bg-primary/80 focus-visible:ring-2 focus-visible:ring-ring touch:h-11">
            Start free trial
          </Link>
          <Button variant="outline" onClick={onClose}>
            Back to the wall
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className="m-auto flex max-w-sm flex-col items-center gap-3 rounded-xl border bg-card p-8 text-center text-card-foreground">
      <p className="font-heading text-[15px] font-semibold">That&apos;s today&apos;s {check.limit} blocks</p>
      <p className="text-[13px] text-muted-foreground text-pretty">
        The Free plan opens {check.limit} blocks a day; the count starts again at midnight UTC. Pro opens as many as you like and adds boards, Copy as brief and the time machine.
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

/** In place of a Pro tool for Free (after the trial) and signed-out viewers. */
export function ProOnly({ title, children, signedIn }: { title: string; children: React.ReactNode; signedIn: boolean }) {
  return (
    <div className="flex flex-col items-start gap-2 px-4 py-4">
      <p className="inline-flex items-center gap-1.5 font-heading text-[14px] font-semibold">
        <Lock aria-hidden className="size-3.5 text-muted-foreground" /> {title}
      </p>
      <p className="text-[13px] text-muted-foreground text-pretty">{children}</p>
      <Link href={signedIn ? "/account" : "/account?next=/"} className="inline-flex h-8 items-center rounded-lg bg-primary px-3 text-[13px] font-medium text-primary-foreground outline-none transition-colors duration-150 hover:bg-primary/80 focus-visible:ring-2 focus-visible:ring-ring touch:h-11">
        {signedIn ? "See plans" : "Start free trial"}
      </Link>
    </div>
  );
}
