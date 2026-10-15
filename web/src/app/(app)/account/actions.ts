"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { currentUser, EMAIL_COOKIE, rememberSignIn, safeNext, signOut, startSession, takeNext } from "@/server/auth";
import { AuthError, sendMagicLink, verifyCode, verifyTokenHash } from "@/server/supabase-auth";
import { portalUrl } from "@/server/paddle";

// SEC-27 sign-in and SEC-28 billing actions. Thin: the work is in src/server.

export type SignInState =
  | { status: "idle" }
  | { status: "sent"; email: string }
  | { status: "error"; message: string; email: string; step: "email" | "code" };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const message = (error: unknown) => {
  if (error instanceof AuthError) return error.message;
  console.error("[auth]", error);
  return "Something went wrong on our side. Try again in a minute.";
};

/** Step 1: email the link and the code. */
export async function requestSignIn(_prev: SignInState, form: FormData): Promise<SignInState> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  if (!email || email.length > 254 || !EMAIL.test(email)) {
    return { status: "error", message: "That doesn't look like an email address. Check for a typo.", email, step: "email" };
  }
  try {
    await sendMagicLink(email);
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
    await startSession(await verifyCode(email, String(form.get("code") ?? "")));
    next = await takeNext();
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
    await startSession(await verifyTokenHash(String(form.get("token_hash") ?? ""), String(form.get("type") ?? "email")));
    next = await takeNext();
  } catch (error) {
    return { status: "error", message: message(error) };
  }
  redirect(next);
}

export async function signOutAction() {
  await signOut();
  redirect("/account");
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
