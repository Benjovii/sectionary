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

## Schema and importer

1. Copy `.env.example` to `.env` and set the Supabase pooler `DATABASE_URL`.
2. Run `npm install` in this directory, then `npm run db:migrate` once.
3. Run `npm run import -- ../fixtures/manifests` (or point it at a capture
   directory). Imports are transactional and idempotent; a new `capturedAt`
   creates history, while replaying the same manifest updates the same rows.
4. Set the same server-only `DATABASE_URL` in `web/.env.local`, plus
   `NEXT_PUBLIC_BLOCKS_SRC=/api/blocks`,
   `NEXT_PUBLIC_STORES_SRC=/api/stores` and
   `NEXT_PUBLIC_SITES_SRC=/api/sites`, to read the imported stores in the app
   (SEC-47: the wall queries `/api/blocks` a page at a time; Sites and Flows
   read the store list from `GET /api/sites`).

`S3_PUBLIC_BASE_URL` controls the prefix stored for screenshots. Without it,
the importer records root-relative keys based on the imported directory.

## Boards, time machine, briefs

Migration `0003_boards_sharing.sql` lets a board exist before accounts: it is
owned by an edit token (only the SHA-256 is stored) and has a public
`share_slug` served while `shared` is true. `org_id`, `created_by` and
`added_by` become optional until auth (SEC-27) fills them in. The routes are
in `web/src/app/api/boards`, `share`, `blocks/[id]/history` and `brief`,
with shared code in `web/src/server/`; the shapes and fixtures are listed in
`docs/CONTRACTS.md`. Set `ANTHROPIC_API_KEY` in the web app's environment for
briefs written by Claude.

## Search (SEC-17)

`GET /api/blocks?q=…` ranks by relevance; without `q` it stays newest first.
Code: `web/src/server/search.ts`. Migration `0004_search.sql` adds:

- `blocks.search_tsv`, a generated tsvector: headline (A), AI description,
  block type and tags (B), copy (C).
- `search_terms`, the corpus vocabulary, for typo tolerance: an unknown query
  word is swapped for its closest word, a known one picks up close forms
  ("subscription" also finds "subscriptions").
- `blocks.embedding vector(1024)` for Voyage, with `embedding_model` and
  `embedding_hash` so only new or changed blocks are embedded again.

Full text ranks by how many query words a block has, then by where they sit.
Semantic search takes the nearest embeddings. Reciprocal rank fusion merges
the two lists. Without `VOYAGE_API_KEY`, or when Voyage is slow, search uses
full text only.

After an import or a tagging run:

```bash
npm run embed            # embeds new/changed blocks, refreshes search_terms
npm run search:eval      # acceptance queries against http://localhost:3000
```

Set `VOYAGE_API_KEY` in `platform/.env` for `embed` and in the web app's
environment for queries. `VOYAGE_MODEL` defaults to `voyage-3.5` and must
match on both sides. Blocks are embedded from their AI description. Until the
tagger writes descriptions (its batch run is still a stub), blocks are
embedded from type, headline and copy. They are embedded again automatically
once a description lands.

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
