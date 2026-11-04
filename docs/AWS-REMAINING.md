# AWS move: what is left (4 Nov 2026)

The web app now runs on AWS (ECS Express Mode, eu-west-1) next to Vercel.
Customers still use Vercel. This page lists everything left before the switch
and after it, in order. The steps here need the accounts the setup did
not have access to: Vercel, Paddle, Anthropic, Voyage, DigitalOcean Spaces, the
crawler VPS. How the AWS side is built is in [AWS.md](AWS.md).

- AWS site: https://se-6cd7c961d8014e758b83164a633faec5.ecs.eu-west-1.on.aws
- Sign in: https://se-6cd7c961d8014e758b83164a633faec5.ecs.eu-west-1.on.aws/account
- Live site (unchanged until the switch): https://sectionary-pink.vercel.app

## Already done

- **Images**: on S3 (`sectionary-blocks-eu`) behind CloudFront
  (`https://d1jstas0718wp8.cloudfront.net`); database addresses rewritten on 3 Nov.
- **App**: service `sectionary-web` in cluster `sectionary`. 1 vCPU / 2 GB,
  1 to 3 copies, health check `/api/health`. Each merge to `main` builds the image
  and rolls it out (`.github/workflows/deploy-aws.yml`).
- **Wall, site pages, the database and email sign-in** work on the AWS address.
- **Secrets already in** AWS Secrets Manager → `sectionary/web`:
  - `DATABASE_URL`: the pooler address with the app's own limited role
    `sectionary_app` and a new password. This is not `postgres`, and Vercel's
    value is unchanged.
  - `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`.
  - `AUTH_ENCRYPTION_KEY`: a **new** key, not Vercel's. No account had two-step
    sign-in turned on when it was made (checked 4 Nov), so nobody loses anything.
    See "Before the switch", step 1.

## 1. Add the five API keys (needed before the switch)

Without these, the AWS site cannot do "Copy as brief" (Anthropic), search by
meaning (Voyage), or anything with payments (Paddle).

AWS console, region **Europe (Ireland)** → **Secrets Manager** → `sectionary/web`
→ **Retrieve secret value** → **Edit** → **Key/value** tab. Paste each value into
its row, with no spaces before or after, then **Save**:

| Row | Where the value comes from |
|---|---|
| `ANTHROPIC_API_KEY` | Vercel's value, or a new key in the Sectionary workspace at console.anthropic.com (it has the monthly spend limit, OPS.md) |
| `VOYAGE_API_KEY` | Vercel's value, or a new key at dashboard.voyageai.com |
| `PADDLE_API_KEY` | Vercel's value, or Paddle → Developer tools → Authentication |
| `PADDLE_CLIENT_TOKEN` | Vercel's value, or Paddle → Developer tools → Authentication |
| `PADDLE_WEBHOOK_SECRET` | Vercel's value. It is the secret of the existing destination in Paddle → Developer tools → Notifications; **do not make a new destination**, the switch edits that one's URL |

Never send these through chat, email or a file in the repo.

**Then restart the app** so it reads them: the app only reads the secret when it
starts. Either:

- in the AWS console: **ECS** → Clusters → `sectionary` → Services →
  `sectionary-web` → **Update service** → tick **Force new deployment** → Update; or
- `aws ecs update-service --cluster sectionary --service sectionary-web --force-new-deployment --region eu-west-1`

A restart takes **about 10 minutes**: the old copy keeps answering until the
new one passes its checks. Test only after that, or you will be testing the old copy.

## 2. Copy the plain settings from Vercel

These are not secret. They are plain environment variables on the AWS service,
not in Secrets Manager. Each has a default, so the site runs without them, but
with these defaults:

| Setting | Without it on AWS |
|---|---|
| `PLAN_GATES`, `FREE_DAILY_VIEWS` | **no paywall**: everything is open to everyone |
| `PADDLE_PRICE_PRO_MONTH`, `PADDLE_PRICE_PRO_YEAR`, `PADDLE_PRICE_TEAM_MONTH`, `PADDLE_PRICE_TEAM_YEAR` | checkout has nothing to sell |
| `PADDLE_ENV` | `sandbox` (test payments only) |
| `BRIEF_MODEL`, `BRIEF_DAILY_LIMIT`, `BRIEF_TRIAL_DAILY_LIMIT` | Opus, 50, 10 |

Copy them from Vercel → Project → Settings → Environment Variables
(Production). Then either:

- open Claude Code in this repo and give it the values ("add these plain
  settings to the AWS service"). The setup user can update the service and will
  keep `TRUSTED_PROXY_HOPS=1` and the secrets; or
- run `aws ecs update-express-gateway-service` yourself with the full container
  settings (AWS.md, "Plain settings on the service").

If Vercel has `NEXT_PUBLIC_CONTACT_EMAIL`, also add it as a GitHub repository
**variable** (Settings → Secrets and variables → Actions → Variables) and run
Actions → Deploy to AWS → Run workflow. It is baked in at build time. Leave
`NEXT_PUBLIC_ASSET_BASE` unset.

## 3. Finish the images (from 3 Nov)

1. **Switch uploads to S3** on the crawler VPS and on your PC (`platform/.env`):

   ```
   S3_ENDPOINT=https://s3.eu-west-1.amazonaws.com
   S3_REGION=eu-west-1
   S3_BUCKET=sectionary-blocks-eu
   S3_ACCESS_KEY_ID=<the sectionary-blocks-writer key>
   S3_SECRET_ACCESS_KEY=<its secret>
   S3_PUBLIC_BASE_URL=https://d1jstas0718wp8.cloudfront.net
   ```

   Remove `S3_ACL` completely, or leave it empty. The bucket has ACLs off, so
   any ACL makes every upload fail. The key is IAM user `sectionary-blocks-writer`.
2. **Test**: run `ops/hello-capture.ts`. The image should land in S3 and open
   from the CloudFront address.
3. **Final copy**: anything captured to Spaces since 3 Nov still has to be
   copied. Run the rclone copy with your Spaces key (AWS.md → Images, first
   block). It copies only what is missing.
4. **Fix the addresses**: in the Supabase SQL editor run **Part 1** of
   [ops/aws/move-images.sql](../ops/aws/move-images.sql). If it lists any rows,
   run **Part 2** (select all of it, one Run), then Part 1 again. No rows = done.

## 4. Test on the AWS address

- [ ] The wall loads, scrolls, searches and filters; images come from CloudFront.
- [ ] A site page and a flow open.
- [ ] Sign in by email link and by the 6-digit code.
- [ ] Two-step: turn it on, sign out, sign in with the app code, then with a recovery code.
- [ ] Save a block to a board, share the board, open the share link signed out.
- [ ] Copy as brief finishes on a tall block (needs step 1).
- [ ] With the step 2 settings in: a Free account meets the paywall; a sandbox
      purchase (card `4242 4242 4242 4242`, any future date, CVC `100`) turns
      the account Pro within seconds.

Paddle webhooks still go to Vercel during testing. That is fine: both sites
write to the same database.

## 5. Before the switch

1. **Two-step check.** Anyone who turns on two-step on Vercel from now on is
   using Vercel's key, which AWS does not have. Run this in the Supabase SQL editor:

   ```sql
   select email, totp_enabled_at from users where totp_secret is not null or totp_pending_secret is not null;
   ```

   Accounts that turned it on during AWS testing are fine. For any other
   account: tell them to set two-step up again after the switch, or put
   Vercel's `AUTH_ENCRYPTION_KEY` into AWS instead. In that case, the testers
   set theirs up again.
2. Steps 1 to 3 are done and the step 4 list passes.

## 6. The switch

1. **Supabase** → Authentication → URL Configuration → **Site URL** → the AWS
   address (or the real domain, if it exists by then).
2. **Paddle** → Developer tools → Notifications → edit the existing destination
   → URL `https://<AWS address>/api/paddle/webhook`. In Checkout settings, set
   the default payment link to `https://<AWS address>/account`. Paddle
   approved the website on the Vercel address; check whether it needs to
   review the new one.
3. Tell the team and Leka the new address.
4. Watch the logs (CloudWatch → `/ecs/sectionary-web`) and `paddle_events` for a day.

To go back: undo 1 and 2. Vercel is still running.

## 7. A week after the switch

- Delete the Vercel project.
- Delete the Spaces bucket `sectionary-blocks` and its keys (DigitalOcean).
- Code cleanup: `web/vercel.json`, the Vercel notes in `web/src/server/db.ts`
  and the docs (Claude Code can do this).

## Later (not blocking)

- **Real domain and CloudFront in front of the app.** This makes the wall's
  first load fast again: Vercel cached it, the AWS load balancer does not, so
  each visit asks the database (about 2 s). After it, set `NEXT_PUBLIC_SITE_URL`
  (GitHub variable), the Supabase Site URL and redirect URLs, Paddle, and
  `TRUSTED_PROXY_HOPS=2`.
- **Own email sender (SMTP) in Supabase.** Sign-in emails still use Supabase's
  built-in sender, which allows only a few emails an hour.
