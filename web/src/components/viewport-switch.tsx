"use client";

import { Monitor, Smartphone } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Viewport } from "@/contracts/block";

const OPTIONS: { value: Viewport; label: string; icon: typeof Monitor }[] = [
  { value: "desktop", label: "Web", icon: Monitor },
  { value: "mobile", label: "Mobile", icon: Smartphone },
];

/**
 * Web or Mobile, as one pill: the switch above the wall, and in the viewer
 * when a block was captured at both viewports. A radio group, so arrow keys
 * move between the two and a screen reader hears which one is on.
 */
export function ViewportSwitch({
  value,
  onChange,
  disabled,
  size = "default",
  className,
}: {
  value: Viewport;
  onChange: (viewport: Viewport) => void;
  /** Viewports that cannot be picked: shown, so the absence is information. */
  disabled?: Viewport[];
  size?: "default" | "sm";
  className?: string;
}) {
  const small = size === "sm";
  return (
    <div
      role="radiogroup"
      aria-label="Viewport"
      className={cn("inline-flex shrink-0 rounded-full border bg-muted/60 p-1", className)}
      onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        // Arrows switch here and stop: the viewer listens for them to step blocks.
        event.preventDefault();
        event.stopPropagation();
        const next = OPTIONS.find((o) => o.value !== value && !disabled?.includes(o.value));
        if (next) {
          onChange(next.value);
          (event.currentTarget.querySelector(`[data-value="${next.value}"]`) as HTMLElement | null)?.focus();
        }
      }}
    >
      {OPTIONS.map(({ value: option, label, icon: Icon }) => {
        const on = option === value;
        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={on}
            data-value={option}
            tabIndex={on ? 0 : -1}
            disabled={disabled?.includes(option)}
            onClick={() => onChange(option)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full font-medium transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40",
              small ? "h-7 px-3 text-[12px] touch:h-11" : "h-8 px-4 text-[13px] touch:h-11",
              on ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className={small ? "size-3.5" : "size-4"} aria-hidden />
            {label}
          </button>
        );
      })}
    </div>
  );
}
