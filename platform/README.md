# Platform (Lane B)

Turns capture manifests into a database, tags, search and the API the web app
calls. This folder is yours: structure it the way you work best. What the
other lanes depend on is only the contract in `web/src/contracts/`.

## What comes in, what goes out

- **In:** `manifest.json` files and block images from Lane A. The shape is
  `web/src/contracts/manifest.ts`; real examples are in `fixtures/manifests/`.
  You never need to run the crawler.
- **Out:** `GET /api/blocks`, `/api/stores`, `/api/sites/[host]` returning the
  shapes in `web/src/contracts/api.ts`. Examples of the responses the web app
  expects are in `fixtures/api/`. Route handlers live in
  `web/src/app/api/` and shared server code in `web/src/server/`, both yours.

## Suggested first week (M1)

1. Supabase project for Sectionary, separate from Next Level (SEC-34, with
   Ben for the account). Drizzle, same as Next Level.
2. Schema v1 (SEC-10): `sites`, `pages`, `captures` (one row per crawl of a
   page, so history is free), `blocks`, `site_tech`, `taxonomy`. A `vector`
   column on `blocks` for later. Indexes for every filter in `BlocksQuery`.
3. Importer (SEC-11): reads a folder of manifests, upserts idempotently on
   `host + page.url + capturedAt`. Importing the same run twice changes
   nothing; a newer capture becomes a new version.
4. Load `fixtures/manifests/`, then Ben's 50-store pilot.

## Later

- AI tagger (SEC-12): Claude through the Batch API, structured JSON per block,
  a 200-block hand-checked evaluation set before the big run. The block
  taxonomy v1 is in `docs/PLAN.md` section 8.
- Search (SEC-17): Postgres full-text plus pgvector.
- Auth (SEC-27), Paddle billing (SEC-28), MCP server (SEC-31).

## Rules that involve you

- You are the only writer of database migrations. Number them; never edit one
  after it merges.
- Secrets live in `platform/.env` (git-ignored). `platform/.env.example` lists
  the keys without values.
- Need a new field in the manifest or an API change? Propose it in the board
  task "Contracts v1", then a `contract` PR. See `docs/CONTRACTS.md`.
