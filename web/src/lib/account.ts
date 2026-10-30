"use client";

import { useEffect, useState } from "react";
import type { AccountResponse, Feature, Plan } from "@/contracts/api";
import { API_MODE } from "@/lib/data-source";

let cached: Promise<AccountResponse> | null = null;

function load(): Promise<AccountResponse> {
  cached ??= fetch("/api/account", { cache: "no-store" }).then((r) => (r.ok ? r.json() : { account: null })).catch(() => ({ account: null }));
  return cached;
}

function useAccountResponse(): AccountResponse | undefined {
  const [res, setRes] = useState<AccountResponse | undefined>(API_MODE ? undefined : { account: null, gates: false });
  useEffect(() => {
    if (!API_MODE) return;
    let alive = true;
    load().then((r) => alive && setRes(r));
    return () => {
      alive = false;
    };
  }, []);
  return res;
}

/** The signed-in account (or null), fetched once per page load. Undefined while loading; null in sample mode. */
export function useAccount(): AccountResponse["account"] | undefined {
  const res = useAccountResponse();
  return res === undefined ? undefined : (res.account ?? null);
}

export type Access = {
  /** False until /api/account answers. Until then everything reads as allowed, so Pro never sees a lock flash. */
  ready: boolean;
  signedIn: boolean;
  /** PLAN_GATES is on: locks apply. */
  gates: boolean;
  can: (feature: Feature) => boolean;
  /** Set while the seven-day Pro trial runs (and after, for "trial ended"). */
  trialEndsAt: string | null;
  onTrial: boolean;
  plan: Plan;
  /** Blocks this account may open in full today (Free after the trial); null without a cap or signed out. */
  dailyViews: number | null;
};

/** What this viewer may use (plan, trial, signed out), from the same one request as useAccount. */
export function useAccess(): Access {
  const res = useAccountResponse();
  const account = res?.account ?? null;
  const gates = Boolean(res?.gates);
  const features = new Set(res?.features ?? []);
  const onTrial = Boolean(account && account.plan === "free" && account.access === "pro");
  return {
    ready: res !== undefined,
    signedIn: Boolean(account),
    gates,
    can: (feature) => res === undefined || !gates || features.has(feature),
    trialEndsAt: account?.trialEndsAt ?? null,
    onTrial,
    plan: account?.plan ?? "free",
    dailyViews: res?.views?.limit ?? null,
  };
}

/**
 * Signed out, or Free once the trial ends (gates on): the wall, Sites and Flows
 * show blurred previews. A block opened in the detail view is shown in full,
 * and that is what the daily cap counts.
 */
export const usePreviewOnly = () => !useAccess().can("full-images");

/** The blur a preview gets, on the image itself (its frame clips the scale). */
export const PREVIEW_BLUR = "scale-105 blur-[6px]";

/** Board and view errors that mean "sign in" or "upgrade", from the API's error code. */
export type Gate = "SIGN_IN_REQUIRED" | "PLAN_REQUIRED";
export const gateOf = (error: unknown): Gate | null => {
  const code = (error as { code?: string } | null)?.code;
  return code === "SIGN_IN_REQUIRED" || code === "PLAN_REQUIRED" ? code : null;
};
