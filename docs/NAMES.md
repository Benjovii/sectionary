# Name research (2026-09-16)

Method: every candidate was checked against the registries' own RDAP servers
(Verisign for .com, rdap.org for the rest) and web-searched for products with
the same name in the design-reference space. "Free" means unregistered on
2026-09-16; buy the one you pick the same day, availability changes.

The .com is taken for practically every good word in this space. That is
normal here: Refero is refero.design, Curated is curated.design, Ecomm is
ecomm.design, stores.gallery and catalog.cool live on odd TLDs, and Mobbin
itself started on mobbin.design. A .design or .app domain is in-category and
nobody in this audience blinks at it.

## Shortlist

| # | Name | Free domains | Taken | Competitor check | Read |
|---|------|--------------|-------|------------------|------|
| 1 | **Sectionary** | sectionary.app, sectionary.design (sectionary.io/.co look free, confirm at the registrar) | sectionary.com is parked on BrandBucket: $4,495 or $432/month lease-to-own | No product, app or gallery uses it. Only "section design" articles come up. | "A dictionary of sections." Coined, one word, easy to say and spell, says exactly what the product is, works for landing pages AND e-commerce. My recommendation. |
| 2 | **Storewindow** | storewindow.app, storewindow.design (.io/.co look free) | storewindow.com (registered, no site) | Nothing in design or software. Search only returns retail window-display articles. | "Window shopping for store design." The strongest e-commerce metaphor, but it narrows the brand to stores; landing pages feel out of place. |
| 3 | **Sectionscope** | sectionscope.com, .app, .design (all free) | nothing | No hits. | Descriptive, free .com, a bit clinical. |
| 4 | **Sectionfolio** | sectionfolio.com, .app, .design (all free) | nothing | No hits. | "A portfolio of sections." Free .com, slightly long (four syllables). |
| 5 | **Storeinspo** | storeinspo.com, .app, .design (all free) | nothing | No hits. | The obvious, searchable name. Cheap-sounding, hard to trademark, but the .com is free and it says what it is. |
| 6 | **Merchref** | merchref.com, .app, .design (all free) | nothing | No hits. | Only wildcard with every TLD free. Weakest as a brand. |

Also free, single-word, .design only: shopwindow.design, stockroom.design,
kiosk.design, storey.design, planogram.design, shopfit.design,
blocksmith.design, windowshop.design, storewalk.design, vetrina.design.

## Rejected (and why)

- Shopsnap: an existing e-commerce platform (shopsnap.io) and a Shopify UGC app.
- Foldbook: a book-folding art app owns the name.
- Vitrina / Vitrine / Frontage / Shopfront / Storefront / Highstreet / Endcap / Fascia / Swipefile: every useful TLD taken.
- Blocksmith: blocksmith.com is an AI security company.
- Shopfit: a US retail-fixtures company.
- Windowshop: windowshop.com belongs to Amazon.
- Refero-style coinages (Refly, Referly, Reflib): taken.

## Conflict found 2026-09-17

While deploying to Vercel, `sectionary.vercel.app` turned out to be taken by
someone else's project titled "Sectionary — Shopify Section Library", a
French-language library of Shopify theme sections for developers and agencies
(sections for sale at roughly $12 to $50). It is not indexed by search engines
yet and owns no sectionary.* domain we checked, but it targets the same Shopify
agency audience with the same word. Two products called Sectionary in the
Shopify world would confuse everyone. Treat **Sectionary as the codename only**
and pick the final name from the rest of the shortlist (Storewindow is the
strongest clean option), or coin a new one, before buying any domain.

Our Vercel production URL is therefore https://sectionary-pink.vercel.app
(project name "sectionary" was free, the short subdomain was not).

## Recommendation

Go with **Sectionary** on **sectionary.design** now (about $40 to $70 a year)
and, if the product proves itself, buy sectionary.com from BrandBucket or take
the lease-to-own. If you want the brand to shout "e-commerce", **Storewindow**
on storewindow.design is the runner-up. Before spending on the .com, run a
trademark search (EUIPO + USPTO) for the final pick; I checked products, not
registered marks.

The repo already uses the codename `sectionary` (D:\dev\sectionary). Renaming
later is one folder rename plus the `name` field in package.json.
