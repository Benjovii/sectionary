"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Lock } from "lucide-react";
import type { ViewCheck } from "@/contracts/api";
import { Button } from "@/components/ui/button";
import { API_MODE } from "@/lib/data-source";
import { DEV_DAILY_VIEWS, DEV_VIEWS_KEY, devAs, useAccess, type DevAs } from "@/lib/account";

/**
 * The Free plan's daily cap (SEC-28) as the detail view sees it: asks
 * /api/views each time a block opens. Shows the block while it asks, and on
 * any error, so a slow or broken count never hides the library.
 */
export function useViewCheck(blockId: string | null): ViewCheck | null {
  const [check, setCheck] = useState<{ id: string; result: ViewCheck } | null>(null);
  useEffect(() => {
    if (!blockId) return;
    let alive = true;
    const as = devAs();
    if (as) {
      Promise.resolve(devViewCheck(as, blockId)).then((result) => alive && setCheck({ id: blockId, result }));
      return () => {
        alive = false;
      };
    }
    if (!API_MODE) return;
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

/** Development only (see devAs): /api/views as it answers with the gates on, the count kept in this browser. */
function devViewCheck(as: DevAs, blockId: string): ViewCheck {
  if (as === "out") return { allowed: false, used: 0, limit: null, plan: null, reason: "SIGN_IN_REQUIRED" };
  if (as === "trial") return { allowed: true, used: 0, limit: null, plan: "free" };
  const day = new Date().toISOString().slice(0, 10);
  let ids: string[] = [];
  try {
    const saved = JSON.parse(localStorage.getItem(DEV_VIEWS_KEY) ?? "null") as { day: string; ids: string[] } | null;
    if (saved?.day === day) ids = saved.ids;
  } catch {}
  if (!ids.includes(blockId)) {
    if (ids.length >= DEV_DAILY_VIEWS) return { allowed: false, used: ids.length, limit: DEV_DAILY_VIEWS, plan: "free", reason: "LIMIT" };
    ids = [...ids, blockId];
    try {
      localStorage.setItem(DEV_VIEWS_KEY, JSON.stringify({ day, ids }));
    } catch {}
  }
  return { allowed: true, used: ids.length, limit: DEV_DAILY_VIEWS, plan: "free" };
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
        The Free plan opens {check.limit} blocks a day in full; the count starts again at midnight UTC. Pro shows the whole library in full and adds boards, Copy as brief and the time machine.
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

/**
 * Beside the wall's Web / Mobile switch while the previews are blurred: why,
 * and the way out. Nothing until the account answers, so Pro never sees it flash.
 */
export function PreviewNotice() {
  const access = useAccess();
  if (!access.ready || access.can("full-images")) return null;
  const opens = access.dailyViews ? `Open ${access.dailyViews} blocks a day in full` : "Open a few blocks a day in full";
  return (
    <p className="flex min-w-0 basis-full items-start gap-2 text-[12px] text-muted-foreground sm:ml-auto sm:basis-auto sm:items-center">
      <Lock aria-hidden className="mt-0.5 size-3.5 shrink-0 sm:mt-0" />
      <span className="text-pretty sm:truncate">
        {access.signedIn ? `Your Pro trial has ended, so these are previews. ${opens}, or upgrade to see everything.` : "These are previews. Start a free 7-day Pro trial to see every block in full."}
      </span>
      <Link href={access.signedIn ? "/account" : "/account?next=/"} className="shrink-0 font-medium text-link underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring">
        {access.signedIn ? "Upgrade" : "Start free trial"}
      </Link>
    </p>
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
