import type { Metadata } from "next";
import { CallbackSignIn } from "@/components/callback-sign-in";

export const metadata: Metadata = { title: "Sign in", robots: { index: false } };

/**
 * Where Supabase's default email link lands after Supabase has verified it:
 * /auth/callback#access_token=... (or #error=...). The fragment never reaches
 * the server, so the page reads it and hands the token over. Used until custom
 * SMTP lets us send our own template, whose link goes to /auth/confirm.
 */
export default function CallbackPage() {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4 py-6 sm:py-12">
      <h1 className="font-heading text-[22px] font-semibold">Sign in to Sectionary</h1>
      <CallbackSignIn />
    </div>
  );
}
