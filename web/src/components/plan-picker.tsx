"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import type { AccountResponse, Plan } from "@/contracts/api";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Interval = "month" | "year";
export type PlanPrices = Record<"pro" | "team", Partial<Record<Interval, string>>>;

// The prices people see before checkout. Paddle's checkout shows the final
// amount with tax for their country; keep these in line with the Paddle prices.
const COPY = {
  free: { name: "Free", price: { month: "$0", year: "$0" }, per: "", points: ["Browse and filter the whole library", "A daily limit on opened blocks", "No boards"] },
  pro: { name: "Pro", price: { month: "$12", year: "$96" }, per: "", points: ["Open as many blocks as you like", "Boards with client share links", "Copy as brief"] },
  team: { name: "Team", price: { month: "$20", year: "$192" }, per: " per seat", points: ["Everything in Pro", "One bill for the studio", "Pick the number of seats"] },
} as const;

type PaddleGlobal = {
  Environment: { set(env: string): void };
  Initialize(options: { token: string; eventCallback?: (e: { name?: string }) => void }): void;
  Checkout: { open(options: Record<string, unknown>): void };
};
declare global { interface Window { Paddle?: PaddleGlobal } }

let loading: Promise<PaddleGlobal> | null = null;
function loadPaddle(token: string, env: string, onEvent: (name: string) => void): Promise<PaddleGlobal> {
  return (loading ??= new Promise<PaddleGlobal>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.paddle.com/paddle/v2/paddle.js";
    script.async = true;
    script.onload = () => {
      const paddle = window.Paddle;
      if (!paddle) return reject(new Error("Paddle did not load"));
      if (env !== "production") paddle.Environment.set("sandbox");
      paddle.Initialize({ token, eventCallback: (e) => e.name && onEvent(e.name) });
      resolve(paddle);
    };
    script.onerror = () => {
      loading = null;
      reject(new Error("Checkout could not load. Check your connection or turn off a blocker for this page."));
    };
    document.head.appendChild(script);
  }));
}

/**
 * Free, Pro and Team (SEC-28). Checkout is Paddle's overlay; the plan changes
 * when Paddle's webhook arrives, usually within seconds, so after a completed
 * checkout this waits for /api/account to show the new plan, then refreshes.
 */
export function PlanPicker({ plan, userId, email, prices, clientToken, paddleEnv }: {
  plan: Plan; userId: string; email: string; prices: PlanPrices; clientToken: string | null; paddleEnv: string;
}) {
  const router = useRouter();
  const hasYear = Boolean(prices.pro.year || prices.team.year);
  const [interval, setInterval] = useState<Interval>("month");
  const [seats, setSeats] = useState(3);
  const [error, setError] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false);
  const polling = useRef(false);

  const waitForPlan = async () => {
    if (polling.current) return;
    polling.current = true;
    setWaiting(true);
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const res = await fetch("/api/account", { cache: "no-store" }).catch(() => null);
      const body = (await res?.json().catch(() => null)) as AccountResponse | null;
      if (body?.account && body.account.plan !== plan) break;
    }
    polling.current = false;
    setWaiting(false);
    router.refresh();
  };

  // A return from Paddle's success URL in a new page load waits the same way.
  useEffect(() => {
    if (new URLSearchParams(location.search).get("checkout") === "done" && plan === "free") void waitForPlan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const buy = async (target: "pro" | "team") => {
    const priceId = prices[target][interval] ?? prices[target].month;
    if (!clientToken || !priceId) return setError("Checkout is not set up yet.");
    setError(null);
    try {
      const paddle = await loadPaddle(clientToken, paddleEnv, (name) => name === "checkout.completed" && void waitForPlan());
      paddle.Checkout.open({
        items: [{ priceId, quantity: target === "team" ? seats : 1 }],
        customer: { email },
        customData: { userId },
        settings: { displayMode: "overlay", successUrl: `${location.origin}/account?checkout=done`, allowLogout: false },
      });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <section aria-labelledby="plans" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="plans" className="font-heading text-[15px] font-semibold">Plans</h2>
        {hasYear && (
          <div role="group" aria-label="Billing period" className="flex gap-0.5 rounded-lg border p-0.5">
            {(["month", "year"] as const).map((i) => (
              <Button key={i} size="sm" variant="ghost" active={interval === i} aria-pressed={interval === i} onClick={() => setInterval(i)}>
                {i === "month" ? "Monthly" : "Yearly"}
              </Button>
            ))}
          </div>
        )}
      </div>
      {waiting && (
        <p role="status" className="rounded-lg border bg-card px-3 py-2 text-[13px]">
          Payment received. Your plan updates in a few seconds…
        </p>
      )}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {(["free", "pro", "team"] as const).map((p) => {
          const c = COPY[p];
          const current = plan === p;
          return (
            <div key={p} className={cn("flex flex-col gap-3 rounded-xl border bg-card p-4", current && "border-foreground/40")}>
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="font-heading text-[15px] font-semibold">{c.name}</h3>
                {current && <span className="font-mono text-[11px] text-muted-foreground">Your plan</span>}
              </div>
              <p className="text-[13px] text-muted-foreground">
                <span className="font-heading text-[22px] font-semibold text-foreground tabular-nums">{c.price[interval]}</span>
                {p !== "free" && ` a ${interval}${c.per}`}
              </p>
              <ul className="flex flex-col gap-1.5 text-[13px]">
                {c.points.map((pt) => (
                  <li key={pt} className="flex gap-2">
                    <Check className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                    {pt}
                  </li>
                ))}
              </ul>
              {p === "team" && !current && plan === "free" && (
                <label className="flex items-center gap-2 text-[13px] text-muted-foreground">
                  Seats
                  <input
                    type="number"
                    min={2}
                    max={50}
                    value={seats}
                    onChange={(e) => setSeats(Math.min(50, Math.max(2, Number(e.target.value) || 2)))}
                    className="h-8 w-16 rounded-lg border bg-background px-2 text-[13px] tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring/40 dark:bg-input/30"
                  />
                </label>
              )}
              <div className="mt-auto">
                {p !== "free" && plan === "free" && (
                  <Button className="w-full" disabled={waiting || !prices[p].month} onClick={() => buy(p)}>
                    {prices[p].month ? `Upgrade to ${c.name}` : "Coming soon"}
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {plan !== "free" && <p className="text-[12px] text-muted-foreground">To switch between Pro and Team, or change seats, use Manage billing.</p>}
      {error && <p className="text-[13px] text-destructive">{error}</p>}
    </section>
  );
}
