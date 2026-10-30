# Accounts, plans and billing

SEC-27 (magic-link sign-in, account page) and SEC-28 (Free, Pro and Team on
Paddle). This page is how it works and the one-time setup in Supabase, Paddle
and Vercel. The code is in `web/src/server/` (accounts, auth, supabase-auth,
plans, paddle, views) and `platform/drizzle/0009_accounts_billing.sql`.

## How sign-in works

1. `/account` asks for an email. The server calls Supabase Auth's `/otp`
   endpoint; Supabase sends one email with a link and a six-digit code.
2. The link goes to our own `/auth/confirm?token_hash=...&type=email`, not to
   Supabase. This is the token-hash pattern from Next Level: a token hash works
   in any browser on any device. The default PKCE link only works in the browser
   that asked for it, which breaks on phones (Mail opens Safari, Gmail opens
   its in-app browser) and across devices.
3. `/auth/confirm` shows one **Continue** button. Pressing it verifies the hash
   with Supabase. It is a button, not an automatic redirect, because mail
   scanners (Outlook Safe Links and others) open links to check them and would
   use up the one-time token before the person gets there.
4. Or the person types the code on the device where they asked, which helps
   when the mail is on a phone and the browser is on a laptop.
5. After Supabase confirms the address, the app upserts `users` (same id as
   `auth.users`) and sets its own session: a random token in an httpOnly,
   SameSite=Lax cookie (`sx_session`, 30 days, renewed on use), stored only as a
   SHA-256 in `sessions`. The app does not keep Supabase's JWT, so there is
   nothing to refresh and nothing for Safari's tracking protection to drop. The
   cookie is `Secure` in production only, because Safari does not store Secure
   cookies on `http://localhost` or on a dev server opened by IP from a phone.

**Before custom SMTP (today).** Supabase only lets you edit the email
template once custom SMTP is set up, so until then it sends its default
email: a link to Supabase and no code. That works too. The app asks Supabase
to send people back to `/auth/callback` (`redirect_to`, allowed by the
`https://sectionary-pink.vercel.app/**` Redirect URL); Supabase verifies the
link and redirects there with an access token in the URL fragment; the page
hands it to the server, which asks Supabase whose it is (`GET /auth/v1/user`)
and starts our own session as above, two-step included. Two limits until SMTP:
the default sender only reaches members of the Supabase organisation, a few
emails an hour; and a mail scanner that opens links can use one up before the
person clicks (our template's Continue button is what prevents that).

The app talks to Supabase Auth over plain HTTPS, with no Supabase client library,
like the rest of the code.

The session slides: used after more than an hour, its expiry moves 30 days
ahead in `sessions`, and `GET /api/account` (which every page calls once)
sends the cookie again with a fresh 30 days, so the browser keeps it too.
**Sign out everywhere** on the account page ends every session of the account.

## Two-step sign-in (authenticator app)

Optional, per account, from the account page: after the email link, a
six-digit code from an authenticator app (Google Authenticator, 1Password,
Authy...). Standard TOTP (RFC 6238: SHA-1, 6 digits, 30 seconds), written on
`node:crypto` in `web/src/server/totp.ts`; the database side is
`two-step.ts`.

- **Turning it on:** Turn on shows a QR code and the setup key; a code from the
  app confirms it and shows ten recovery codes once (Copy, Download).
- **Signing in with it on:** the email link or code makes a *pending* session
  (`sx_two_step` cookie, ten minutes, signs nobody in) and goes to
  `/auth/two-step`. The right code swaps it for the real session. Five wrong
  codes end it; the person starts again from the email.
- A code is accepted once (`totp_last_step`), one step of clock drift either
  way. Recovery codes work once each and are stored as SHA-256 only.
- The secret is encrypted with AES-256-GCM before it is stored, with the key
  from `AUTH_ENCRYPTION_KEY`. **Changing that key breaks every enrolled
  authenticator**, so set it once and keep it.
- Turning it off, or making new recovery codes, needs a current code.
- Lost phone and recovery codes: support clears `totp_secret` and
  `totp_enabled_at` on the users row after checking who it is.

## Plans

Every account starts with **Pro free for 7 days**, no card (`users.trial_ends_at`,
set on first sign-in). After that it is Free unless it pays.

| | Signed out | Free (after the trial) | Pro trial, Pro, Team |
|---|---|---|---|
| Wall and search | blurred previews | yes | yes |
| Blocks opened in the detail view | none: needs an account | `FREE_DAILY_VIEWS` a day (default 3) | unlimited |
| Filters | Store, Block type | Store, Block type | all |
| Copy as brief, time machine | no | no | yes |
| Copy image, source page link | no | no | yes |
| Boards and share links | no | read-only: the ones you have stay readable, shareable, deletable | yes |
| Price shown (hypothesis, PLAN.md) | | $0 | $12 a month, $96 a year; Team $20 a seat a month, $192 a year |

Each gate is one call, `can(access, feature)` in `web/src/server/plans.ts`,
and the API enforces it, not only the UI: `/api/brief` and
`/api/blocks/[id]/history` answer 402 (401 signed out), `/api/blocks` drops
filters other than Store and Block type (and then skips the CDN cache),
`/api/views` refuses signed-out viewers and caps Free, and board writes need
Pro. `GET /api/account` returns `gates` and `features` so the UI shows the locks.

- **The gates are off until `PLAN_GATES=on`.** With them off, everyone has
  boards and no cap, as before. That lets auth and billing go live on staging
  without locking the team out. Turn them on at launch.
- The daily cap counts distinct blocks opened per UTC day. Opening the same
  block again that day is free. Signed out, no block opens: the detail view
  asks for an account and offers the trial.
- The thumbnails themselves are public on the CDN; the blur on the wall and
  the locks on copy image and the source link are about the product, not secrecy.
- After a downgrade, existing boards stay readable, shareable and deletable.
  Only creating boards and adding blocks need Pro.
- Team is Pro billed per seat. Inviting the other seats is not built yet
  (follow-up task); today the buyer's account gets Team and the seat count.
- Boards from before accounts (edit token in the browser) are claimed by the
  first signed-in visit that carries the token. After that the token alone no
  longer opens them.

## How billing works

Paddle is the merchant of record (Stripe does not serve Kosovo; Paddle pays
out by Payoneer or IBAN).

- The account page opens Paddle.js checkout (overlay) with the price, the
  person's email and `customData.userId`.
- Paddle sends webhooks to `/api/paddle/webhook`. The handler verifies the
  `Paddle-Signature` header (HMAC-SHA256, rejects signatures older than five
  minutes), stores every event in `paddle_events` and updates the plan on
  `users` in the same transaction. A redelivered event is a no-op; an event
  older than the last one applied is ignored (`stale`); a cancelled old
  subscription does not downgrade a newer one.
- Statuses `active`, `trialing` and `past_due` keep the paid plan (past_due
  while Paddle retries the card); `paused` and `canceled` mean Free.
- A cancellation in Paddle is scheduled for the end of the period. The account
  page shows "Ends <date>, then Free", and the plan drops to Free when Paddle
  sends `subscription.canceled`.
- **Manage billing** and **Cancel plan** open Paddle's customer portal through
  a one-off portal session (invoices, card, plan changes, cancelling).

## One-time setup

### 1. Database

On Ben's PC, with the Session pooler address in `platform/.env`:

```bash
cd platform && npm run db:migrate     # applies 0009_accounts_billing.sql and 0010_trial_two_step.sql
```

### 2. Supabase (project for Sectionary)

- **Authentication → URL Configuration → Site URL**: the site's address (the
  Vercel URL today, the real domain later). The email links are built from it.
- **Authentication → URL Configuration → Redirect URLs**: `https://<site>/**`,
  so Supabase's default link may come back to `/auth/callback`. (For local
  development add `http://localhost:3000/**` too.)
- **Authentication → Emails → SMTP**: set up custom SMTP (Resend, Postmark or
  SES). Supabase's built-in sender only delivers to members of the Supabase
  organisation and a few emails an hour, so it is fine for testing and not for
  users.
- **Authentication → Sign In / Providers → Email**: email provider on; OTP
  length 6; OTP expiry 3600 seconds.
- **Authentication → Emails → Templates** (unlocked by custom SMTP; until then the default email works, see above): paste this into both **Magic Link**
  and **Confirm signup** (a new address gets the second one):

  Subject: `Your Sectionary sign-in link`

  ```html
  <h2>Sign in to Sectionary</h2>
  <p><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email">Sign in to Sectionary</a></p>
  <p>Or type this code on the sign-in page: <strong>{{ .Token }}</strong></p>
  <p>The link and the code work once, for one hour. If you did not ask to sign in, you can ignore this email.</p>
  ```

- **Project Settings → API Keys**: copy the project URL and the publishable key.

### 3. Paddle

Start in the sandbox (sandbox-vendors.paddle.com); repeat in the live account
once Paddle has approved the website.

- **Catalog → Products**: "Sectionary Pro" with a monthly ($12) and a yearly
  ($96) price; "Sectionary Team" with a monthly ($20) and a yearly ($192)
  price, quantity 2 to 50. Copy the four `pri_...` ids.
- **Checkout → Checkout settings → Default payment link**: `https://<site>/account`.
- **Developer tools → Authentication**: a client-side token (`test_...` in the
  sandbox) and an API key that can create customer portal sessions.
- **Developer tools → Notifications → New destination**: URL
  `https://<site>/api/paddle/webhook`, events `subscription.created`,
  `subscription.updated`, `subscription.activated`, `subscription.canceled`,
  `subscription.past_due`, `subscription.paused`, `subscription.resumed`,
  `subscription.trialing`. Copy its secret key.

### 4. Vercel (Production and Preview)

Server-only, none of them `NEXT_PUBLIC_`. Then redeploy.

| Variable | Value |
|---|---|
| `SUPABASE_URL` | `https://<project-ref>.supabase.co` |
| `SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_...` (a legacy anon key also works, as `SUPABASE_ANON_KEY`) |
| `PADDLE_ENV` | `sandbox`, later `production` |
| `PADDLE_CLIENT_TOKEN` | client-side token |
| `PADDLE_API_KEY` | API key (portal sessions) |
| `PADDLE_WEBHOOK_SECRET` | the notification destination's secret |
| `PADDLE_PRICE_PRO_MONTH`, `PADDLE_PRICE_PRO_YEAR`, `PADDLE_PRICE_TEAM_MONTH`, `PADDLE_PRICE_TEAM_YEAR` | `pri_...` |
| `PLAN_GATES` | leave unset until launch, then `on` |
| `FREE_DAILY_VIEWS` | optional, default 3 |
| `AUTH_ENCRYPTION_KEY` | a long random string (`openssl rand -base64 32`) for two-step secrets. Set once, never change it |

## Checking it

Automated, no accounts needed (throwaway Postgres, a stand-in for Supabase
Auth, Paddle webhooks signed with a test secret; trial, Free gates, two-step and session renewal too):

```bash
cd web && npm run account:acceptance
```

By hand, on the deployed site, for the "done when" of SEC-27 and SEC-28:

- [ ] Safari on a Mac: ask for a link, open it from Mail, Continue, signed in.
- [ ] Chrome on Windows: same, and once with the six-digit code instead.
- [ ] A phone: ask on the laptop, open the link on the phone (signs the phone in),
      and the other way round with the code.
- [ ] Sandbox purchase of Pro with card `4242 4242 4242 4242`, any future date,
      CVC `100`: the account page shows Pro within seconds; boards work.
- [ ] Cancel plan: the account shows the end date. In the Paddle sandbox,
      cancel the subscription "immediately" (or use the webhook simulator for
      `subscription.canceled`): the account drops to Free.
- [ ] `paddle_events` has one row per event, outcome `applied:pro` then `applied:free`.
