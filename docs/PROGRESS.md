# Progress

The session log (SEC-35). One entry per working session, newest first: what
moved, what is waiting and on whom, and anything the next person needs to know.
PLAN.md changes only when scope does; the board mirrors every work item.

Earlier sessions are in Ben's vault copy (To Do's/New APP Mobbin Recreate).
This file starts on 2026-10-01 so every lane can append to it.

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
