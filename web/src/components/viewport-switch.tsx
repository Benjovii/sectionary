"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { LayoutGrid, Monitor, Smartphone } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Viewport } from "@/contracts/block";

/** A viewport, or both at once ("all", offered on the wall only). */
export type ViewportChoice = Viewport | "all";

const OPTIONS: { value: ViewportChoice; label: string; icon: typeof Monitor }[] = [
  { value: "all", label: "All", icon: LayoutGrid },
  { value: "desktop", label: "Web", icon: Monitor },
  { value: "mobile", label: "Mobile", icon: Smartphone },
];

/**
 * Web or Mobile, as one pill: the switch above the wall (with "All" in front),
 * and in the viewer when a block was captured at both viewports. A radio
 * group, so arrow keys move along it and a screen reader hears which is on.
 * The highlight slides from one choice to the next rather than jumping.
 */
export function ViewportSwitch<T extends ViewportChoice>({
  value,
  onChange,
  withAll,
  disabled,
  size = "default",
  className,
}: {
  value: T;
  onChange: (viewport: T) => void;
  /** Offer "All" as well as Web and Mobile. */
  withAll?: boolean;
  /** Choices that cannot be picked: shown, so the absence is information. */
  disabled?: T[];
  size?: "default" | "sm";
  className?: string;
}) {
  const small = size === "sm";
  const options = (withAll ? OPTIONS : OPTIONS.filter((o) => o.value !== "all")) as { value: T; label: string; icon: typeof Monitor }[];
  const enabled = options.filter((o) => !disabled?.includes(o.value));
  const { group, thumb } = useSlidingThumb(value);
  return (
    <div
      ref={group}
      role="radiogroup"
      aria-label="Viewport"
      className={cn("relative isolate inline-flex shrink-0 rounded-full border bg-muted/60 p-1", className)}
      onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        // Arrows switch here and stop: the viewer listens for them to step blocks.
        event.preventDefault();
        event.stopPropagation();
        const at = enabled.findIndex((o) => o.value === value);
        const step = event.key === "ArrowRight" ? 1 : -1;
        const next = enabled[(at + step + enabled.length) % enabled.length];
        if (next && next.value !== value) {
          onChange(next.value);
          (event.currentTarget.querySelector(`[data-value="${next.value}"]`) as HTMLElement | null)?.focus();
        }
      }}
    >
      {thumb}
      {options.map(({ value: option, label, icon: Icon }) => {
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
              "inline-flex items-center gap-1.5 rounded-full font-medium transition-colors duration-200 outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40",
              small ? "h-7 px-3 text-[12px] touch:h-11" : "h-8 px-4 text-[13px] touch:h-11",
              on ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground",
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

/**
 * The highlight behind a pill's chosen option, sliding to whichever is chosen.
 * Put `group` on the radiogroup and `thumb` first inside it; each option needs
 * `data-value`. Placed without a transition the first time, so it does not
 * slide in from the edge when the page loads, and re-measured on resize (a
 * label that appears at a breakpoint changes the widths).
 */
export function useSlidingThumb(value: string) {
  const group = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ x: number; w: number; h: number; y: number; moved: boolean } | null>(null);

  useLayoutEffect(() => {
    const el = group.current;
    if (!el) return;
    const place = (moved: boolean) => {
      const on = el.querySelector<HTMLElement>(`[data-value="${CSS.escape(value)}"]`);
      if (!on) return;
      setBox((old) => ({ x: on.offsetLeft, y: on.offsetTop, w: on.offsetWidth, h: on.offsetHeight, moved: moved && old !== null }));
    };
    place(true);
    // An observer reports once as soon as it starts; only later reports are resizes.
    let started = false;
    const observer = new ResizeObserver(() => {
      if (started) place(false);
      started = true;
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [value]);

  const thumb = (
    <span
      aria-hidden
      className={cn(
        "pointer-events-none absolute top-0 left-0 -z-10 rounded-full bg-primary shadow-sm motion-reduce:transition-none",
        box?.moved && "transition-[transform,width] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]",
        !box && "opacity-0",
      )}
      style={box ? { width: box.w, height: box.h, transform: `translate(${box.x}px, ${box.y}px)` } : undefined}
    />
  );
  return { group, thumb };
}
