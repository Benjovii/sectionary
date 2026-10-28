"use client";

import { useActionState, useId, useState } from "react";
import { ArrowRight, Mail } from "lucide-react";
import { requestSignIn, signInWithCode, type SignInState } from "@/app/(app)/account/actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const idle: SignInState = { status: "idle" };
export const field =
  "h-11 w-full min-w-0 rounded-lg border border-input bg-background px-3.5 text-[15px] outline-none transition-colors placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 aria-invalid:border-destructive dark:bg-input/30";

/**
 * Magic-link sign-in (SEC-27). Step one asks for the address; step two says
 * where the link went and offers the six-digit code from the same email, for
 * someone reading mail on their phone and signing in on a laptop.
 */
export function SignInForm({ next }: { next: string }) {
  // "Use a different email" starts over with fresh form state.
  const [round, setRound] = useState(0);
  return <Steps key={round} next={next} restart={() => setRound((n) => n + 1)} />;
}

function Steps({ next, restart }: { next: string; restart: () => void }) {
  const [sent, send, sending] = useActionState(requestSignIn, idle);
  const [checked, check, checking] = useActionState(signInWithCode, idle);
  const id = useId();

  const sentTo = sent.status === "sent" ? sent.email : null;

  if (sentTo) {
    const error = checked.status === "error" ? checked.message : null;
    return (
      <div className="flex flex-col gap-4">
        <div role="status" className="flex items-start gap-3 rounded-xl border bg-card px-4 py-3.5">
          <Mail className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
          <p className="text-[14px] leading-snug text-pretty">
            <span className="font-medium">Check your email.</span>{" "}
            <span className="text-muted-foreground">
              We sent a sign-in link to <span className="text-foreground">{sentTo}</span>. Open it on any device. It works for an hour.
            </span>
          </p>
        </div>
        <form action={check} className="flex flex-col gap-2" noValidate>
          <input type="hidden" name="email" value={sentTo} />
          <label htmlFor={`${id}-code`} className="text-[13px] text-muted-foreground">
            Or, if the email has a code, type it here
          </label>
          <div className="flex flex-col gap-2 min-[420px]:flex-row">
            <input
              id={`${id}-code`}
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={10}
              placeholder="123456"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${id}-code-error` : undefined}
              className={cn(field, "font-mono tracking-[0.2em] min-[420px]:flex-1")}
            />
            <Button type="submit" size="lg" disabled={checking} className="h-11">
              {checking ? "Checking…" : "Sign in"}
            </Button>
          </div>
          <p id={`${id}-code-error`} aria-live="polite" className={cn("text-[13px] text-destructive", !error && "sr-only")}>
            {error}
          </p>
        </form>
        <button type="button" onClick={restart} className="self-start text-[13px] text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring rounded">
          Use a different email
        </button>
      </div>
    );
  }

  const error = sent.status === "error" ? sent.message : null;
  return (
    <form action={send} noValidate className="flex flex-col gap-2">
      <input type="hidden" name="next" value={next} />
      <label htmlFor={`${id}-email`} className="text-[13px] text-muted-foreground">
        Email
      </label>
      <div className="flex flex-col gap-2 min-[420px]:flex-row">
        <input
          id={`${id}-email`}
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          placeholder="you@studio.com"
          defaultValue={sent.status === "error" ? sent.email : undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className={cn(field, "min-[420px]:flex-1")}
        />
        <Button type="submit" size="lg" disabled={sending} className="group h-11 px-4 text-[14px] font-semibold">
          {sending ? "Sending…" : "Email me a link"}
          {!sending && <ArrowRight className="transition-transform duration-150 group-hover:translate-x-0.5" />}
        </Button>
      </div>
      <p id={`${id}-error`} aria-live="polite" className={cn("text-[13px] text-destructive", !error && "sr-only")}>
        {error}
      </p>
    </form>
  );
}
