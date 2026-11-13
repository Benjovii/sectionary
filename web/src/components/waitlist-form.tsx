"use client";

import { useActionState, useId } from "react";
import { ArrowRight, Check } from "lucide-react";
import { joinWaitlist, type WaitlistState } from "@/app/(marketing)/welcome/actions";
import { cn } from "@/lib/utils";

const initial: WaitlistState = { status: "idle" };

/**
 * Email plus one button, on one line from 420px up. Works without JavaScript
 * (a plain form post to the server action); with it, the result replaces the
 * form in place and is announced to screen readers.
 */
export function WaitlistForm({ source, tone = "default", className }: { source: string; tone?: "default" | "accent"; className?: string }) {
  // On the lemon band a lemon button would vanish: the button goes midnight
  // and the field goes white, in both themes. The error takes the band's own
  // text colour, because no red reads on yellow.
  const accent = tone === "accent";
  const [state, action, pending] = useActionState(joinWaitlist, initial);
  const id = useId();

  if (state.status === "joined") {
    return (
      <div
        role="status"
        className={cn("flex items-start gap-3 rounded-xl border px-4 py-3.5", accent ? "border-transparent bg-[#0b132b] text-[#eaf2ff]" : "bg-card", className)}
      >
        <span className={cn("mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full", accent ? "bg-brand text-brand-foreground" : "bg-primary text-primary-foreground")}>
          <Check className="size-3.5" strokeWidth={3} />
        </span>
        <p className="text-[14px] leading-snug text-pretty">
          <span className="font-medium">You&apos;re on the list.</span>{" "}
          <span className={accent ? "text-[#eaf2ff]/75" : "text-muted-foreground"}>
            We&apos;ll write to <span className={accent ? "text-[#eaf2ff]" : "text-foreground"}>{state.email}</span> once, when your invite is ready.
          </span>
        </p>
      </div>
    );
  }

  const error = state.status === "error" ? state.message : null;
  return (
    <form action={action} noValidate className={cn("w-full", className)}>
      <input type="hidden" name="source" value={source} />
      {/* Honeypot: hidden from people and from assistive tech. */}
      <div aria-hidden className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label>
          Company
          <input type="text" name="company" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      <div className="flex flex-col gap-2 min-[420px]:flex-row">
        <label htmlFor={`${id}-email`} className="sr-only">
          Work email
        </label>
        <input
          id={`${id}-email`}
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          placeholder="you@studio.com"
          defaultValue={state.status === "error" ? state.email : undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className={cn(
            "h-11 w-full min-w-0 rounded-lg min-[420px]:flex-1 border px-3.5 text-[15px] outline-none transition-colors",
            accent
              ? "border-[#0b132b]/20 bg-white text-[#0b132b] placeholder:text-[#0b132b]/50 focus-visible:border-[#0b132b] focus-visible:ring-2 focus-visible:ring-[#0b132b]/30 aria-invalid:border-[#0b132b]"
              : "border-input bg-background placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 aria-invalid:border-destructive dark:bg-input/30",
          )}
        />
        <button
          type="submit"
          disabled={pending}
          className={cn(
            "group inline-flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-lg px-4 text-[14px] font-semibold outline-none transition-[background-color,opacity] duration-150 focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-60",
            accent
              ? "bg-[#0b132b] text-[#eaf2ff] hover:bg-[#1d4e89] focus-visible:ring-[#0b132b] focus-visible:ring-offset-brand"
              : "bg-primary text-primary-foreground hover:bg-primary/85 focus-visible:ring-ring focus-visible:ring-offset-background",
          )}
        >
          {pending ? "Joining…" : "Join the waitlist"}
          {!pending && (
            <ArrowRight className="size-4 transition-transform duration-200 ease-out group-hover:translate-x-0.5" />
          )}
        </button>
      </div>
      <p id={`${id}-error`} aria-live="polite" className={cn("mt-2 text-[13px]", !error ? "sr-only" : accent ? "font-semibold text-brand-foreground" : "text-destructive")}>
        {error}
      </p>
    </form>
  );
}
