"use client";

import { useEffect, useState } from "react";
import type { AccountResponse } from "@/contracts/api";
import { API_MODE } from "@/lib/data-source";

let cached: Promise<AccountResponse> | null = null;

/** The signed-in account (or null), fetched once per page load. Undefined while loading; null in sample mode. */
export function useAccount(): AccountResponse["account"] | undefined {
  const [account, setAccount] = useState<AccountResponse["account"] | undefined>(API_MODE ? undefined : null);
  useEffect(() => {
    if (!API_MODE) return;
    let alive = true;
    cached ??= fetch("/api/account", { cache: "no-store" }).then((r) => (r.ok ? r.json() : { account: null })).catch(() => ({ account: null }));
    cached.then((r) => alive && setAccount(r.account ?? null));
    return () => {
      alive = false;
    };
  }, []);
  return account;
}

/** Board and view errors that mean "sign in" or "upgrade", from the API's error code. */
export type Gate = "SIGN_IN_REQUIRED" | "PLAN_REQUIRED";
export const gateOf = (error: unknown): Gate | null => {
  const code = (error as { code?: string } | null)?.code;
  return code === "SIGN_IN_REQUIRED" || code === "PLAN_REQUIRED" ? code : null;
};
