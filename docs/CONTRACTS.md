# Contracts

The three shapes that cross lanes. Everything else is private to a lane and
can change freely. The types live in `web/src/contracts/`; this page explains
them and the rules for changing them.

| Contract | File | Written by | Read by | Sample |
|---|---|---|---|---|
| Capture manifest | `manifest.ts` | Lane A, one `manifest.json` per captured page | Lane B importer | `fixtures/manifests/` |
| Items | `block.ts`, `store.ts` | Lane B API (sample JSON today) | Lane C screens | `web/public/sample/*.json` |
| HTTP API | `api.ts` | Lane B | Lane C | `fixtures/api/*.json` |

## Rules

1. **Propose before you change.** Say what you need in the board task
   "Contracts v1", then open a PR that touches only `web/src/contracts/`,
   `docs/CONTRACTS.md` and the fixtures. Label it `contract`. All three lanes
   review it.
2. **Inside a milestone, contracts only grow.** Adding an optional field is
   fine. Renaming, removing, or changing the meaning of a field waits for a
   milestone boundary and bumps `CONTRACT_VERSION` in `api.ts`.
3. **Fixtures move with the contract.** A contract PR updates the fixtures in
   the same commit, so the other lanes can adapt against real examples.
4. **The compiler guards the manifest.** `src/contract-check.ts` fails
   `npm run typecheck` if the crawler's output stops matching `manifest.ts`.
   Change the contract first, then the crawler.
5. **Contract files are pure types.** No imports from Next.js, Node or any
   library, and `manifest.ts` has no imports at all, because the crawler
   type-checks it under a stricter module resolution.

## The capture manifest

Lane A writes `data/<host>/<page-slug>/manifest.json` next to the images:

```
data/myzoobox.com/home/
  manifest.json
  desktop.jpg            full page at 1440px, 2x (2880 pixels wide)
  mobile.jpg             full page at 390px, 2x
  blocks/d-02-hero.jpg   d = desktop, m = mobile; index; type hint
```

- `site`: host, origin, detected platform, theme (`name`, `schema_name`,
  `schema_version` on Shopify), page builder, apps, currency, locale.
- `page`: url, `type` (home, collection, product, cart, article, page, other),
  slug, `capturedAt` (ISO), title, description, canonical, og image, h1.
- `viewports.desktop` / `.mobile`: either the full-page file with its height
  and the segmentation strategy used, or an `error`.
- `blocks[]`: one entry per block per viewport, with `file` relative to the
  manifest's folder (null if that screenshot failed), position, size, type
  hint, headline, first 2,000 characters of text (the API serves the first 400), counts of buttons, images and
  videos, and the background colour.

The importer should treat `host + page.url + capturedAt` as the identity of a
capture, and keep every capture: history is a feature.

Two things real stores do, both visible in the fixtures:

- `site.host` is the store's identity and the folder name. `site.origin` and
  `page.url` can sit on another host, because stores redirect to `www.` or to
  a regional address (`stance.eu.com` serves its pages from `de.stance.com`).
  Group by `site.host`, never by the URL's host.
- Only pages worth importing have a manifest. Bot walls, geo-blocks, empty
  pages and password pages fail in the crawler and leave no manifest behind,
  so the importer needs no junk filter. A home page folder may also hold a
  `links.json` (the crawler's own notes); ignore it.

### Fixtures for the importer

`fixtures/manifests/` holds real manifests from the 50-store pilot, chosen by
`scripts/make-fixtures.mjs`: the four My ZOO Box pages that have been there
from the start (tests may name them), one store per platform (three for
Shopify, for theme variety) with its home, a product and a collection page,
and real examples of each awkward case. `fixtures/manifests/index.json` lists
every fixture with its platform, page type and what it shows
(`edge:redirected-host`, `edge:region-in-path`, `edge:platform-unknown`,
`edge:no-theme-info`, `edge:block-without-image`, `edge:viewport-failed`).
An importer that loads every entry of that index without special cases passes
the M1 exit test. Images are not part of the fixtures.

When images move to object storage (SEC-9) the key layout will be
`sites/<host>/<capturedAt>/<viewport>/<nn>-<type>.webp` and the manifest gains
an optional `assetBase`. That is an additive change.

## Items

`Block` and `Store` are what the web app renders. Today they come from
`web/public/sample/blocks.json` and `stores.json`; from M2 they come from the
API. The shapes are identical on purpose, so switching is two environment
variables (`web/src/lib/data-source.ts`).

`Block.src` may be a path or an absolute URL. The web app resolves paths
against its asset base. `Block.w` and `Block.h` are CSS pixels and must be
present: the wall reserves the block's aspect ratio before the image loads.

## HTTP API v1

- `GET /api/blocks` with `BlocksQuery` returns `BlocksResponse`.
- `GET /api/stores` with `StoresQuery` returns `StoresResponse`.
- `GET /api/sites/[host]` returns `SiteProfile`.

Cursor pagination everywhere (`Page<T>`): an opaque `cursor` in, `nextCursor`
or null out, plus `total`. Multi-value filters are comma-separated
(`platform=shopify,woocommerce`). Errors are `{ error, code? }` with a fitting
HTTP status. `facets` on `/api/blocks` carries `platform`, `theme` and `app`
counts; each facet is counted under every other active filter, so choosing an
app still shows what the other apps would give.

## Boards, time machine and briefs (additive, M3)

All additive: no existing field changed, `CONTRACT_VERSION` stays 1. Shapes in
`api.ts`, real responses in `fixtures/api/`.

| Endpoint | In | Out | Fixture |
|---|---|---|---|
| `POST /api/boards` | `BoardCreate` | `BoardCreated` (201) | `board.created.json` |
| `GET /api/boards/[id]` | `x-board-token` | `Board` | `board.json` |
| `PATCH /api/boards/[id]` | `x-board-token`, `BoardPatch` | `Board` | |
| `DELETE /api/boards/[id]` | `x-board-token` | 204 | |
| `POST /api/boards/[id]/items` | `x-board-token`, `BoardItemAdd` | `Board` | |
| `PATCH /api/boards/[id]/items/[blockId]` | `x-board-token`, `{ note }` | `Board` | |
| `DELETE /api/boards/[id]/items/[blockId]` | `x-board-token` | `Board` | |
| `GET /api/share/[slug]` | | `SharedBoard`, or 404 while sharing is off | `share.json` |
| `GET /api/blocks/[id]/history` | | `BlockHistory` | `block.history.json` |
| `POST /api/brief` | `BriefRequest` | streamed `text/plain` (Markdown) | |

- **Boards before accounts.** Until auth (SEC-27) a board belongs to whoever
  holds its edit token. `POST /api/boards` returns it once; the web app keeps
  it in the browser and sends it as `x-board-token`. Only its SHA-256 is
  stored. A wrong or missing token is 403. When accounts arrive, a signed-in
  user claims a board by presenting its token.
- **Share links.** `shareSlug` exists from creation; `/b/<slug>` and
  `/api/share/<slug>` serve the board only while `shared` is true. Turning
  sharing off and on again keeps the same link. `SharedBoard` has no ids and no
  tokens.
- **Reordering** sends the full list of block ids: `PATCH { order: [...] }`.
- **Time machine.** Every capture of the block's page, newest first. `block`
  is the best match in that capture (same viewport and type, nearest index
  and position), null when the page had no such block. `fullPage` is derived
  from the capture's block keys; it is only as right as the image key layout
  (see the note on keys below). The history fixture comes from a test database
  with a seeded older capture, so its dates and changes are made up.
- **Briefs.** `target` is `claude-code`, `cursor` or `designer`. The server
  looks the block up itself (database, or the sample JSON when there is no
  database) and never trusts a block sent by the browser. With
  `ANTHROPIC_API_KEY` set, Claude writes it from the screenshot and metadata;
  without it, `x-brief-source: template` and the brief is assembled from
  metadata alone.

Image keys and history: the importer derives keys from each capture's folder
path, without `capturedAt`. If a recapture is written to the same folder as
the previous one, both captures point at the same image and the time machine
compares identical pictures. The layout in the manifest section below
(`sites/<host>/<capturedAt>/...`) avoids that.
