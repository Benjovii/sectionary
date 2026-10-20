"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type SelectOption = { value: string; label: string; count?: number };

/**
 * A dropdown in Sectionary's own chrome, replacing the native <select>, whose
 * open list is drawn by the OS (system blue highlight, system font). The
 * trigger is the same outline chip as the Blocks filters, and turns rust when
 * `active` (a filter is applied). The list is the filter panel's popover: card
 * surface, hairline border, muted hover, a rust check on the chosen option.
 *
 * Keyboard follows the WAI-ARIA select-only combobox pattern: Up/Down/Enter/
 * Space open it, arrows, Home/End and type-ahead move, Enter or Space picks,
 * Escape and Tab close. Opens upward when there is no room below.
 *
 * The list is portalled and fixed-positioned under the trigger, so a sticky
 * bar's stacking context or a scrolling side panel can't clip or cover it. It
 * goes into the nearest open <dialog> when there is one, because a modal
 * dialog sits in the top layer and would hide anything rendered in <body>.
 */
export function Select({
  value,
  onChange,
  options,
  label,
  active = false,
  className,
  triggerClassName,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  /** Accessible name, e.g. "Country". */
  label: string;
  /** Show the trigger in the selected (rust) state. */
  active?: boolean;
  className?: string;
  triggerClassName?: string;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<{
    host: Element;
    left: number;
    top?: number;
    bottom?: number;
    minWidth: number;
  } | null>(null);
  const selectedIndex = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );
  const [cursor, setCursor] = useState(selectedIndex);
  const typed = useRef({ text: "", at: 0 });
  const selected = options[selectedIndex];

  function measure() {
    const el = trigger.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    const below = window.innerHeight - box.bottom;
    const up = below < 260 && box.top > below;
    setPlace({
      host: el.closest("dialog") ?? document.body,
      left: Math.max(8, Math.min(box.left, window.innerWidth - 8 - Math.max(box.width, 160))),
      minWidth: box.width,
      ...(up ? { bottom: window.innerHeight - box.top + 6 } : { top: box.bottom + 6 }),
    });
  }
  function show(at = selectedIndex) {
    measure();
    setCursor(at);
    setOpen(true);
  }
  function hide(refocus = true) {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  }
  function pick(i: number) {
    const option = options[i];
    if (option && option.value !== value) onChange(option.value);
    hide();
  }

  // Focus the list when it opens, and keep the cursor row in view.
  useLayoutEffect(() => {
    if (open) list.current?.focus({ preventScroll: true });
  }, [open]);
  useEffect(() => {
    if (!open) return;
    list.current?.querySelector<HTMLElement>(`[data-index="${cursor}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, cursor]);

  // Close on a press anywhere else; follow the trigger when the page or a
  // panel scrolls, or the window resizes.
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!root.current?.contains(t) && !list.current?.contains(t)) hide(false);
    };
    const follow = (e: Event) => {
      if (e.target instanceof Node && list.current?.contains(e.target)) return;
      measure();
    };
    document.addEventListener("pointerdown", away);
    window.addEventListener("scroll", follow, true);
    window.addEventListener("resize", follow);
    return () => {
      document.removeEventListener("pointerdown", away);
      window.removeEventListener("scroll", follow, true);
      window.removeEventListener("resize", follow);
    };
  }, [open]);

  function typeAhead(key: string, now: number) {
    const t = typed.current;
    t.text = now - t.at > 600 ? key : t.text + key;
    t.at = now;
    const needle = t.text.toLowerCase();
    const order = [...options.keys()].map((k) => (cursor + 1 + k) % options.length);
    const hit = order.find((i) => options[i].label.toLowerCase().startsWith(needle));
    if (hit != null) setCursor(hit);
  }

  function onTriggerKey(e: React.KeyboardEvent) {
    if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
      e.preventDefault();
      show();
    }
  }
  function onListKey(e: React.KeyboardEvent) {
    const last = options.length - 1;
    if (e.key === "ArrowDown") setCursor((c) => Math.min(last, c + 1));
    else if (e.key === "ArrowUp") setCursor((c) => Math.max(0, c - 1));
    else if (e.key === "Home") setCursor(0);
    else if (e.key === "End") setCursor(last);
    else if (e.key === "Enter" || e.key === " ") pick(cursor);
    else if (e.key === "Escape") hide();
    else if (e.key === "Tab") return hide(false);
    else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) typeAhead(e.key, e.timeStamp);
    else return;
    e.preventDefault();
  }

  return (
    <div ref={root} className={cn("relative inline-flex min-w-0", className)}>
      <Button
        ref={trigger}
        variant="outline"
        size="sm"
        active={active}
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-list` : undefined}
        onClick={() => (open ? hide() : show())}
        onKeyDown={onTriggerKey}
        className={cn("w-full min-w-0 justify-between", triggerClassName)}
      >
        <span className="truncate">{selected?.label ?? label}</span>
        <ChevronDown className={cn("size-3 shrink-0 transition-transform duration-150", open && "rotate-180")} />
      </Button>
      {open &&
        place &&
        createPortal(
          <ul
            ref={list}
            id={`${id}-list`}
            role="listbox"
            aria-label={label}
            tabIndex={-1}
            aria-activedescendant={`${id}-${cursor}`}
            onKeyDown={onListKey}
            style={{
              left: place.left,
              top: place.top,
              bottom: place.bottom,
              minWidth: place.minWidth,
            }}
            className="fixed z-50 max-h-72 max-w-[calc(100vw-16px)] overflow-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-[0_12px_32px_-8px_rgb(0_0_0/0.35)] outline-none"
          >
            {options.map((option, i) => {
              const on = i === selectedIndex;
              return (
                <li
                  key={option.value}
                  id={`${id}-${i}`}
                  data-index={i}
                  role="option"
                  aria-selected={on}
                  onPointerMove={() => setCursor(i)}
                  onClick={() => pick(i)}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[13px] whitespace-nowrap select-none touch:min-h-11",
                    i === cursor && "bg-muted",
                    on && "font-medium",
                  )}
                >
                  <Check aria-hidden className={cn("size-3.5 shrink-0 text-primary", !on && "invisible")} />
                  <span className="truncate">{option.label}</span>
                  {option.count != null && <span className="ml-auto pl-4 font-mono text-[11px] text-muted-foreground tabular-nums">{option.count.toLocaleString("en-US")}</span>}
                </li>
              );
            })}
          </ul>,
          place.host,
        )}
    </div>
  );
}
