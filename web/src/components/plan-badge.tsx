"use client";

import { useState } from "react";
import Link from "next/link";
import { useAccess } from "@/lib/account";

const DAY = 86_400_000;

/**
 * In the app bar, only while the plan gates are on: "Pro trial · 5 days left",
 * "Trial ended · Upgrade", or "Start free trial" signed out. Nothing for paid
 * plans, and nothing until the account answers, so it never flashes.
 */
export function PlanBadge() {
  const access = useAccess();
  // Read once: days left does not need to tick while the page is open.
  const [now] = useState(() => Date.now());
  if (!access.ready || !access.gates || access.plan !== "free") return null;

  let text: string;
  let strong = false;
  if (!access.signedIn) {
    text = "Start free trial";
    strong = true;
  } else if (access.onTrial && access.trialEndsAt) {
    const days = Math.max(1, Math.ceil((new Date(access.trialEndsAt).getTime() - now) / DAY));
    text = `Pro trial · ${days} ${days === 1 ? "day" : "days"} left`;
  } else {
    text = "Trial ended · Upgrade";
    strong = true;
  }
  return (
    <Link
      href="/account"
      className={
        strong
          ? "inline-flex h-7 items-center rounded-lg bg-primary px-2.5 text-[12px] font-medium text-primary-foreground outline-none transition-colors duration-150 hover:bg-primary/80 focus-visible:ring-2 focus-visible:ring-ring touch:h-11"
          : "inline-flex h-7 items-center rounded-lg border px-2.5 font-mono text-[11px] tabular-nums text-muted-foreground outline-none transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring touch:h-11"
      }
    >
      {text}
    </Link>
  );
}
