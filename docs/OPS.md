# Infrastructure

The accounts Sectionary runs on, what is done, and the crawler server. Values
(passwords, keys, connection strings) are never written here or in git: they
live in the password manager and in env files outside the repo.

## Status (15 Oct 2026)

| Service | What for | Status |
|---|---|---|
| Supabase | Postgres, auth emails | Done. Own project (not Next Level's), Ireland, Free plan. `DATABASE_URL` in Vercel; functions in Dublin. Free plan holds the waitlist and a first import, not the full capture's vectors (decision with SEC-17). Auth setup: [AUTH-AND-BILLING.md](AUTH-AND-BILLING.md). |
| Object storage | Block images | On AWS since 3 Nov 2026 (images copied, database addresses moved), from DigitalOcean Spaces (`sectionary-blocks`, FRA1) to **AWS S3** `sectionary-blocks-eu` (eu-west-1, private) behind CloudFront `d1jstas0718wp8.cloudfront.net` (Free plan, CORS on). Uploads use the IAM user `sectionary-blocks-writer`. Steps: [AWS.md](AWS.md), Images. Spaces stays up a week after the switch, then goes. |
| Vercel | The web app | Done. |
| Crawler VPS | Playwright away from our PCs | Script ready: `ops/vps-setup.sh`. Server not created yet. |
| Anthropic API key | AI tagger, "copy as brief" | Open. A key in its own Sectionary workspace with a monthly spend limit. |
| Voyage API key | Search embeddings | Open. |
| Paddle | Billing | Sandbox setup in [AUTH-AND-BILLING.md](AUTH-AND-BILLING.md). |

## The crawler VPS

A Hetzner CX22 (2 vCPU, 4 GB, about €5 a month) or a DigitalOcean droplet of
the same size, Ubuntu 24.04, SSH key login.

```bash
ssh root@<server> 'bash -s' < ops/vps-setup.sh
```

The script is safe to run again. It installs Node 24, git, Chromium with its
system libraries, a firewall that lets only SSH in, a `sectionary` user with
the repo in `~/sectionary`, and the settings file **outside the repo**:
`/etc/sectionary/sectionary.env` (mode 600, loaded into the user's login
shells). Fill it in over SSH from the password manager:

```bash
ssh root@<server>
sudo -u sectionary nano /etc/sectionary/sectionary.env
```

### Done when: the hello-world capture

```bash
sudo -iu sectionary bash -c 'cd ~/sectionary && npm run hello-capture'
```

It screenshots https://example.com in Chromium, converts it to WebP, uploads it
to the bucket under `hello/`, reads it back through `S3_PUBLIC_BASE_URL` and
prints `PASS <url>`. A `FAIL` says which setting is missing or what came back
(a 403 usually means the upload was private: `S3_ACL=public-read` for Spaces).
It also runs on a PC with the settings in the repo's `.env`, or any file named
by `SECTIONARY_ENV`.

Only Lane A runs the crawler against third-party stores (CONTRIBUTING.md). The
VPS changes where it runs, not who runs it.

## API keys with caps

- **Anthropic**: console.anthropic.com → a workspace named Sectionary → an API
  key in it → workspace limits: a monthly spend limit (start with $200, the
  first full tagging run is estimated at $300 for 100k blocks on Sonnet, PLAN.md
  section 10, so raise it for that run on purpose). The tagger has its own cost
  cap per run too (`TAGGER_MAX_COST_USD`). Goes in `platform/.env` and, for
  "copy as brief", Vercel's `ANTHROPIC_API_KEY`.
- **Voyage**: dashboard.voyageai.com → API key, with a usage limit in billing.
  Goes in `platform/.env` and Vercel's `VOYAGE_API_KEY` (same `VOYAGE_MODEL` in both).

## Security

What the code cannot do for itself. Do these once, in order, after
`npm run db:migrate` has applied 0011 and 0012.

1. **Supabase Data API off.** Project Settings → Data API: switch it off (or
   remove `public` from Exposed schemas). The app never uses it; migration 0011
   already took away every grant and policy it could use, this closes the door too.
2. **The app's own database role.** Supabase → SQL editor, with a new long
   random password (a password manager's generator, never pasted in chat or a file
   in the repo):

   ```sql
   ALTER ROLE sectionary_app WITH LOGIN PASSWORD '<new password>';
   ```

   Then the web app's `DATABASE_URL` (Vercel, later AWS) becomes the same pooler
   address with the user `sectionary_app.<project-ref>` and that password.
   `platform/.env` keeps `postgres`: migrations and the capture pipeline own
   the tables. Check the site still loads, signs in and saves to a board before
   moving on; to undo, put the old `DATABASE_URL` back.
3. **TLS to the database.** Project Settings → Database → SSL Configuration:
   Enforce SSL on. The app already asks for TLS on any database not on the same machine.
4. **Hosting settings.** `NEXT_PUBLIC_SITE_URL` set to the site's address, and
   `TRUSTED_PROXY_HOPS` if the host has more than one proxy in front of the app
   (`web/.env.example`).
5. **Script policy.** `next.config.ts` sends a report-only
   `Content-Security-Policy` for scripts. Open the site and Paddle checkout with
   the browser console open; once nothing is reported, make it enforced.

The rate limits the app applies itself are listed in AUTH-AND-BILLING.md.
