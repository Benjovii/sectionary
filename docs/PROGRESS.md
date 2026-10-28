# Progress

The session log (SEC-35). One entry per working session, newest first: what
moved, what is waiting and on whom, and anything the next person needs to know.
PLAN.md changes only when scope does; the board mirrors every work item.

Earlier sessions are in Ben's vault copy (To Do's/New APP Mobbin Recreate).
This file starts on 2026-10-01 so every lane can append to it.

## 2026-10-28 · Buna (Lane B)

**Free plan with a 7-day trial, two-step sign-in, session fix.** On `buna`.

- Free plan, mostly the "free trial, then locked" model with two pieces of
  "blur the good stuff": every account gets Pro for 7 days, no card; after
  that Free opens 3 blocks a day, filters by Store and Block type only, has no
  Copy as brief, time machine, copy image or source link, and its boards are
  read-only. Signed out: blurred wall, and opening a block asks for an account.
  Enforced by the API (`can(access, feature)` in `server/plans.ts`), shown in
  the UI as locks and a trial badge in the app bar.
- Two-step sign-in with an authenticator app (TOTP), optional per account on
  the account page: QR setup, ten recovery codes, `/auth/two-step` after the
  email link, five tries, codes usable once.
- Session fix: the cookie is now renewed when the session slides (it used to
  expire 30 days after sign-in however often it was used). Sign out everywhere.
- Migration `0010_trial_two_step.sql` and the new `AUTH_ENCRYPTION_KEY`
  variable: see [AUTH-AND-BILLING.md](AUTH-AND-BILLING.md). `npm run
  account:acceptance` covers all of it and passes.
- Lane C files touched, for Leke's review: block dialog (locks), filter bar
  (locks), block card (blur), app bar (trial badge), account page (two-step card).

## 2026-10-15 · Buna (Lane B)

**SEC-27 · auth with magic links.** Built on `buna`. Supabase sends the link
and a six-digit code; the link uses the token-hash pattern and lands on
`/auth/confirm`, which signs in on a button press (mail scanners cannot use up
the token). The app keeps its own httpOnly session cookie, not Supabase's
JWT. `/account` signs in, shows the plan and signs out. Boards now belong to
the signed-in account; token boards are claimed on the first signed-in visit.
Migration `0009_accounts_billing.sql` (not yet applied to Supabase).

**SEC-28 · plans and Paddle billing.** Free, Pro, Team. Paddle.js checkout on
`/account`, signed webhooks at `/api/paddle/webhook` (idempotent, ordered),
customer portal for card, invoices and cancelling. Gates: Free has a daily
cap on opened blocks (`POST /api/views`) and no boards. **The gates stay off
until `PLAN_GATES=on`**, so staging keeps working for us.

- `npm run account:acceptance` (web/): 41 checks against a throwaway Postgres,
  a stand-in Supabase Auth and signed webhooks, all passing. Also driven in
  Chromium at 375px and 1280px against `next dev` (link on a second device,
  code, used link, gates, purchase, cancellation, sign out): all passing.
  WebKit (Safari's engine) not run: its download failed on this PC.
- Waiting on Ben: apply the migration; Supabase Site URL, custom SMTP and the
  two email templates; Paddle sandbox products, tokens and webhook; the Vercel
  variables. All listed in [AUTH-AND-BILLING.md](AUTH-AND-BILLING.md). The
  "done when" checks (real Safari, Chrome, a phone, a sandbox purchase and
  cancellation) need that setup.
- Contract: additive `Account`, `Plan`, `ViewCheck`, `GET /api/account`,
  `GET /api/boards`, `POST /api/views`. Raise in "Contracts v1".
- Lane C files touched, for Leke's review: `/account` and `/auth/confirm`
  pages, the account icon in the app bar, the limit panel in the block
  dialog, and the sign-in and plan gate messages in the boards components.
- Follow-up: Team seat invites.

**Ops · infrastructure.** [OPS.md](OPS.md) records what exists (Supabase,
DigitalOcean Spaces instead of R2, Vercel) and what is open (VPS, capped
Anthropic and Voyage keys). `ops/vps-setup.sh` sets up an Ubuntu VPS with
Playwright and the settings file outside the repo; `npm run hello-capture` is
the done-when check (capture, upload, read back). Not run yet: this PC has no
bucket key, and the VPS does not exist yet.

## 2026-10-01 · Leke (Lane C)

**SEC-47 · the app on the API.** In review as PR #15 (leke → main).

- With the API settings on, every page used to fetch one page of
  `/api/blocks` and `/api/stores` (60 rows) and treat it as the whole
  library: the wall showed 60 blocks and Flows counted 4 stores of 15.
- The wall now sends each query to `/api/blocks` and pages through the
  cursor; the sample JSON path still works for local development. Both sit
  behind one `WallSource` (`web/src/lib/load-blocks.ts`).
- `/api/blocks` gained `video` and `color` filters, facets for every filter
  and `nearMiss`, in one SQL pass that gives the same results as the browser
  code (checked on nine filter combinations). `GET /api/blocks/[id]` makes
  pasted `?open=` links work.
- A Store filter (`?host=`) on the wall. It also fixes the site profile's
  "See all N blocks" link, which was being ignored.
- `GET /api/sites` lists every store with its latest pages; Sites and Flows
  read it. Counts match the database.
- The M2 exit test passes against a local Postgres with the fixture
  manifests imported, at phone width.
- Waiting: a staging deployment, which needs the Vercel host (SEC-34,
  SEC-48). Staging sets `DATABASE_URL` and `NEXT_PUBLIC_BLOCKS_SRC`,
  `_STORES_SRC`, `_SITES_SRC` as in `web/.env.example`, and imports with
  `S3_PUBLIC_BASE_URL` so block images resolve.
- Waiting: a contract PR for `video`, `color`, `nearMiss`, comma-separated
  `vp` and `GET /api/sites`, to be raised in SEC-37 first. Lane B (Buna) to
  review the API changes in PR #15.
- Open question: on the API the flow view and the page viewer show full-page
  screenshots, not clickable blocks with markers as on the sample. Switching
  is small if wanted.

**SEC-25 · waitlist.** The `waitlist` table now exists in Supabase, with RLS
on and recorded in `sectionary_migrations` beside the earlier migrations, so
`npm run db:migrate` stays safe. Waiting: `DATABASE_URL` in Vercel (same step
as staging) so sign-ups save, and the domain (SEC-33).

**Housekeeping.** Stale uncommitted work from 2026-09-23 (an early
server-side block index) is parked on branch `wip/block-index-0923`. It is
superseded by PR #15 and can be deleted after that merges.
