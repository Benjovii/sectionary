"use client";

import { useActionState, useId, useState } from "react";
import Link from "next/link";
import { submitTwoStepCode, type ConfirmState } from "@/app/(app)/account/actions";
import { Button } from "@/components/ui/button";
import { field } from "@/components/sign-in-form";
import { cn } from "@/lib/utils";

const idle: ConfirmState = { status: "idle" };

/** The authenticator code after the email link; a recovery code when the phone is not at hand. */
export function TwoStepSignIn() {
  const [state, submit, pending] = useActionState(submitTwoStepCode, idle);
  const [recovery, setRecovery] = useState(false);
  const id = useId();
  const error = state.status === "error" ? state.message : null;

  return (
    <form action={submit} className="flex flex-col gap-2" noValidate>
      <label htmlFor={`${id}-code`} className="text-[13px] text-muted-foreground">
        {recovery ? "Recovery code" : "6-digit code"}
      </label>
      <div className="flex flex-col gap-2 min-[420px]:flex-row">
        <input
          key={recovery ? "recovery" : "app"}
          id={`${id}-code`}
          name="code"
          autoFocus
          inputMode={recovery ? "text" : "numeric"}
          autoComplete="one-time-code"
          autoCapitalize="off"
          spellCheck={false}
          maxLength={recovery ? 20 : 6}
          placeholder={recovery ? "xxxx-xxxx-xxxx" : "123456"}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className={cn(field, "font-mono tracking-[0.2em] min-[420px]:flex-1")}
        />
        <Button type="submit" size="lg" disabled={pending} className="h-11 text-[14px] font-semibold">
          {pending ? "Checking…" : "Sign in"}
        </Button>
      </div>
      <p id={`${id}-error`} aria-live="polite" className={cn("text-[13px] text-destructive", !error && "sr-only")}>
        {error}
        {error && /start again/i.test(error) && (
          <>
            {" "}
            <Link href="/account" className="text-link underline-offset-4 hover:underline">Send a new link</Link>
          </>
        )}
      </p>
      <button
        type="button"
        onClick={() => setRecovery((r) => !r)}
        className="self-start rounded text-[13px] text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring"
      >
        {recovery ? "Use the code from the app instead" : "Use a recovery code instead"}
      </button>
    </form>
  );
}
