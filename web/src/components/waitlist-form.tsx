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
  // On the orange band the orange button would vanish: the button goes dark
  // and the field goes light, in both themes.
  const accent = tone === "accent";
  const [state, action, pending] = useActionState(joinWaitlist, initial);
  const id = useId();

  if (state.status === "joined") {
    return (
      <div
        role="status"
        className={cn("flex items-start gap-3 rounded-xl border px-4 py-3.5", accent ? "border-transparent bg-[#110f0e] text-white" : "bg-card", className)}
      >
        <span className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Check className="size-3.5" strokeWidth={3} />
        </span>
        <p className="text-[14px] leading-snug text-pretty">
          <span className="font-medium">You&apos;re on the list.</span>{" "}
          <span className={accent ? "text-white/70" : "text-muted-foreground"}>
            We&apos;ll write to <span className={accent ? "text-white" : "text-foreground"}>{state.email}</span> once, when your invite is ready.
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
              ? "border-[#110f0e]/15 bg-[#fffaf3] text-[#1d1a17] placeholder:text-[#1d1a17]/50 focus-visible:border-[#110f0e] focus-visible:ring-2 focus-visible:ring-[#110f0e]/30 aria-invalid:border-[#7a1d0c]"
              : "border-input bg-background placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 aria-invalid:border-destructive dark:bg-input/30",
          )}
        />
        <button
          type="submit"
          disabled={pending}
          className={cn(
            "group inline-flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-lg px-4 text-[14px] font-semibold outline-none transition-[background-color,opacity] duration-150 focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-60",
            accent
              ? "bg-[#110f0e] text-white hover:bg-[#2a2622] focus-visible:ring-[#110f0e] focus-visible:ring-offset-primary"
              : "bg-primary text-primary-foreground hover:bg-primary/85 focus-visible:ring-ring focus-visible:ring-offset-background",
          )}
        >
          {pending ? "Joining…" : "Join the waitlist"}
          {!pending && (
            <ArrowRight className="size-4 transition-transform duration-200 ease-out group-hover:translate-x-0.5" />
          )}
        </button>
      </div>
      <p id={`${id}-error`} aria-live="polite" className={cn("mt-2 text-[13px]", !error ? "sr-only" : accent ? "font-medium text-[#5c1608]" : "text-destructive")}>
        {error}
      </p>
    </form>
  );
}
