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
tagger has written one, a block is embedded from its type, headline and copy,
and embedded again automatically once the description lands.

Migration `0007_search_terms_taxonomy.sql` adds block types and tags to the
typo vocabulary, so a tagged "subscription-picker" is found by "picker"
rather than the word being corrected away.

**Acceptance, deterministic.** `npm run search:acceptance` (in `web/`) needs no
credentials: it starts a throwaway Postgres 17 (PGlite, `src/local-db.ts`),
applies every migration, imports `fixtures/manifests` and
`fixtures/search-corpus` with the real importer, and runs the app's own
`searchBlocks()` in three modes: full text only (the gate, and the fallback),
Voyage configured but failing (must give the same ranking), and full text fused
with semantic neighbours from a local stand-in for Voyage (proves the fusion
path, not Voyage's quality). Queries and relevance judges live in
`src/search-queries.ts`, shared with `search:eval`. The latest output is in
`docs/reviews/`.

## Image pipeline (SEC-9)

`npm run image-process -- <capture dir>` in the repo root turns every JPEG a
manifest names into WebP, a 600px thumbnail (the top 1,200px of a tall image)
and a blurhash, and uploads them with the root `.env`'s `S3_*` settings.
WebP cannot hold more than 16,383px, so a taller full-page screenshot is cut
into slices of `IMAGE_SLICE_HEIGHT` (default 8,192) instead of failing:
`desktop_s000.webp`, `desktop_s001.webp`, … top to bottom. Each page gets an
`images.json` next to its manifest (also uploaded) listing every image, its
slices and their offsets. The importer reads it: viewport screenshots carry
`image.slices` inside `captures.desktop` / `.mobile`, and a sliced block image
fills `blocks.image_slices` (migration 0005) with `image_key` as its top slice.
Each run writes `_audit-<time>.json` with per-image and per-upload results and
exits 1 if anything failed. Tests: `npm test` in the repo root.

## AI tagger (SEC-12)

```bash
npm run tag-blocks -- run            # submit, wait, collect, report; safe to re-run
npm run tag-blocks -- submit --dry-run   # what would be sent, and its estimated cost
npm run tag-blocks -- report --out report.md
```

Each block's screenshot (read from object storage, fitted to 1,024px) and its
DOM context go to Claude through the Message Batches API with a JSON schema
built from the taxonomy (`src/taxonomy.ts`, docs/PLAN.md section 8):
`block_type`, `page_role`, `style_tags`, `industry`, a one-line description,
`patterns` and `has_price` / `has_reviews` / `has_video`. Answers are
validated again before they are stored on the block (`block_type`, `tags`,
`ai_description`, `ai_response`); anything outside the taxonomy is recorded as
an invalid request and retried by the next run.

- **Model:** Sonnet by default, `TAGGER_MODEL=haiku` for the cheaper run; the
  ids are `TAGGER_SONNET_MODEL` / `TAGGER_HAIKU_MODEL` in `.env`.
- **Cost cap:** `TAGGER_MAX_COST_USD` (default 150). Before submitting, each
  request's cost is estimated on the high side (uncached prompt, at least 300
  output tokens, raised to the observed average once answers come back), and
  submission stops before spent + in flight + new would pass the cap. Actual
  cost is computed from every answer's token usage.
- **Resumable:** migration `0006_tagger.sql` keeps a ledger (`tag_batches`,
  `tag_requests`). Batches are recorded as soon as they are created; a block is
  submitted again only if its inputs, the model or the prompt changed, or its
  last answer failed. Results are stored idempotently.
- **Evaluation:** `eval-create` picks 200 distinct blocks into
  `eval/tagger-eval-set.json`; `eval-sheet` writes an HTML page to label them
  by hand (screenshot, context, the taxonomy as menus); `eval` tags all 200
  under the run label `eval` and fails below 90% `block_type` agreement,
  writing a report to `eval/reports/`. It refuses to score a set that is not
  fully hand-labelled.

`npm test` covers parsing, validation, the cost cap, partial failures and
idempotent storage (against PGlite with every migration applied).

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

- Auth (SEC-27), Paddle billing (SEC-28), MCP server (SEC-31).

## Rules that involve you

- You are the only writer of database migrations. Number them; never edit one
  after it merges.
- Secrets live in `platform/.env` (git-ignored). `platform/.env.example` lists
  the keys without values.
- Need a new field in the manifest or an API change? Propose it in the board
  task "Contracts v1", then a `contract` PR. See `docs/CONTRACTS.md`.
