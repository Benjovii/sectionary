import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { PENDING_COOKIE } from "@/server/auth";
import { pendingSignIn } from "@/server/two-step";
import { TwoStepSignIn } from "@/components/two-step-sign-in";

export const metadata: Metadata = { title: "Sign in", robots: { index: false } };
export const dynamic = "force-dynamic";

/** The second step for accounts with two-step on: after the email link, the authenticator code. */
export default async function TwoStepPage() {
  const pending = await pendingSignIn((await cookies()).get(PENDING_COOKIE)?.value);
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4 py-6 sm:py-12">
      <div>
        <h1 className="font-heading text-[22px] font-semibold">Two-step sign-in</h1>
        <p className="mt-1 text-[14px] text-muted-foreground text-pretty">
          {pending ? (
            <>Open your authenticator app and type the code for Sectionary{pending.email && <> ({pending.email})</>}.</>
          ) : (
            "This sign-in timed out or was already finished."
          )}
        </p>
      </div>
      {pending ? (
        <TwoStepSignIn />
      ) : (
        <p className="text-[14px] text-muted-foreground">
          <Link href="/account" className="text-link underline-offset-4 hover:underline">Start again with a new email link</Link>.
        </p>
      )}
    </div>
  );
}
