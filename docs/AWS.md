# Hosting on AWS (ECS Express Mode)

The web app moves from Vercel to Amazon ECS Express Mode in eu-west-1
(Ireland), next to the Supabase project. Supabase stays: the database and
sign-in do not move. Images moved from DigitalOcean Spaces to S3 behind
CloudFront (Images, below); browsers load them from there, not through the app.

App Runner was the first plan, but AWS takes no new App Runner customers since
30 April 2026, so this account could not use it. Express Mode is the AWS
replacement: one call makes the service, its load balancer, HTTPS address,
security groups and auto scaling.

How it fits together:

```
push to main ──► GitHub Actions (.github/workflows/deploy-aws.yml)
                   builds web/Dockerfile, pushes to ECR as :latest and :<commit>,
                   then update-service --force-new-deployment
                                   │
                                   ▼
                 ECS service sectionary-web (cluster sectionary)
                 https://se-6cd7c961d8014e758b83164a633faec5.ecs.eu-west-1.on.aws
```

Vercel keeps deploying `main` until the switch, so both run side by side and
nothing changes for users while AWS is tested.

## What exists (account 944851228389, eu-west-1)

| Thing | Name | Notes |
|---|---|---|
| ECR repository | `sectionary-web` | scan on push, keep the last 20 images |
| GitHub deploy role | `sectionary-github-deploy` | OIDC, `main` of Benjovii/sectionary only. Inline policies: push to `sectionary-web` in ECR; `deploy-sectionary-web` ([ops/aws/deploy-sectionary-web-policy.json](../ops/aws/deploy-sectionary-web-policy.json)), `ecs:UpdateService`/`DescribeServices` on this one service |
| Secret | `sectionary/web` | the 9 server secrets, below |
| Task execution role | `sectionary-web-execution` | trusts `ecs-tasks`; `AmazonECSTaskExecutionRolePolicy` plus `secretsmanager:GetSecretValue` on `sectionary/web` only |
| Infrastructure role | `sectionary-web-infrastructure` | trusts `ecs`; `AmazonECSInfrastructureRoleforExpressGatewayServices` |
| Cluster | `sectionary` | |
| Log group | `/ecs/sectionary-web` | 30 days |
| Service | `sectionary-web` | Express Mode, 1 vCPU / 2 GB, port 8080, health check `/api/health`, 1 to 3 tasks at 60% CPU, default VPC |

The setup user `claude-mcp-user` has `sectionary-setup` (inline) and
`sectionary-ecs-setup` (managed, because a user's inline policies share a
2,048-character limit): [ops/aws/](../ops/aws/). It cannot read secret values
or create roles, by design.

### Secrets (Secrets Manager `sectionary/web`)

Keys, values copied from Vercel by whoever has access (never through chat or a
file in the repo): `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`,
`AUTH_ENCRYPTION_KEY` (**the same value as Vercel**, or every authenticator
stops working), `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`, `PADDLE_API_KEY`,
`PADDLE_CLIENT_TOKEN`, `PADDLE_WEBHOOK_SECRET`.

The service reads each one as `arn:...:secret:sectionary/web-0CD2aY:<KEY>::`.
Tasks read secrets only when they start: after changing a value, roll out
again (below).

`DATABASE_URL`: Supabase's pooler address. The app turns TLS on by itself;
`sslmode=require` at the end does no harm. Use the `sectionary_app` user once
it has a password (OPS.md, Security).

### Plain settings on the service

Now: `TRUSTED_PROXY_HOPS=1`. Still to add from Vercel (each has a default, so
the site runs without them, but **must be set before the switch**):

| Setting | Without it |
|---|---|
| `PLAN_GATES`, `FREE_DAILY_VIEWS` | no paywall, everything open |
| `PADDLE_PRICE_PRO_MONTH`/`_YEAR`, `PADDLE_PRICE_TEAM_MONTH`/`_YEAR` | checkout cannot sell anything |
| `PADDLE_ENV` | `sandbox` |
| `BRIEF_MODEL`, `BRIEF_DAILY_LIMIT`, `BRIEF_TRIAL_DAILY_LIMIT` | Opus, 50, 10 |

To add them, write the full container settings (include `TRUSTED_PROXY_HOPS`
and the secrets again, so nothing is lost) and run
`aws ecs update-express-gateway-service --cli-input-json file://...`.

### GitHub repository variables

Settings → Secrets and variables → Actions → **Variables** (none is secret;
they end up in the browser's code and are baked in at build time, so a change
needs a new build: Actions → Deploy to AWS → Run workflow).

| Variable | Value |
|---|---|
| `AWS_DEPLOY_ROLE_ARN` | the deploy role. Setting it switches the workflow on |
| `AWS_REGION`, `ECR_REPOSITORY` | `eu-west-1`, `sectionary-web` |
| `NEXT_PUBLIC_SITE_URL` | the service address above (later the real domain) |
| `NEXT_PUBLIC_BLOCKS_SRC` / `_STORES_SRC` / `_SITES_SRC` | `/api/blocks`, `/api/stores`, `/api/sites` |
| `NEXT_PUBLIC_CONTACT_EMAIL` | optional, as on Vercel |
| `NEXT_PUBLIC_ASSET_BASE` | leave unset: the database holds full CloudFront addresses |

### Day to day

- **Deploy**: merge to `main`. To roll out again without a new build (after a
  secret change, say):
  `aws ecs update-service --cluster sectionary --service sectionary-web --force-new-deployment`.
- **Status**: `aws ecs describe-services --cluster sectionary --services sectionary-web`
  (`runningCount`, `deployments`, `events`).
- **Logs**: CloudWatch → `/ecs/sectionary-web`, or
  `aws logs tail /ecs/sectionary-web --follow`.
- **Roll back**: point the service at an older `:<commit>` image with
  `update-express-gateway-service`.

### Supabase

Authentication → URL Configuration → **Redirect URLs**: add
`https://se-6cd7c961d8014e758b83164a633faec5.ecs.eu-west-1.on.aws/**`. Leave
the Site URL on Vercel until the switch.

## Testing on the AWS address

Vercel still serves users while this runs.

- [ ] The wall loads, scrolls, searches and filters; images come from CloudFront.
- [ ] A site page and a flow open.
- [ ] Sign in by email link and by code; turn two-step on, sign out, sign in with it.
- [ ] Save a block to a board; share the board; open the share link signed out.
- [ ] Copy as brief finishes for a tall block (the load balancer's idle timeout
      is 60 seconds by default; the brief streams, so it should not hit it).
- [ ] `curl -I <address>` shows the security headers.
- [ ] `/ecs/sectionary-web` logs: no errors.

Paddle webhooks still go to Vercel while testing, which is fine: both write the
same database.

## The switch

1. The plain settings above are on the service.
2. Supabase → **Site URL** → the AWS address (or the real domain).
3. Paddle → Notifications → the destination URL → `https://<address>/api/paddle/webhook`;
   Checkout settings → Default payment link → `https://<address>/account`.
   (Paddle approved the website on the old address; check whether it needs to
   see the new one.)
4. Tell the team and Leka the new address.
5. Keep Vercel running for a week. To go back, undo 2 and 3.
6. Then remove the Vercel project, `web/vercel.json`, and the Vercel notes in
   `web/src/server/db.ts` and the docs.

## Images (S3 + CloudFront)

From DigitalOcean Spaces (`sectionary-blocks`, FRA1) to AWS, 3 Nov 2026:

- **Bucket** `sectionary-blocks-eu`, eu-west-1: ACLs off, all public access blocked.
- **CloudFront** `sectionary-blocks` (`E2GU7OCV7AC7N4`),
  `https://d1jstas0718wp8.cloudfront.net`, Free plan: origin access control
  (CloudFront wrote the bucket policy), CachingOptimized, HTTPS only, response
  headers policy CORS-With-Preflight, WAF in monitor mode. Watch the plan's
  usage; move to Pro when traffic needs it (the address stays).
- **Copy**: rclone in CloudShell (eu-west-1), Spaces to S3 directly; `-M` keeps
  content type and cache headers. Running it again copies only what is missing.
  ```bash
  curl -s https://rclone.org/install.sh | sudo bash
  export RCLONE_CONFIG_DO_TYPE=s3 RCLONE_CONFIG_DO_PROVIDER=DigitalOcean RCLONE_CONFIG_DO_ENDPOINT=fra1.digitaloceanspaces.com
  read -p "Spaces key: " RCLONE_CONFIG_DO_ACCESS_KEY_ID; export RCLONE_CONFIG_DO_ACCESS_KEY_ID
  read -sp "Spaces secret: " RCLONE_CONFIG_DO_SECRET_ACCESS_KEY; export RCLONE_CONFIG_DO_SECRET_ACCESS_KEY; echo
  export RCLONE_CONFIG_AWS_TYPE=s3 RCLONE_CONFIG_AWS_PROVIDER=AWS RCLONE_CONFIG_AWS_ENV_AUTH=true RCLONE_CONFIG_AWS_REGION=eu-west-1
  export RCLONE_CONFIG_AWS_NO_CHECK_BUCKET=true RCLONE_CONFIG_AWS_LOCATION_CONSTRAINT=eu-west-1
  rclone copy do:sectionary-blocks aws:sectionary-blocks-eu -M --transfers 32 --checksum -P
  ```
  Without a Spaces key (how it was done on 3 Nov: 153,760 files, 12.5 GiB,
  6½ minutes): the files are public to read, so take the list from the
  database with [ops/aws/image-keys.sql](../ops/aws/image-keys.sql) (export
  as CSV, upload to CloudShell) and fetch each one by its address. Without
  `NO_CHECK_BUCKET`, rclone tries to create the bucket and every upload fails
  with `IllegalLocationConstraintException`.
  ```bash
  tail -n +2 keys.csv | tr -d '"\r' > keys.txt
  export RCLONE_CONFIG_AWS_TYPE=s3 RCLONE_CONFIG_AWS_PROVIDER=AWS RCLONE_CONFIG_AWS_ENV_AUTH=true RCLONE_CONFIG_AWS_REGION=eu-west-1
  export RCLONE_CONFIG_AWS_NO_CHECK_BUCKET=true RCLONE_CONFIG_AWS_LOCATION_CONSTRAINT=eu-west-1
  rclone copy --http-url https://sectionary-blocks.fra1.cdn.digitaloceanspaces.com :http: aws:sectionary-blocks-eu \
    --files-from keys.txt --no-traverse --transfers 64 --checkers 64 -P \
    --header-upload "Cache-Control: public, max-age=86400" --log-file copy.log --log-level NOTICE
  ```
- **Database**: the importer stores full image addresses, so
  [ops/aws/move-images.sql](../ops/aws/move-images.sql) rewrites them (dry run,
  rewrite in one transaction, check). Safe to run again after a late copy.
- **Uploads**: IAM user `sectionary-blocks-writer` (list, get, put on the bucket
  only). On the crawler VPS and Ben's PC: `S3_ENDPOINT=https://s3.eu-west-1.amazonaws.com`,
  `S3_REGION=eu-west-1`, `S3_BUCKET=sectionary-blocks-eu`, the new key,
  `S3_PUBLIC_BASE_URL=https://d1jstas0718wp8.cloudfront.net`, and **no
  `S3_ACL`** (ACLs are off; any ACL fails the upload). Test with `ops/hello-capture.ts`.
- **Custom domain later**: add it to the distribution, then run the SQL again
  with the cloudfront.net address as the old one.
- **Spaces**: delete the bucket and its keys a week after the switch.


## Later

- **A CDN and a real domain.** Vercel's CDN served the wall's first page from
  cache (`PUBLIC_CACHE` in `web/src/server/db.ts`); the load balancer has none,
  so each visit asks the database (about two seconds). CloudFront in front of
  the service brings that back, and the custom domain with it. With
  CloudFront, set `TRUSTED_PROXY_HOPS=2`.
