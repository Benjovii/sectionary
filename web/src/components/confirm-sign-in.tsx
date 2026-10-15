"use client";

import { useActionState } from "react";
import Link from "next/link";
import { confirmSignIn, type ConfirmState } from "@/app/(app)/account/actions";
import { Button } from "@/components/ui/button";

const idle: ConfirmState = { status: "idle" };

/** One button between the email link and the session; see confirmSignIn for why. */
export function ConfirmSignIn({ tokenHash, type }: { tokenHash: string; type: string }) {
  const [state, confirm, pending] = useActionState(confirmSignIn, idle);
  return (
    <form action={confirm} className="flex flex-col gap-3">
      <input type="hidden" name="token_hash" value={tokenHash} />
      <input type="hidden" name="type" value={type} />
      <p className="text-[14px] text-muted-foreground">Tap the button to finish signing in on this device.</p>
      <Button type="submit" size="lg" disabled={pending} className="h-11 text-[14px] font-semibold">
        {pending ? "Signing in…" : "Continue"}
      </Button>
      {state.status === "error" && (
        <p aria-live="polite" className="text-[13px] text-destructive">
          {state.message}{" "}
          <Link href="/account" className="text-link underline-offset-4 hover:underline">Send a new link</Link>
        </p>
      )}
    </form>
  );
}
