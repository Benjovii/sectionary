# SEC-20 Flow view: design

Date: 2026-09-24. Lane C (web). Approved by Leke in chat.

**Task:** Horizontal strip of full pages: home, collection, product, cart,
checkout, with block markers. Stacked on mobile.
**Done when:** 200 stores have complete flows in the app.

## What "complete" means

The crawler's public policy (docs/bot-page.md) never captures checkout, and
Shopify's default robots.txt keeps it out of `/cart` too. So:

- A flow has five steps, always in this order: Home, Collection, Product,
  Cart, Checkout.
- **Complete = Home, Collection and Product are all captured.** Cart shows
  when it was captured. Checkout is always a labelled gap: "Not captured: we
  never capture checkout."
- Real captures only. Mock blocks (NEXT_PUBLIC_MOCK_BLOCKS) never count,
  same rule as the Sites pages.
- A page counts when it has something to show: blocks, or a full-page
  screenshot (API source).
- Two collections or two products: the step shows the first by URL and
  offers "1 of 2" to switch.

## Units

| Unit | Responsibility |
| --- | --- |
| `web/src/lib/flows.ts` | Pure. `flowOf(pages)` turns a store's pages into five steps; `flowSummaries(index)` does it for every captured store in one pass; `flowCounts`. |
| `web/src/lib/site-profile.ts` | Gains two exports reused by flows: `pagesFromBlocks(blocks)` and `storeFromBlocks(host, blocks)`. No behaviour change. |
| `web/scripts/flow-check.mts` | Case table for flows.ts plus the real sample. `npm run flow-check`. |
| `web/src/components/flow-view.tsx` | The flow page for one store. |
| `web/src/components/flows-index.tsx` | Every captured store's flow status, with the count. |
| `web/src/app/sites/[host]/flow/page.tsx` | Route for the flow page. |
| `web/src/app/flows/page.tsx` | Route for the index. `/pages` redirects here. |

## Flow page, `/sites/<host>/flow`

- Header: back to the store's profile, "<Brand> flow", "3 of 5 steps
  captured", and a Desktop/Mobile switch (Mobile by default under 900px).
- 900px and up: an `<ol>` strip that scrolls sideways, one 340px column per
  step. Each column: "1 Home" heading, the page's path, "1 of 2" switch when
  needed, then the page in its own vertical scroller filling the viewport.
- Under 900px: steps stacked. Each shows about one and a half screens of the
  page with a fade and a "Show whole page" button.
- Gaps: a dashed box in place of the page saying why ("Not captured for this
  store" or "Not captured: we never capture checkout").
- Block markers: each block of the page is a link to its detail view
  (`/?open=<id>`), with a small numbered badge "3 · Reviews" at its top-left
  and a hairline between blocks. A "Markers" switch hides the badges. With
  the API source the page is one screenshot and has no markers.
- If the chosen viewport has no blocks for a page but the other does, show
  the other and say so.

## Flows index, `/flows` (nav "Flows", was the "Pages" placeholder)

- Heading count: "N stores with a complete flow · M with cart". This is the
  number the Done when is measured by.
- One row per complete store: icon, brand, host, five step marks (captured,
  gap), and small thumbnails of the captured steps. The row links to the flow.
- "Show incomplete" switch lists the rest too, naming the missing steps.
- Complete first, then most steps, then traffic rank, then name.

## Site profile

"View flow" button beside "See all blocks" whenever any flow step is captured.

## Accessibility and mobile

Same bar as SEC-22: 44px targets under `touch:`, orange focus rings, the
viewport and markers switches as radiogroup/pressed buttons, every block link
named ("3, Reviews block. Open its detail"), headings per step. Lighthouse
accessibility 100 on the flow page and the index, both themes.

## Out of scope

Capturing more stores (Lane A). Checkout capture (policy). Block positions
for API full-page screenshots (contract change, Lane B).

## Source of the count

The index counts from the block set. With NEXT_PUBLIC_SITES_SRC on, a store's
flow page reads the API's full-page screenshots instead, so the two agree only
as far as the API and the block export do. A flows summary endpoint (Lane B)
would let both read one source.

## Risk

The count reaches 200 only when the capture run's data is in the app, through
the API or a fresh sample export. The UI and the count are ready for it; the
number itself is Lane A's run plus Lane B's load.
