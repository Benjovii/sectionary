"use server";

import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { currentUser, EMAIL_COOKIE, finishTwoStep, rememberSignIn, safeNext, signOut, signOutEverywhere, startSession, takeNext } from "@/server/auth";
import { AuthError, sendMagicLink, userFromAccessToken, verifyCode, verifyTokenHash } from "@/server/supabase-auth";
import { portalUrl } from "@/server/paddle";
import { beginSetup, confirmSetup, disable, regenerateRecoveryCodes, TwoStepCodeError } from "@/server/two-step";
import { TwoStepError } from "@/server/totp";
import { revalidatePath } from "next/cache";

// SEC-27 sign-in and SEC-28 billing actions. Thin: the work is in src/server.

export type SignInState =
  | { status: "idle" }
  | { status: "sent"; email: string }
  | { status: "error"; message: string; email: string; step: "email" | "code" };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const message = (error: unknown) => {
  if (error instanceof AuthError || error instanceof TwoStepCodeError || error instanceof TwoStepError) return error.message;
  console.error("[auth]", error);
  return "Something went wrong on our side. Try again in a minute.";
};

/** This site's /auth/callback, where Supabase's default email link comes back to. */
async function callbackUrl(): Promise<string | undefined> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host) return undefined;
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}/auth/callback`;
}

/** Step 1: email the link and the code. */
export async function requestSignIn(_prev: SignInState, form: FormData): Promise<SignInState> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  if (!email || email.length > 254 || !EMAIL.test(email)) {
    return { status: "error", message: "That doesn't look like an email address. Check for a typo.", email, step: "email" };
  }
  try {
    await sendMagicLink(email, await callbackUrl());
    await rememberSignIn(email, safeNext(form.get("next")));
    return { status: "sent", email };
  } catch (error) {
    return { status: "error", message: message(error), email, step: "email" };
  }
}

/** Step 2, on the same device: the six-digit code from the email instead of the link. */
export async function signInWithCode(_prev: SignInState, form: FormData): Promise<SignInState> {
  const email = String(form.get("email") ?? (await cookies()).get(EMAIL_COOKIE)?.value ?? "").trim().toLowerCase();
  let next: string;
  try {
    const verified = await verifyCode(email, String(form.get("code") ?? ""));
    next = await takeNext();
    if ((await startSession(verified, next)).twoStep) next = "/auth/two-step";
  } catch (error) {
    return { status: "error", message: message(error), email, step: "code" };
  }
  redirect(next);
}

export type ConfirmState = { status: "idle" } | { status: "error"; message: string };

/**
 * The link from the email, on any device. A button press rather than on page
 * load, so a mail scanner that opens links to check them does not use up the
 * one-time token before the person gets there.
 */
export async function confirmSignIn(_prev: ConfirmState, form: FormData): Promise<ConfirmState> {
  let next: string;
  try {
    const verified = await verifyTokenHash(String(form.get("token_hash") ?? ""), String(form.get("type") ?? "email"));
    next = await takeNext();
    if ((await startSession(verified, next)).twoStep) next = "/auth/two-step";
  } catch (error) {
    return { status: "error", message: message(error) };
  }
  redirect(next);
}

/**
 * Supabase's default email link, after Supabase verified it: the page hands
 * over the access token from the URL fragment, Supabase says whose it is.
 */
export async function signInWithAccessToken(_prev: ConfirmState, form: FormData): Promise<ConfirmState> {
  let next: string;
  try {
    const verified = await userFromAccessToken(String(form.get("access_token") ?? ""));
    next = await takeNext();
    if ((await startSession(verified, next)).twoStep) next = "/auth/two-step";
  } catch (error) {
    return { status: "error", message: message(error) };
  }
  redirect(next);
}

export async function signOutAction() {
  await signOut();
  redirect("/account");
}

export async function signOutEverywhereAction() {
  const user = await currentUser();
  if (user) await signOutEverywhere(user.id);
  redirect("/account");
}

// ---------------------------------------------------------------- two-step sign-in

/** The step after the email link: the code from the authenticator app, or a recovery code. */
export async function submitTwoStepCode(_prev: ConfirmState, form: FormData): Promise<ConfirmState> {
  let next: string;
  try {
    next = safeNext(await finishTwoStep(String(form.get("code") ?? "")));
  } catch (error) {
    return { status: "error", message: message(error) };
  }
  redirect(next);
}

export type TwoStepState =
  | { status: "idle" }
  | { status: "codes"; codes: string[] }
  | { status: "off" }
  | { status: "error"; message: string };

/** Setup step 1: a new secret; the page shows it as a QR code. */
export async function beginTwoStep() {
  const user = await currentUser();
  if (!user) redirect("/account");
  try {
    await beginSetup(user.id);
  } catch (error) {
    console.error("[two-step]", error);
    redirect("/account?two_step=unavailable");
  }
  redirect("/account?two_step=setup");
}

/** Setup step 2: a code from the app turns it on and returns the recovery codes. */
export async function confirmTwoStep(_prev: TwoStepState, form: FormData): Promise<TwoStepState> {
  const user = await currentUser();
  if (!user) return { status: "error", message: "Sign in again first." };
  try {
    const codes = await confirmSetup(user.id, String(form.get("code") ?? ""));
    return { status: "codes", codes };
  } catch (error) {
    return { status: "error", message: message(error) };
  }
}

export async function disableTwoStep(_prev: TwoStepState, form: FormData): Promise<TwoStepState> {
  const user = await currentUser();
  if (!user) return { status: "error", message: "Sign in again first." };
  try {
    await disable(user.id, String(form.get("code") ?? ""));
  } catch (error) {
    return { status: "error", message: message(error) };
  }
  revalidatePath("/account");
  return { status: "off" };
}

export async function newRecoveryCodes(_prev: TwoStepState, form: FormData): Promise<TwoStepState> {
  const user = await currentUser();
  if (!user) return { status: "error", message: "Sign in again first." };
  try {
    return { status: "codes", codes: await regenerateRecoveryCodes(user.id, String(form.get("code") ?? "")) };
  } catch (error) {
    return { status: "error", message: message(error) };
  }
}

/** Paddle's customer portal: invoices, card, plan changes, cancelling. */
export async function openBillingPortal(form: FormData) {
  const user = await currentUser();
  if (!user) redirect("/account");
  if (!user.paddleCustomerId) redirect("/account?billing=none");
  let url: string;
  try {
    url = await portalUrl(user.paddleCustomerId, user.paddleSubscriptionId, form.get("target") === "cancel" ? "cancel" : "overview");
  } catch (error) {
    console.error("[billing]", error);
    redirect("/account?billing=error");
  }
  redirect(url);
}
