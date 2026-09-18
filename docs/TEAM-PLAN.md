# Team plan

Three people, three lanes, one product. Written 2026-09-18. The product plan
(what we build and why) is in [PLAN.md](PLAN.md); this document is who does
what, in what order, and how we stay out of each other's way. The live task
list is the private Next Level space **SEC**; this file explains its shape.

## The idea in one paragraph

Sectionary (codename) is a searchable library of real online stores cut into
blocks: hero, featured collection, buy box, reviews, FAQ, cart. Every block is
captured at desktop and phone width and carries the store's platform, theme and
apps. A crawler captures stores, a platform stores and tags what was captured,
a web app lets people browse, filter and save it. Those three parts are the
three lanes.

## The lanes

| | Lane A · Capture | Lane B · Platform | Lane C · Web |
|---|---|---|---|
| Owner | **Ben** (with Claude) | **Buna** | **Leke** |
| Mission | Turn a list of stores into manifests and images | Turn manifests into a database, tags, search and an API | Turn the API into the product people use |
| Owns these folders | `src/` `scripts/` `config/` `seeds/` `viewer/` `fixtures/manifests/` | `platform/` `web/src/app/api/` `web/src/server/` `fixtures/api/` | `web/src/app/` (except `api/`) `web/src/components/` `web/src/lib/` `web/public/` |
| Produces | `manifest.json` per page, block images, `stores.validated.csv` | Postgres schema, importer, AI tags, `/api/*` | Screens, components, design system |
| Consumes | nothing from the others | manifests and images from A | API responses from B (sample JSON until then) |
| Needs | Node, Playwright, patience with rate limits | Postgres/Supabase, Drizzle, Claude API, SQL | Next.js, Tailwind, an eye for detail at 375px |

Buna and Leke can swap lanes if that fits their strengths better. The lanes are
defined by folders and contracts, not by names, so a swap costs nothing as long
as it happens before work starts.

**Shared by all three, changed only by reviewed pull request:**
`web/src/contracts/`, `docs/`, `.github/`, the root `README.md`.

## Why this split does not collide

1. **Folder ownership.** You only edit your lane's folders. A change you need
   in someone else's folder is a request to them (a board task or a small PR
   they review), never a drive-by edit.
2. **Contracts are the only seam.** Three shapes cross lanes and they live in
   one folder, `web/src/contracts/`:
   - the capture manifest (A writes it, B reads it),
   - the `Block` and `Store` items (B serves them, C renders them),
   - the API queries and responses (B implements, C calls).
   [CONTRACTS.md](CONTRACTS.md) has the rules. Inside a milestone, contracts
   only grow (new optional fields). Breaking changes wait for a milestone
   boundary and bump `CONTRACT_VERSION`.
3. **Fixtures make lanes independent.** `fixtures/manifests/` holds real
   manifests so B builds the importer without running the crawler.
   `web/public/sample/*.json` and `fixtures/api/` hold real responses so C
   builds screens without a database. Nobody waits for anybody.
4. **One writer per shared resource.**
   - Database migrations: only Lane B, numbered, never edited after merge.
   - Production deploys: only Ben, until block images live in object storage
     (they are local files on his machine today).
   - The crawler against third-party stores: only Lane A, from one machine.
     Shopify throttles per IP across all its stores; two people crawling from
     the same network break it for both.
   - Each package has its own `package.json` and lockfile (`/`, `web/`,
     `platform/`), so dependency changes do not conflict across lanes.
5. **Small branches, merged often.** See [CONTRIBUTING.md](../CONTRIBUTING.md).
   A branch that lives longer than three days is a merge conflict being saved
   up.

## Milestones

Dates are Fridays. Each milestone ends with a 20-minute demo on real data and
a merge window. If a lane is late, the others keep going on fixtures.

### M0 · Fri 18 Sep 2026 · Ready to split (done)

Repo on GitHub, contracts v1, fixtures, CI, this plan, the board split by lane.
Already built before the split: polite crawler rules, seed harvester, store
validator (1,005 validated stores), the web scaffold with the browse wall and
the Sites page, deployed at https://sectionary-pink.vercel.app.

### M1 · Fri 25 Sep · Each lane stands on its own

- **A:** crawl queue and worker with resume (SEC-7); pilot capture of 50
  stores; refreshed fixtures from the pilot; image pipeline decided (SEC-9).
- **B:** Supabase project and env (SEC-34 with Ben); schema v1 (SEC-10);
  importer loads the fixtures and then the pilot (SEC-11).
- **C:** virtualised wall with infinite scroll on a 30,000-block mock
  (SEC-15); URL-synced multi-select filters (SEC-16); loading states (SEC-21).

Exit test: B can import A's pilot without asking A anything. C's wall scrolls
30,000 blocks smoothly on a phone.

### M2 · Fri 9 Oct · Real data end to end

- **A:** full capture of the 1,005 stores (about 6,000 pages, 60,000 blocks);
  WebP, thumbnails and blur placeholders in object storage (SEC-9).
- **B:** importer on the full capture; AI tagger v1 with a 200-block
  evaluation set (SEC-12); API v1: `/api/blocks`, `/api/stores`,
  `/api/sites/[host]` returning the contract shapes.
- **C:** block detail view (SEC-18); site profiles (SEC-19); the app switched
  from sample JSON to the API on a staging environment.

Exit test: pick any captured store and find its hero block through the filters
on the staging site, on a phone.

### M3 · Fri 23 Oct · The product takes shape

- **A:** segmentation v2 for non-Shopify sites (SEC-8); tech-stack detection
  v2 (SEC-13); weekly recapture of the top 200 (SEC-26).
- **B:** search, full-text plus vectors (SEC-17); boards tables and API;
  endpoints for "copy as brief" and capture history.
- **C:** search UI; flow view (SEC-20); boards UI (SEC-23); the unique
  features in the detail view (SEC-24); mobile and accessibility pass (SEC-22).

Exit test: the three of us use it for a real client reference hunt and it
beats Pinterest and Google Images.

### M4 · Fri 13 Nov · Private beta

- **B:** auth with magic links (SEC-27); plans and Paddle billing (SEC-28);
  MCP server (SEC-31).
- **C:** landing page and waitlist (SEC-25); account screens; legal pages
  (SEC-29, pages only).
- **Ben:** final name and domain (SEC-33); legal consult (SEC-30); takedown
  process (SEC-29, process and block list); launch plan (SEC-32).

### M5 · early December · Launch

Public launch once the beta has ten agencies using it weekly.

## How we work together

- **Board first.** Every piece of work is a task in the SEC space before it
  starts. Claim it while you work, complete it when the PR merges. Tasks carry
  a lane tag (Lane A, Lane B, Lane C) and a phase tag.
- **Monday, 15 minutes:** what each lane ships this week, what it needs from
  the others. Needs become board tasks assigned to the other lane.
- **Friday:** merge window, then the demo.
- **Contract changes** are announced in the board task "Contracts v1" before
  the PR opens, so nobody is surprised.
- **Questions about another lane's code** go to that lane's owner, not to a
  commit.

## What can go wrong

- **A lane gets blocked by another.** The fixtures exist to prevent it. If it
  still happens, the blocked person extends the fixtures themselves and tells
  the owner; they do not wait.
- **The contract turns out wrong.** Expected once or twice. Fix it at a
  milestone boundary, all three in one call, one PR.
- **Skills do not match the lane.** Week one tells us. Swap B and C early
  rather than struggle.
- **Time.** Everyone has client work. The plan assumes roughly a third of each
  person's week. If that is wrong, milestones slide; scope within a milestone
  does not shrink silently, we re-plan it on Monday.
