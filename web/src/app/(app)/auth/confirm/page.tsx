import type { Metadata } from "next";
import Link from "next/link";
import { ConfirmSignIn } from "@/components/confirm-sign-in";

export const metadata: Metadata = { title: "Sign in", robots: { index: false } };

/**
 * Where the email's link lands (SEC-27): /auth/confirm?token_hash=...&type=email.
 * The Supabase email templates in docs/AUTH-AND-BILLING.md point here.
 */
export default async function ConfirmPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const tokenHash = typeof params.token_hash === "string" ? params.token_hash : "";
  const type = typeof params.type === "string" ? params.type : "email";

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4 py-6 sm:py-12">
      <h1 className="font-heading text-[22px] font-semibold">Sign in to Sectionary</h1>
      {tokenHash ? (
        <ConfirmSignIn tokenHash={tokenHash} type={type} />
      ) : (
        <p className="text-[14px] text-muted-foreground">
          This link is missing its sign-in token. Copy the whole link from the email, or{" "}
          <Link href="/account" className="text-link underline-offset-4 hover:underline">ask for a new one</Link>.
        </p>
      )}
    </div>
  );
}
