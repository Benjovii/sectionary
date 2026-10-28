"use client";

import { useActionState, useEffect, useRef, useSyncExternalStore } from "react";
import Link from "next/link";
import { signInWithAccessToken, type ConfirmState } from "@/app/(app)/account/actions";
import { Button } from "@/components/ui/button";

const idle: ConfirmState = { status: "idle" };

type Landing = { token: string } | { error: string } | null;

/** Reads the fragment Supabase redirected with, once, and takes it out of the address bar. */
let landing: Landing | undefined;
function readLanding(): Landing {
  if (landing !== undefined) return landing;
  const params = new URLSearchParams(window.location.hash.slice(1) || window.location.search.slice(1));
  const token = params.get("access_token");
  const error = params.get("error_code") ?? params.get("error");
  landing = token ? { token } : error ? { error } : null;
  // The token should not sit in the address bar, the history or a copied link.
  if (window.location.hash || window.location.search) window.history.replaceState(null, "", window.location.pathname);
  return landing;
}
const subscribe = () => () => {};

/** Signs in with the token from Supabase's default email link; on its own, no click needed. */
export function CallbackSignIn() {
  const found = useSyncExternalStore(subscribe, readLanding, () => undefined);
  const [state, submit, pending] = useActionState(signInWithAccessToken, idle);
  const form = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (found && "token" in found) form.current?.requestSubmit();
  }, [found]);

  if (found === undefined) return <p className="text-[14px] text-muted-foreground">Signing you in…</p>;

  if (!found || "error" in found) {
    const expired = found && /expired|denied/i.test(found.error);
    return (
      <p className="text-[14px] text-muted-foreground">
        {expired ? "That link has expired or was already used." : "This link is missing its sign-in token."}{" "}
        <Link href="/account" className="text-link underline-offset-4 hover:underline">Send a new link</Link>.
      </p>
    );
  }

  return (
    <form ref={form} action={submit} className="flex flex-col gap-3">
      <input type="hidden" name="access_token" value={found.token} />
      <p className="text-[14px] text-muted-foreground">{pending ? "Signing you in…" : "Finishing sign-in on this device."}</p>
      {state.status === "error" && (
        <>
          <p aria-live="polite" className="text-[13px] text-destructive">
            {state.message}{" "}
            <Link href="/account" className="text-link underline-offset-4 hover:underline">Send a new link</Link>
          </p>
          <Button type="submit" size="lg" variant="outline" disabled={pending} className="h-11 text-[14px] font-semibold">
            Try again
          </Button>
        </>
      )}
    </form>
  );
}
