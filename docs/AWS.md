# Hosting on AWS (App Runner)

The web app moves from Vercel to AWS App Runner in eu-west-1 (Ireland), next
to the Supabase project. Supabase stays: the database and sign-in do not move.
Images stay in their bucket (`S3_PUBLIC_BASE_URL`); browsers load them from
there, not through the app.

How it fits together:

```
push to main ──► GitHub Actions (.github/workflows/deploy-aws.yml)
                   builds web/Dockerfile, pushes to ECR as :latest
                                   │
                                   ▼
                 App Runner sees the new :latest and deploys it
                 https://<id>.eu-west-1.awsapprunner.com
```

Vercel keeps deploying `main` until the switch, so both run side by side and
nothing changes for users while AWS is tested.

## One-time setup

Everything in **eu-west-1**. No AWS keys go in GitHub or in the repo.

### 1. ECR (where the images live)

ECR → Create repository: `sectionary-web`, private, **Scan on push** on.
Then Lifecycle policy: keep the last 20 images.

### 2. GitHub may push to it (OIDC, no stored keys)

1. IAM → Identity providers → Add provider: OpenID Connect,
   URL `https://token.actions.githubusercontent.com`, audience `sts.amazonaws.com`
   (skip if it already exists).
2. IAM → Roles → Create role → Web identity → that provider, audience
   `sts.amazonaws.com`, GitHub organization `Benjovii`, repository
   `sectionary`, branch `main`. Name it `sectionary-github-deploy`.
3. Give it one inline policy, push to this one repository only:

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       { "Effect": "Allow", "Action": "ecr:GetAuthorizationToken", "Resource": "*" },
       { "Effect": "Allow",
         "Action": ["ecr:BatchCheckLayerAvailability", "ecr:InitiateLayerUpload", "ecr:UploadLayerPart",
                    "ecr:CompleteLayerUpload", "ecr:PutImage", "ecr:BatchGetImage"],
         "Resource": "arn:aws:ecr:eu-west-1:<account-id>:repository/sectionary-web" }
     ]
   }
   ```

### 3. GitHub repository variables

GitHub → the repo → Settings → Secrets and variables → Actions → **Variables**
(not secrets: none of these is secret, they end up in the browser's code).

| Variable | Value |
|---|---|
| `AWS_DEPLOY_ROLE_ARN` | the role from step 2. Setting it switches the workflow on |
| `NEXT_PUBLIC_SITE_URL` | the App Runner address, once step 4 has made it |
| `NEXT_PUBLIC_BLOCKS_SRC` | `/api/blocks` |
| `NEXT_PUBLIC_STORES_SRC` | `/api/stores` |
| `NEXT_PUBLIC_SITES_SRC` | `/api/sites` |
| `NEXT_PUBLIC_CONTACT_EMAIL` | optional, as on Vercel |
| `NEXT_PUBLIC_ASSET_BASE` | only if Vercel has it set |

Then Actions → Deploy to AWS → Run workflow, so the first image exists.

### 4. Secrets Manager (the server's secrets)

Secrets Manager → Store a new secret → Other type → one secret named
`sectionary/web` with these keys, values copied from Vercel by whoever has
access (never through chat or a file in the repo):

`DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `AUTH_ENCRYPTION_KEY`
(**the same value as Vercel**, or every authenticator stops working),
`ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`, `PADDLE_API_KEY`, `PADDLE_CLIENT_TOKEN`,
`PADDLE_WEBHOOK_SECRET`.

`DATABASE_URL`: Supabase's pooler address. The app turns TLS on by itself;
`sslmode=require` at the end does no harm. Use the `sectionary_app` user once
it has a password (OPS.md, Security).

### 5. App Runner service

App Runner → Create service:

- **Source**: Container registry → Amazon ECR → `sectionary-web:latest`.
  Deployment trigger **Automatic**. ECR access role: create new.
- **Service settings**: name `sectionary-web`; 1 vCPU, 2 GB; port **8080**.
- **Environment variables**, plain text: `PADDLE_ENV`, the four
  `PADDLE_PRICE_*`, `PLAN_GATES`, `FREE_DAILY_VIEWS`, `BRIEF_MODEL` and the
  brief limits if Vercel sets them, and `TRUSTED_PROXY_HOPS=1`.
  From Secrets Manager: each key of `sectionary/web` from step 4
  (reference `arn:...:secret:sectionary/web-xxxx:DATABASE_URL::` and so on).
- **Security → Instance role**: a role App Runner may assume, with
  `secretsmanager:GetSecretValue` on `sectionary/web` only.
- **Health check**: HTTP, path `/api/health`.
- **Auto scaling**: 1 to 3 instances to start.

It prints the address (`https://<id>.eu-west-1.awsapprunner.com`). Put it in
`NEXT_PUBLIC_SITE_URL` (step 3) and run the workflow again.

### 6. Supabase

Authentication → URL Configuration → **Redirect URLs**: add
`https://<id>.eu-west-1.awsapprunner.com/**`. Leave the Site URL on Vercel
until the switch.

## Testing on the AWS address

Vercel still serves users while this runs.

- [ ] The wall loads, scrolls, searches and filters.
- [ ] A site page and a flow open.
- [ ] Sign in by email link and by code; turn two-step on, sign out, sign in with it.
- [ ] Save a block to a board; share the board; open the share link signed out.
- [ ] Copy as brief finishes for a tall block. App Runner ends any request at
      120 seconds, the same as the brief's own limit (`maxDuration`); a brief
      cut off there means a lower `max_tokens` or effort in `web/src/app/api/brief/route.ts`.
- [ ] `curl -I https://<id>.eu-west-1.awsapprunner.com` shows the security headers.
- [ ] App Runner → Logs: no errors.

Paddle webhooks still go to Vercel while testing, which is fine: both write the
same database.

## The switch

1. Supabase → **Site URL** → the App Runner address.
2. Paddle → Notifications → the destination URL → `https://<app runner>/api/paddle/webhook`;
   Checkout settings → Default payment link → `https://<app runner>/account`.
   (Paddle approved the website on the old address; check whether it needs to
   see the new one.)
3. Tell the team and Leka the new address.
4. Keep Vercel running for a week. To go back, undo 1 and 2.
5. Then remove the Vercel project, `web/vercel.json`, and the Vercel notes in
   `web/src/server/db.ts` and the docs.

## Later

- **A CDN.** Vercel's CDN served the wall's first page from cache
  (`PUBLIC_CACHE` in `web/src/server/db.ts`); App Runner has none, so each
  visit asks the database (about two seconds). CloudFront in front of App
  Runner brings that back, and a custom domain with it. With CloudFront, set
  `TRUSTED_PROXY_HOPS=2`.
- **App Runner's future.** AWS takes no new App Runner customers since 30
  April 2026 and adds no features. This account had it before, so it works. The
  same image runs on ECS Express Mode if it ever has to move.
