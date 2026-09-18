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
  desktop.jpg            full page at 1440px
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
  hint, headline, first 400 characters of text, counts of buttons, images and
  videos, and the background colour.

The importer should treat `host + page.url + capturedAt` as the identity of a
capture, and keep every capture: history is a feature.

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
HTTP status. `facets` on `/api/blocks` is optional and can arrive later.
