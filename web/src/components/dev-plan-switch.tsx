"use client";

import { useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";
import { DEV_AS_KEY, DEV_VIEWS_KEY, devAs, type DevAs } from "@/lib/account";

const noop = () => () => {};

const OPTIONS: { value: DevAs | null; label: string }[] = [
  { value: null, label: "Real" },
  { value: "out", label: "Signed out" },
  { value: "trial", label: "Trial" },
  { value: "free", label: "Free" },
];

/**
 * Development only (`npm run dev`), bottom right: view the app as signed out,
 * on the Pro trial or Free after it, with the plan gates on. "Real" is
 * whatever /api/account says. The choice lives in this browser and reloads
 * the page, since the account is read once per load (lib/account.ts).
 */
export function DevPlanSwitch() {
  // Undefined on the server and while hydrating: the server has no localStorage.
  const as = useSyncExternalStore(noop, devAs, () => undefined);
  if (process.env.NODE_ENV !== "development" || as === undefined) return null;

  const pick = (value: DevAs | null) => {
    try {
      if (value) localStorage.setItem(DEV_AS_KEY, value);
      else localStorage.removeItem(DEV_AS_KEY);
    } catch {}
    location.reload();
  };
  const resetViews = () => {
    try {
      localStorage.removeItem(DEV_VIEWS_KEY);
    } catch {}
    location.reload();
  };

  return (
    <div
      role="group"
      aria-label="Development: view as plan"
      className="fixed right-3 bottom-3 z-50 flex items-center gap-0.5 rounded-lg border bg-popover/95 p-0.5 font-mono text-[11px] text-popover-foreground shadow-lg backdrop-blur"
    >
      <span className="px-1.5 text-muted-foreground">dev · view as</span>
      {OPTIONS.map((o) => (
        <button
          key={o.label}
          type="button"
          aria-pressed={as === o.value}
          onClick={() => pick(o.value)}
          className={cn(
            "h-6 rounded-md px-1.5 outline-none transition-colors duration-150 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring",
            as === o.value && "bg-primary text-primary-foreground hover:bg-primary/80",
          )}
        >
          {o.label}
        </button>
      ))}
      {as === "free" && (
        <button
          type="button"
          onClick={resetViews}
          title="Start today's count of opened blocks again"
          className="h-6 rounded-md px-1.5 text-muted-foreground outline-none transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          reset count
        </button>
      )}
    </div>
  );
}
