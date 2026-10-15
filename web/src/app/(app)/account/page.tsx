import type { Metadata } from "next";
import { currentUser, safeNext } from "@/server/auth";
import { authConfigured } from "@/server/supabase-auth";
import { priceIds, viewLimit } from "@/server/plans";
import { viewsToday } from "@/server/views";
import { openBillingPortal, signOutAction } from "./actions";
import { SignInForm } from "@/components/sign-in-form";
import { PlanPicker } from "@/components/plan-picker";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Account" };
export const dynamic = "force-dynamic";

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : null);
const PLAN_NAME = { free: "Free", pro: "Pro", team: "Team" } as const;

const BILLING_NOTE: Record<string, string> = {
  none: "There is no billing account yet. Upgrade first and it appears here.",
  error: "Paddle did not answer just now. Try Manage billing again in a minute.",
};

/** SEC-27 sign-in and the account; SEC-28 plan and billing. */
export default async function AccountPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const user = await currentUser();

  if (!user) {
    const next = safeNext(params.next, "/account");
    return (
      <div className="mx-auto flex w-full max-w-md flex-col gap-4 py-6 sm:py-12">
        <div>
          <h1 className="font-heading text-[22px] font-semibold">Sign in</h1>
          <p className="mt-1 text-[14px] text-muted-foreground text-pretty">No password. We email you a link and a code; either one signs you in.</p>
        </div>
        {authConfigured() ? (
          <SignInForm next={next} />
        ) : (
          <p className="rounded-lg border border-dashed p-4 text-[13px] text-muted-foreground">Sign-in is not switched on for this deployment yet.</p>
        )}
      </div>
    );
  }

  const limit = viewLimit(user.plan);
  const used = limit === null ? 0 : await viewsToday(`u:${user.id}`);
  const billingNote = typeof params.billing === "string" ? BILLING_NOTE[params.billing] : undefined;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 py-2 sm:py-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-heading text-[22px] font-semibold">Account</h1>
          <p className="mt-1 truncate text-[14px] text-muted-foreground">{user.email}</p>
        </div>
        <form action={signOutAction}>
          <Button type="submit" variant="outline">Sign out</Button>
        </form>
      </div>

      <section aria-label="Your plan" className="flex flex-col gap-3 rounded-xl border bg-card p-4">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <p className="font-heading text-[15px] font-semibold">{PLAN_NAME[user.plan]}{user.plan === "team" && ` · ${user.seats} seats`}</p>
          {user.planStatus === "past_due" && <p className="text-[13px] text-destructive">The last payment failed. Update your card in Manage billing.</p>}
          {user.cancelAt && user.plan !== "free" && <p className="text-[13px] text-muted-foreground">Ends {day(user.cancelAt)}, then Free.</p>}
          {!user.cancelAt && user.renewsAt && user.plan !== "free" && <p className="text-[13px] text-muted-foreground">Renews {day(user.renewsAt)}.</p>}
        </div>
        {limit !== null && (
          <p className="text-[13px] text-muted-foreground">
            <span className="font-mono tabular-nums text-foreground">{used} of {limit}</span> blocks opened today. The count starts again at midnight UTC.
          </p>
        )}
        {user.paddleCustomerId && (
          <div className="flex flex-wrap gap-2">
            <form action={openBillingPortal}>
              <input type="hidden" name="target" value="overview" />
              <Button type="submit" variant="outline">Manage billing</Button>
            </form>
            {user.plan !== "free" && !user.cancelAt && (
              <form action={openBillingPortal}>
                <input type="hidden" name="target" value="cancel" />
                <Button type="submit" variant="ghost">Cancel plan</Button>
              </form>
            )}
          </div>
        )}
        {billingNote && <p className="text-[13px] text-muted-foreground">{billingNote}</p>}
      </section>

      <PlanPicker
        plan={user.plan}
        userId={user.id}
        email={user.email}
        prices={priceIds()}
        clientToken={process.env.PADDLE_CLIENT_TOKEN ?? null}
        paddleEnv={process.env.PADDLE_ENV ?? "sandbox"}
      />
    </div>
  );
}
