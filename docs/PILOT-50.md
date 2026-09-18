# The 50-store pilot (SEC-41)

Run on 18 September 2026 from Ben's machine in Kosovo, with the crawl worker
from SEC-7. The point of a pilot is to find trouble before the full run of
1,005 stores does, and it found plenty.

## How the 50 were chosen

`npm run sample-seeds -- --n 50` wrote `seeds/pilot-50.csv`. Shopify is two
thirds of our list and the easy case, so it was capped at half (25). The other
25 were shared out by platform size with at least one each: custom builds 5,
Next.js 5, WooCommerce 4, Magento 3, Salesforce 3, BigCommerce, Nuxt,
Squarespace, Webflow and Wix 1 each. Inside a platform the picks rotate
through our 13 industries, clearest store evidence first, then traffic rank.

## Result

| | |
|---|---|
| Wall-clock time | 54 minutes, three stores side by side, nobody watching, no crash |
| Stores captured | **45 of 50** (43 complete, 2 partial) |
| Failed | 4: potterybarn.com and saatchiart.com answer 403, loft.com shows a "press and hold" human check, stance.eu.com blocks our country |
| Skipped | 1: britishknights.com forwards to an Amazon storefront |
| Pages | 192 recorded, 175 captured in full at both widths |
| Blocks | 2,347 |
| Speed | 26 s per page per width (median), 37 s at the 90th percentile |
| Disk | 15 MB per store, so about 15 GB for 1,000 stores (the SEC-9 budget is 60 GB) |
| Full run estimate | 1,005 stores at three side by side: 17 to 20 hours |

The first tally the crawler printed was rosier: 47 done, 1 partial, 2 failed.
Looking at the captures showed why that was wrong, which is the main lesson:
**a status of 200 and a screenshot do not mean a store was captured.** Every
item below was found by eye on the contact sheets (`npm run review-sheets`).

## Found and fixed during the pilot

1. **Walls that answer "200 OK".** loft.com served "Please verify you are a
   human, press and hold" and was filed as a finished store. The crawler now
   recognises human checks, access-denied pages and geo-blocks by their wording
   and fails the store with that wording as the reason. It never tries to get
   past one. `npm run wall-check` tests this offline.
2. **Geo-block.** stance.eu.com: "Restricted Access. Sorry, you cannot visit
   our store from your current location." Same guard. A page that loads but
   has nothing to cut into blocks now fails too, quoting what the page says.
3. **Shopify's feed is a poor guide to which pages matter.** Its first
   collections were an empty one (Penguin: "No products found"), a contest
   rules page (Indigo) and an "Empty collection" (Plum); its first product was
   "currently unavailable". The worker now takes the collections and products
   a store features on its own home page first, and only fills gaps from the
   feed, fullest non-empty collections first.
4. **Empty image files.** A phone-width page 35,000 pixels tall is over 70,000
   pixels at 2x sharpness, more than a JPEG can hold. The file came out empty
   while the manifest said it existed (Charlotte Tilbury, Open Farm). Pages are
   now cut off at the format's limit and every image is checked for content.
5. **robots.txt that does not answer is not a "no".** loopearplugs.com
   redirected to its `www` address, whose robots.txt timed out. All five inner
   pages were skipped and the store still counted as done. Now: one more try
   after a pause, and if that fails the store is `partial` and gets retried.
6. **Home-made cookie bars.** Papyrus and allbyb.com roll their own, which no
   vendor list can know. Anything pinned to the screen that is short, talks
   about cookies and offers an accept-style button is hidden (never clicked).
7. **A store that is no longer a store.** britishknights.com forwards to
   amazon.com, and Amazon pages were filed under its name. Domains that land
   on a marketplace, a social profile or a domain seller are now skipped.

All seven were verified by capturing the affected stores again.

## Found and handed on

**Where the crawler runs changes what we capture (decision for Ben, SEC-50).**
From Kosovo: one store blocked us outright; DJI showed a banner "We noticed
you're browsing from Republika e Kosovës"; Zwift and Illumicrate put a
full-screen "choose your country" popup over every page; of the Shopify stores
that reveal a currency, 6 showed euros against 8 dollars, although most are
American; happysocks.com priced in Korean won. Options and costs are on the
task.

**Overlays that are not consent dialogs (SEC-8).** Chat prompts
(farrow-ball.com), newsletter cards (papier.com), discount tabs (anker.com,
stanley1913.com), location popups (zwift.com, illumicrate.com) and a popup
backdrop that turned grenson.com entirely grey. SEC-8 already plans to hide
pinned elements during block screenshots; this is its evidence. Also for
SEC-8: 33 of 182 pages came out with only one or two desktop blocks
(jbhifi.com.au, store.dji.com, mejuri.com, vertu.com), and shop.swatch.com
has a blank hero.

**Page types guessed from the address are sometimes wrong (SEC-49).**
charlottetilbury.com `/uk/products/shop-all` is a listing, not a product;
a boscana.de "collection" is a product. Home page only: 4 of 45 captured
stores (amydiener.com, autonomous.ai, shop.swatch.com, zwift.com), 14 percent
of the non-Shopify ones.

**The seed list contains sites that are not stores (SEC-51).** Found while
sampling: among WooCommerce rows ranked by traffic, the top of the list is
publishers and software vendors with a shop plugin (labusinessjournal.com,
modernretail.co, feedonomics.com, bigcommerce.co.uk, chargeflow.io). They are
on the live /sites page today. The capture gives a better test than the
validator had: did we find product pages with prices?

**Two vocabularies for platforms (SEC-13).** The seed list says `wix-stores`,
`salesforce`, `squarespace-commerce`; manifests say `wix`,
`salesforce-commerce-cloud`, `squarespace`. One list is needed before the
platform filter means anything.

## What the other lanes get

`fixtures/manifests/` now holds 34 real manifests from 15 stores on 10
platforms, with `index.json` saying what each one shows, including real
examples of the awkward cases (a store served from another host, a region in
the path, no platform detected, a block whose screenshot failed). See
"Fixtures for the importer" in `docs/CONTRACTS.md`. No contract types changed.

## Before the full run (SEC-42)

1. Decide where the crawler runs (SEC-50).
2. Hide pinned overlays during block screenshots (SEC-8), or a fifth of the
   library will carry a chat bubble or a popup.
3. Then run all 1,005: about a day of machine time and 15 GB.
