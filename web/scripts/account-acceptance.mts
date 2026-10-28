// Accounts, plans and billing acceptance (SEC-27, SEC-28), deterministic:
//
//   npm run account:acceptance          # from web/
//
// A throwaway Postgres (PGlite, platform/src/local-db.ts) with every migration,
// the fixture manifests imported, a stand-in for Supabase Auth's two endpoints
// (/auth/v1/otp and /auth/v1/verify), and Paddle webhooks signed here with a
// test secret. The app's own route handlers are called in process with real
// Request objects and cookies, so this exercises what the browser would:
//
//  1. magic link and code sign-in create one user and a session cookie;
//  2. with PLAN_GATES=on, Free cannot make boards (401 signed out, 402 Free);
//  3. a signed subscription.created upgrades to Pro, boards work;
//  4. a scheduled cancellation keeps Pro with an end date; subscription.canceled downgrades to Free;
//  5. redelivered, stale, forged and unknown events change nothing;
//  6. the Free daily view cap counts distinct blocks; Pro has none;
//  7. a token board from before accounts is claimed on the first signed-in visit;
//  8. the 7-day trial is Pro; after it, Free loses brief, time machine and filters; signed out opens nothing;
//  9. two-step sign-in: setup, pending sessions, codes once only, recovery codes, lockout, turning off;
// 10. a session that slides forward renews its cookie; signing out everywhere.
// What it cannot prove: the real emails, Safari and phones, and Paddle's
// checkout. docs/AUTH-AND-BILLING.md has the manual checklist for those.
// Exit 0 when every check passes.

import { execFile } from "node:child_process";
import { createHmac } from "node:crypto";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { startLocalDb } from "../../platform/src/local-db.ts";

const run = promisify(execFile);
const here = import.meta.dirname;
const platform = resolve(here, "../../platform");

// ---------------------------------------------------------------- stand-in Supabase Auth

const local = await startLocalDb();
const ids = new Map<string, string>();
const sentTo: string[] = [];
const used = new Set<string>();
const gotrue = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", async () => {
    const json = JSON.parse(body || "{}");
    const reply = (status: number, data: unknown) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(data)); };
    if (req.headers.apikey !== "sb_publishable_test") return reply(401, { msg: "No API key found in request" });
    if (req.url === "/auth/v1/otp") {
      sentTo.push(json.email);
      if (!ids.has(json.email)) {
        const id = crypto.randomUUID();
        ids.set(json.email, id);
        await local.db.query("INSERT INTO auth.users (id) VALUES ($1)", [id]);
      }
      return reply(200, {});
    }
    if (req.url === "/auth/v1/verify") {
      // token_hash "th-<email>" and code "123456" are what the email would carry; each works once.
      const email = json.token_hash ? String(json.token_hash).replace(/^th-/, "") : json.email;
      const key = json.token_hash ?? `${json.email}:${json.token}`;
      const ok = ids.has(email) && !used.has(key) && (json.token_hash ? true : json.token === "123456");
      if (!ok) return reply(403, { code: 403, error_code: "otp_expired", msg: "Token has expired or is invalid" });
      used.add(key);
      return reply(200, { access_token: "x", user: { id: ids.get(email), email } });
    }
    reply(404, {});
  });
});
await new Promise<void>((r) => gotrue.listen(0, "127.0.0.1", r));
const gotrueUrl = `http://127.0.0.1:${(gotrue.address() as { port: number }).port}`;

// ---------------------------------------------------------------- environment

const SECRET = "pdl_ntfset_test_secret";
Object.assign(process.env, {
  DATABASE_URL: local.url, SUPABASE_URL: gotrueUrl, SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  PLAN_GATES: "on", FREE_DAILY_VIEWS: "2", AUTH_ENCRYPTION_KEY: "acceptance-key", DATABASE_POOL_MAX: "1", PADDLE_WEBHOOK_SECRET: SECRET,
  PADDLE_PRICE_PRO_MONTH: "pri_pro_m", PADDLE_PRICE_PRO_YEAR: "pri_pro_y", PADDLE_PRICE_TEAM_MONTH: "pri_team_m",
});

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? `  (${detail})` : ""}`);
  if (!ok) failed++;
};

try {
  await run("npm", ["run", "-s", "import", "--", resolve(here, "../../fixtures/manifests")], { cwd: platform, env: process.env, shell: true, maxBuffer: 1 << 26 });
  const blockIds = (await local.db.query<{ id: string }>("SELECT id FROM blocks ORDER BY id LIMIT 3")).rows.map((r) => r.id);
  check("fixtures imported", blockIds.length === 3);

  const accounts = await import("@/server/accounts");
  const auth = await import("@/server/supabase-auth");
  const boardsRoute = await import("@/app/api/boards/route");
  const boardRoute = await import("@/app/api/boards/[id]/route");
  const itemsRoute = await import("@/app/api/boards/[id]/items/route");
  const accountRoute = await import("@/app/api/account/route");
  const viewsRoute = await import("@/app/api/views/route");
  const webhook = await import("@/app/api/paddle/webhook/route");
  const blocksRoute = await import("@/app/api/blocks/route");
  const historyRoute = await import("@/app/api/blocks/[id]/history/route");
  const briefRoute = await import("@/app/api/brief/route");
  const twoStep = await import("@/server/two-step");
  const totp = await import("@/server/totp");
  const endTrial = (id: string) => local.db.query("UPDATE users SET trial_ends_at = now() - interval '1 minute' WHERE id=$1", [id]);

  const base = "http://app.test";
  const req = (path: string, init: RequestInit & { cookie?: string; json?: unknown } = {}) => {
    const headers = new Headers(init.headers);
    if (init.cookie) headers.set("cookie", init.cookie);
    if (init.json !== undefined) headers.set("content-type", "application/json");
    return new Request(base + path, { ...init, headers, body: init.json !== undefined ? JSON.stringify(init.json) : init.body });
  };
  const ctx = (params: Record<string, string>) => ({ params: Promise.resolve(params) }) as never;

  // What the confirm and code actions do, minus Next's cookie jar.
  async function signIn(verified: { id: string; email: string }) {
    const user = await accounts.upsertUser(verified.id, verified.email);
    const { token } = await accounts.createSession(user.id, "acceptance");
    return { user, cookie: `${accounts.SESSION_COOKIE}=${encodeURIComponent(token)}` };
  }

  // ------------------------------------------------------------ 1. sign-in
  await auth.sendMagicLink("ana@studio.test");
  check("magic link requested from Supabase", sentTo.includes("ana@studio.test"));
  const viaLink = await auth.verifyTokenHash("th-ana@studio.test", "email");
  const ana = await signIn(viaLink);
  check("token-hash link signs in", ana.user.email === "ana@studio.test" && ana.user.plan === "free");
  const reused = await auth.verifyTokenHash("th-ana@studio.test", "email").then(() => "accepted", (e: { code?: string }) => e.code);
  check("a used link is refused with a clear error", reused === "EXPIRED", String(reused));
  await auth.sendMagicLink("ana@studio.test");
  const viaCode = await auth.verifyCode("ana@studio.test", "123 456");
  const ana2 = await signIn(viaCode);
  check("six-digit code signs the same person in", ana2.user.id === ana.user.id);
  const badType = await auth.verifyTokenHash("th-x", "recovery").then(() => "accepted", (e: { code?: string }) => e.code);
  check("link types other than email sign-in are refused", badType === "INVALID");
  let body = await (await accountRoute.GET(req("/api/account", { cookie: ana.cookie }))).json();
  check("GET /api/account shows the account", body.account?.email === "ana@studio.test" && body.account.plan === "free");
  body = await (await accountRoute.GET(req("/api/account"))).json();
  check("GET /api/account signed out is null", body.account === null);
  body = await (await accountRoute.GET(req("/api/account", { cookie: `${accounts.SESSION_COOKIE}=forged` }))).json();
  check("a forged session cookie is nobody", body.account === null);
  await accounts.endSession(decodeURIComponent(ana2.cookie.split("=")[1]));
  check("signing out ends that session only", (await accounts.userForRequest(req("/", { cookie: ana2.cookie }))) === null
    && (await accounts.userForRequest(req("/", { cookie: ana.cookie })))?.id === ana.user.id);

  // ------------------------------------------------------------ 8a. the trial
  const days = (Date.parse(ana.user.trialEndsAt ?? "") - Date.now()) / 86_400_000;
  check("a new account starts a 7-day trial", days > 6.9 && days <= 7, String(days));
  body = await (await accountRoute.GET(req("/api/account", { cookie: ana.cookie }))).json();
  check("on the trial: access is Pro with every feature", body.account?.access === "pro" && body.features?.includes("brief") && body.features?.includes("history") && body.views?.limit === null);
  let res = await boardsRoute.POST(req("/api/boards", { method: "POST", cookie: ana.cookie, json: { name: "Trial board" } }));
  const trialBoard = await res.json();
  check("on the trial: boards work", res.status === 201, String(res.status));
  res = await historyRoute.GET(req(`/api/blocks/${blockIds[0]}/history`, { cookie: ana.cookie }), ctx({ id: blockIds[0] }));
  check("on the trial: the time machine works", res.status === 200, String(res.status));
  await endTrial(ana.user.id);
  body = await (await accountRoute.GET(req("/api/account", { cookie: ana.cookie }))).json();
  check("after the trial: access is Free", body.account?.access === "free" && body.account.plan === "free" && body.views?.limit === 2 && !body.features?.includes("brief"));
  body = await (await accountRoute.GET(req("/api/account"))).json();
  check("signed out: no features, browsing only", body.gates === true && Array.isArray(body.features) && body.features.length === 0);

  // ------------------------------------------------------------ 2. gates on Free
  res = await boardsRoute.POST(req("/api/boards", { method: "POST", json: { name: "Signed out" } }));
  check("signed out cannot make a board (401 SIGN_IN_REQUIRED)", res.status === 401 && (await res.json()).code === "SIGN_IN_REQUIRED");
  res = await boardsRoute.POST(req("/api/boards", { method: "POST", cookie: ana.cookie, json: { name: "Free" } }));
  check("Free cannot make a board (402 PLAN_REQUIRED)", res.status === 402 && (await res.json()).code === "PLAN_REQUIRED");
  res = await itemsRoute.POST(req(`/api/boards/${trialBoard.board.id}/items`, { method: "POST", cookie: ana.cookie, json: { blockId: blockIds[0] } }), ctx({ id: trialBoard.board.id }));
  const readBack = await boardRoute.GET(req(`/api/boards/${trialBoard.board.id}`, { cookie: ana.cookie }), ctx({ id: trialBoard.board.id }));
  check("after the trial: the trial's board is read-only (402 on add, 200 on read)", res.status === 402 && readBack.status === 200);
  res = await briefRoute.POST(req("/api/brief", { method: "POST", cookie: ana.cookie, json: { blockId: blockIds[0], target: "designer" } }));
  check("Free: Copy as brief is refused (402)", res.status === 402, String(res.status));
  res = await briefRoute.POST(req("/api/brief", { method: "POST", json: { blockId: blockIds[0], target: "designer" } }));
  check("signed out: Copy as brief is refused (401)", res.status === 401, String(res.status));
  res = await historyRoute.GET(req(`/api/blocks/${blockIds[0]}/history`, { cookie: ana.cookie }), ctx({ id: blockIds[0] }));
  check("Free: the time machine is refused (402)", res.status === 402, String(res.status));
  const totalOf = async (path: string, cookie?: string) => {
    const r = await blocksRoute.GET(req(path, { cookie }));
    return { total: (await r.json()).total as number, cache: r.headers.get("cache-control") ?? "" };
  };
  const all = await totalOf("/api/blocks?limit=1"), freeVp = await totalOf("/api/blocks?limit=1&vp=mobile", ana.cookie);
  check("Free: filters other than Store and Block type are dropped, and not CDN-cached", freeVp.total === all.total && freeVp.cache.includes("no-store"), `${freeVp.total} vs ${all.total}`);
  const { host } = (await local.db.query<{ host: string }>("SELECT host FROM sites ORDER BY host LIMIT 1")).rows[0];
  const freeHost = await totalOf(`/api/blocks?limit=1&host=${encodeURIComponent(host)}`, ana.cookie);
  check("Free: the Store filter still works", freeHost.total > 0 && freeHost.total < all.total, `${freeHost.total}`);

  // ------------------------------------------------------------ 3. Paddle upgrade
  let n = 0;
  const event = (type: string, data: Record<string, unknown>, at = new Date(Date.UTC(2026, 9, 15, 12, 0, n)).toISOString()) =>
    ({ event_id: `evt_${++n}`, event_type: type, occurred_at: at, notification_id: `ntf_${n}`, data });
  const send = (payload: unknown, secret = SECRET, ts = Math.floor(Date.now() / 1000)) => {
    const raw = JSON.stringify(payload);
    const h1 = createHmac("sha256", secret).update(`${ts}:${raw}`).digest("hex");
    return webhook.POST(new Request(`${base}/api/paddle/webhook`, { method: "POST", body: raw, headers: { "paddle-signature": `ts=${ts};h1=${h1}` } }));
  };
  const sub = (status: string, extra: Record<string, unknown> = {}) => ({
    id: "sub_01", status, customer_id: "ctm_01", custom_data: { userId: ana.user.id },
    items: [{ price: { id: "pri_pro_m" }, quantity: 1 }], next_billed_at: "2026-11-15T12:00:00Z", ...extra,
  });
  const plan = async () => (await accounts.userForRequest(req("/", { cookie: ana.cookie })))!;

  const created = event("subscription.created", sub("active"));
  res = await send(created);
  check("subscription.created: webhook accepted", res.status === 200, String(res.status));
  let me = await plan();
  check("a test purchase upgrades the account to Pro", me.plan === "pro" && me.paddleCustomerId === "ctm_01" && me.renewsAt !== null, me.plan);
  res = await send(created);
  check("a redelivered event is a no-op", (await res.json()).outcome === "duplicate");
  res = await send(event("subscription.updated", sub("active")), "wrong_secret");
  check("a forged signature is refused (401)", res.status === 401);
  res = await send(event("subscription.updated", sub("canceled")), SECRET, Math.floor(Date.now() / 1000) - 3600);
  check("a replayed old signature is refused (401)", res.status === 401);

  res = await boardsRoute.POST(req("/api/boards", { method: "POST", cookie: ana.cookie, json: { name: "Acme PDP" } }));
  const createdBoard = await res.json();
  check("Pro can make a board", res.status === 201, String(res.status));
  res = await itemsRoute.POST(req(`/api/boards/${createdBoard.board.id}/items`, { method: "POST", cookie: ana.cookie, json: { blockId: blockIds[0] } }), ctx({ id: createdBoard.board.id }));
  check("Pro can add a block without a token header", res.status === 200 && (await res.json()).items.length === 1);
  body = await (await boardsRoute.GET(req("/api/boards", { cookie: ana.cookie }))).json();
  check("GET /api/boards lists the account's boards (the trial one and this one)", body.items?.length === 2, String(body.items?.length));

  // ------------------------------------------------------------ 4. cancellation
  await send(event("subscription.updated", sub("active", { scheduled_change: { action: "cancel", effective_at: "2026-11-15T12:00:00Z" } })));
  me = await plan();
  check("a scheduled cancellation keeps Pro until the period ends", me.plan === "pro" && me.cancelAt !== null);
  const stale = event("subscription.updated", sub("active", { items: [{ price: { id: "pri_team_m" }, quantity: 5 }] }), "2026-10-01T00:00:00Z");
  res = await send(stale);
  check("an older event arriving late changes nothing", (await res.json()).outcome === "stale" && (await plan()).plan === "pro");
  await send(event("subscription.canceled", sub("canceled", { canceled_at: "2026-11-15T12:00:00Z" })));
  me = await plan();
  check("subscription.canceled downgrades the account to Free", me.plan === "free" && me.planStatus === "canceled", me.plan);
  res = await itemsRoute.POST(req(`/api/boards/${createdBoard.board.id}/items`, { method: "POST", cookie: ana.cookie, json: { blockId: blockIds[1] } }), ctx({ id: createdBoard.board.id }));
  check("after the downgrade, adding to a board is refused (402)", res.status === 402);
  res = await boardRoute.GET(req(`/api/boards/${createdBoard.board.id}`, { cookie: ana.cookie }), ctx({ id: createdBoard.board.id }));
  check("after the downgrade, the board can still be read", res.status === 200);

  // Team, then an old subscription's end must not take it away.
  await send(event("subscription.created", { ...sub("active"), id: "sub_02", items: [{ price: { id: "pri_team_m" }, quantity: 4 }] }));
  me = await plan();
  check("Team with seats", me.plan === "team" && me.seats === 4, `${me.plan} ${me.seats}`);
  res = await send(event("subscription.canceled", sub("canceled")));
  check("an old subscription ending leaves the new one's plan", (await res.json()).outcome === "other_subscription" && (await plan()).plan === "team");
  res = await send(event("subscription.updated", { ...sub("active"), id: "sub_02", items: [{ price: { id: "pri_unknown" }, quantity: 1 }] }));
  check("an unknown price changes nothing", (await res.json()).outcome === "unknown_price" && (await plan()).plan === "team");
  res = await send(event("transaction.completed", { id: "txn_01" }));
  check("other event types are accepted and ignored", (await res.json()).outcome === "ignored");
  res = await send(event("subscription.created", { ...sub("active"), id: "sub_03", customer_id: "ctm_nobody", custom_data: null }));
  check("a subscription for nobody we know is recorded, not applied", (await res.json()).outcome === "unmatched");

  // ------------------------------------------------------------ 6. views
  await auth.sendMagicLink("bo@studio.test");
  const bo = await signIn(await auth.verifyTokenHash("th-bo@studio.test", "email"));
  await endTrial(bo.user.id);
  const view = async (cookie: string | undefined, blockId: string) => {
    const r = await viewsRoute.POST(req("/api/views", { method: "POST", cookie, json: { blockId } }));
    return { ...(await r.json()), setCookie: r.headers.get("set-cookie") };
  };
  const v1 = await view(bo.cookie, blockIds[0]), v2 = await view(bo.cookie, blockIds[1]), v1again = await view(bo.cookie, blockIds[0]), v3 = await view(bo.cookie, blockIds[2]);
  check("Free: two distinct blocks a day (FREE_DAILY_VIEWS=2)", v1.allowed && v2.allowed && v2.used === 2);
  check("Free: reopening a block already seen today is free", v1again.allowed && v1again.used === 2);
  check("Free: the third distinct block is refused", v3.allowed === false && v3.limit === 2);
  check("Free: the refused block says why (LIMIT)", v3.reason === "LIMIT");
  const anon1 = await view(undefined, blockIds[0]);
  check("signed out: opening a block needs an account", anon1.allowed === false && anon1.reason === "SIGN_IN_REQUIRED");
  const t1 = await view(ana.cookie, blockIds[0]), t2 = await view(ana.cookie, blockIds[1]), t3 = await view(ana.cookie, blockIds[2]);
  check("Team: no cap", t1.allowed && t2.allowed && t3.allowed && t3.limit === null);

  // ------------------------------------------------------------ 9. two-step sign-in
  await auth.sendMagicLink("cy@studio.test");
  const cy = await signIn(await auth.verifyTokenHash("th-cy@studio.test", "email"));
  const secret = await twoStep.beginSetup(cy.user.id);
  const stored = (await local.db.query<{ totp_pending_secret: string }>("SELECT totp_pending_secret FROM users WHERE id=$1", [cy.user.id])).rows[0];
  check("two-step: the secret is stored encrypted", stored.totp_pending_secret.startsWith("v1.") && !stored.totp_pending_secret.includes(secret));
  const wrongSetup = await twoStep.confirmSetup(cy.user.id, "000000").then(() => "accepted", (e: { code?: string }) => e.code);
  check("two-step: a wrong code does not turn it on", wrongSetup === "INVALID");
  // A step at or before the last one used is refused, so each check takes a later step.
  const at = (offset: number) => totp.codeFor(secret, totp.stepAt() + offset);
  const recovery = await twoStep.confirmSetup(cy.user.id, at(-1));
  check("two-step: a code from the app turns it on, with 10 recovery codes", recovery.length === 10 && (await accounts.userById(cy.user.id))?.twoStepSince != null);
  const pend = await accounts.createSession(cy.user.id, "acceptance", { next: "/boards" });
  const pendCookie = `${accounts.SESSION_COOKIE}=${encodeURIComponent(pend.token)}`;
  check("two-step: a pending session signs nobody in", (await accounts.userForRequest(req("/", { cookie: pendCookie }))) === null);
  check("two-step: the code step finds the pending sign-in", (await twoStep.pendingSignIn(pend.token))?.next === "/boards");
  const wrong = await twoStep.finishSignIn(pend.token, "000000").then(() => "accepted", (e: { message: string }) => e.message);
  check("two-step: a wrong code counts down", /4 tries left/.test(String(wrong)), String(wrong));
  const fin = await twoStep.finishSignIn(pend.token, at(0));
  check("two-step: the right code finishes the sign-in", fin.userId === cy.user.id && fin.next === "/boards" && (await twoStep.pendingSignIn(pend.token)) === null);
  const pend2 = await accounts.createSession(cy.user.id, "acceptance", { next: "/" });
  const replay = await twoStep.finishSignIn(pend2.token, at(0)).then(() => "accepted", (e: { code?: string }) => e.code);
  check("two-step: the same code cannot be used twice", replay === "INVALID");
  const viaRecovery = await twoStep.finishSignIn(pend2.token, recovery[0].toUpperCase());
  check("two-step: a recovery code signs in", viaRecovery.userId === cy.user.id);
  const pend3 = await accounts.createSession(cy.user.id, "acceptance", { next: "/" });
  const recoveryAgain = await twoStep.finishSignIn(pend3.token, recovery[0]).then(() => "accepted", (e: { code?: string }) => e.code);
  check("two-step: a recovery code works once", recoveryAgain === "INVALID" && (await twoStep.recoveryCodesLeft(cy.user.id)) === 9);
  let last = "";
  for (let i = 0; i < 4; i++) last = await twoStep.finishSignIn(pend3.token, "111111").then(() => "accepted", (e: { code?: string }) => e.code ?? "");
  check("two-step: the fifth wrong code ends the pending sign-in", last === "LOCKED" && (await twoStep.pendingSignIn(pend3.token)) === null);
  const offWrong = await twoStep.disable(cy.user.id, "222222").then(() => "off", (e: { code?: string }) => e.code);
  check("two-step: turning it off needs a right code", offWrong === "INVALID");
  await twoStep.disable(cy.user.id, recovery[1]);
  check("two-step: turned off with a recovery code", (await accounts.userById(cy.user.id))?.twoStepSince === null && (await twoStep.recoveryCodesLeft(cy.user.id)) === 0);

  // ------------------------------------------------------------ 10. session renewal, sign out everywhere
  const cyToken = decodeURIComponent(cy.cookie.split("=")[1]);
  await local.db.query("UPDATE sessions SET last_seen_at = now() - interval '2 hours' WHERE token_hash=$1", [accounts.hashToken(cyToken)]);
  res = await accountRoute.GET(req("/api/account", { cookie: cy.cookie }));
  const renewedCookie = res.headers.get("set-cookie") ?? "";
  check("a session used after an hour renews its cookie for 30 days", renewedCookie.startsWith(`${accounts.SESSION_COOKIE}=`) && renewedCookie.includes("Max-Age=2592000") && renewedCookie.includes("HttpOnly"));
  res = await accountRoute.GET(req("/api/account", { cookie: cy.cookie }));
  check("and not again within the hour", res.headers.get("set-cookie") === null);
  const cyOther = await signIn({ id: cy.user.id, email: cy.user.email });
  await accounts.endAllSessions(cy.user.id);
  check("sign out everywhere ends every session", (await accounts.userForRequest(req("/", { cookie: cy.cookie }))) === null
    && (await accounts.userForRequest(req("/", { cookie: cyOther.cookie }))) === null);

  // ------------------------------------------------------------ 7. token boards from before accounts
  process.env.PLAN_GATES = "off";
  res = await boardsRoute.POST(req("/api/boards", { method: "POST", json: { name: "Before accounts" } }));
  const legacy = await res.json();
  check("gates off: signed out still makes token boards", res.status === 201 && typeof legacy.token === "string");
  res = await boardRoute.GET(req(`/api/boards/${legacy.board.id}`, { cookie: bo.cookie, headers: { "x-board-token": legacy.token } }), ctx({ id: legacy.board.id }));
  check("first signed-in visit with the token claims the board", res.status === 200
    && (await (await boardsRoute.GET(req("/api/boards", { cookie: bo.cookie }))).json()).items.some((b: { id: string }) => b.id === legacy.board.id));
  res = await boardRoute.GET(req(`/api/boards/${legacy.board.id}`, { headers: { "x-board-token": legacy.token } }), ctx({ id: legacy.board.id }));
  check("once claimed, the bare token no longer opens it", res.status === 403);
  res = await boardRoute.GET(req(`/api/boards/${createdBoard.board.id}`, { cookie: bo.cookie }), ctx({ id: createdBoard.board.id }));
  check("another account cannot open someone's board (403)", res.status === 403);
  body = await (await accountRoute.GET(req("/api/account", { cookie: bo.cookie }))).json();
  check("gates off: no view cap reported", body.views?.limit === null);
} catch (error) {
  console.error(error);
  failed++;
} finally {
  gotrue.close();
  const { database } = await import("@/server/db").catch(() => ({ database: null }));
  await database?.().end({ timeout: 1 }).catch(() => {});
  await local.stop();
}

console.log(failed ? `\n${failed} check(s) failed` : "\nAll checks passed");
process.exit(failed ? 1 : 0);
