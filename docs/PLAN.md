# Sectionary (working name) · Product and build plan

Started 2026-09-16. Owner: Ben. Status: Phase 0 prototype built and tested.
Code: `D:\dev\sectionary`. Names: see NAMES.md. Session log: docs/PROGRESS.md.

## 0. Scope update (2026-09-17, Ben's brief)

Ben's direction after seeing the prototype:

- **Harvester first.** Pull the 1,000 most successful e-commerce websites
  automatically (galleries, showcases, industry searches, public success
  signals), validate them, and capture them all.
- **A real front end on Vercel.** Replicate the Mobbin experience (browse
  wall, filters, detail view, flows) but make it our own: block level,
  e-commerce depth, tech-stack filters, time machine, copy-as-brief.
- **Next Level's design language.** Same tokens and components as Next Level
  (`DESIGN.md` and `src/app/globals.css` in the NL repo): warm neutrals,
  orange accent only on actions, dark default with light, Bricolage Grotesque
  titles, Inter UI, Geist Mono ids, hairline borders, no page-load
  choreography.
- **Polish from day one:** filters synced to the URL, loading screens,
  skeleton loaders, blur-up images, empty states that teach.
- **Temporary name:** Sectionary (final name is a board task).
- **Tracking:** every work item lives on the private Next Level space
  **SEC · Sectionary** (Ben and Art), created 2026-09-17. The board is the live
  plan; this document is the why and the how.
- The build itself starts in a later session.

## 1. What we are building

A searchable library of real websites and online stores, cut into **blocks**
(the hero, the featured collection, the reviews strip, the FAQ, the cart drawer)
instead of whole pages. Every block is captured at desktop and mobile width,
tagged by what it is (block type), where it lives (page type: home, collection,
product, cart, checkout), what it looks like (style, colours) and what powers it
(platform, Shopify theme, page builder, apps). Users search and filter, save
blocks to boards, share boards with clients, and later pull references straight
into AI design tools.

Mobbin does this for mobile and web **apps**. We do it for **marketing sites
and e-commerce stores**, at block level, at scale.

## 2. Who pays and why

- Agencies and freelancers building Shopify stores and landing pages (us, and
  thousands like us). Job: "find me five subscription PDPs with a how-it-works
  stepper, on mobile, by tomorrow's client call."
- In-house design, CRO and marketing people at DTC brands. Job: benchmark
  competitors, brief redesigns, prove a pattern exists before building it.
- Theme and app developers. Job: see how real stores use a theme or an app.

They already pay Mobbin, Refero and Baymard for adjacent needs. The e-commerce
block library with tech-stack filters is the piece none of them sells.

## 3. The competition, honestly

The idea has neighbours. None of them is the whole thing.

| Product | What it is | Size | Price | Gap for us |
|---|---|---|---|---|
| Mobbin | Mobile + web **app** screens and flows, hand-curated | 400k+ screens | paid | Apps, not storefronts; no block level; no tech stack |
| Refero | Web + iOS screens by page type, UX pattern, UI element; ships an MCP server and "Styles" (DESIGN.md per site) | 135k+ screens | Pro $10/mo annual, Team $12/seat | SaaS-first, curated by hand; e-commerce is one category among many; no platform/theme/app data |
| Baymard | E-commerce UX research with scored page examples | 18k+ examples, 74 page types | premium research pricing | Research tool, not inspiration; slow, expensive, desktop-heavy |
| stores.gallery | Curated e-commerce stores with 40+ section types, industries, mobile + desktop | small, "submit a store" | free | Hand-curated and small; no tech data; no search depth |
| Commerce Cream | Curated Shopify store designs by page type and UI element | small | free | Same: curated, small, Shopify-only |
| Ecomm.design | Store gallery with tech-stack filter | mid | free/paid | Whole sites only, no blocks |
| Unsection, SectionMaster, Land-book sections, Curated.design, Saaspo, Hero.gallery | Section-level galleries | hundreds to low thousands | free/cheap | Landing pages and SaaS, not commerce; hand-picked; no mobile pairing; no metadata |
| Commerce Muse | E-commerce screenshot pack on Gumroad | 1,500 screenshots | one-off | Static file, not a product |

Takeaway: "no competitors" is not true at the idea level, and we should not
pitch it that way. The open ground is **e-commerce + block level + automated
scale + tech-stack metadata + mobile-and-desktop pairs + history + AI-ready**.
Nobody covers more than two of those six.

## 4. Our wedge (what makes people switch)

1. **E-commerce-native taxonomy.** Buy box, variant picker, subscription
   picker, bundle builder, sticky add-to-cart, cart drawer, upsell, checkout
   steps, order confirmation. Not just "hero, features, footer".
2. **Scale through automation.** Crawler plus AI tagging gets us to 100k+
   blocks in months. Curated galleries plateau at a few hundred stores.
3. **Tech stack on every block.** "Show me product pages of stores on the
   Impact theme that run Skio." Platform, Shopify theme name and version, page
   builder, and ~55 apps and pixels are detected on capture. No gallery has this.
4. **Mobile and desktop, always paired.** Your "mobile first" rule, built in.
5. **Time machine.** Recapture monthly. Watch how the top 500 stores change
   for Black Friday, spot redesigns, compare a brand's PDP across a year.
6. **AI-ready output.** An MCP server so Claude and Cursor can search the
   library, plus "copy as design brief" that turns a block into a prompt.
   Refero is moving this way for SaaS sites; we do it for commerce.
7. **Agency workflow.** Boards, client share links, annotations.

## 5. How it works, in plain English

```
seed list ──▶ crawler ──▶ block cutter ──▶ storage ──▶ AI tagger ──▶ search index ──▶ web app
(which sites)  (Playwright)  (sections)   (images+DB)  (Claude)     (filters,      (Next.js)
                                                                    text, vectors)
```

- **Seed list.** Which sites to capture. Starts with our client stores, then
  hand-built lists of 300 to 500 strong stores across 12 industries (fashion,
  beauty, food and drink, supplements, subscription boxes, kids, pets, home,
  jewellery, sports, tech accessories, gifts), then landing pages by category.
- **Crawler.** A script drives a real Chrome (Playwright), opens each page at
  1440px and 390px, scrolls so lazy images load, closes popups, and takes a
  full-page screenshot. It runs on a small worker machine (your PC now, a
  €5 VPS later), never inside Vercel.
- **Block cutter.** Shopify wraps every theme section in a `.shopify-section`
  element whose id names the section type (`hero-banner`,
  `featured-collection`, `collapsible-content`). That gives us clean blocks and
  a first tag for free on the platform that matters most. Other sites fall back
  to `header` / `section` / `footer` elements. Each block is screenshotted
  separately at both widths.
- **Shopify discovery.** Every Shopify store publishes `/products.json` and
  `/collections.json`. We use them to find product and collection URLs without
  crawling links. The theme name and version come from the page's own
  `Shopify.theme` object.
- **Storage.** Screenshots (converted to WebP) go to object storage behind a
  CDN. Everything else (sites, pages, blocks, tags, users, boards) goes in
  Postgres.
- **AI tagger.** Claude looks at each block screenshot plus its text and
  returns structured JSON: block type from our taxonomy, style tags, industry,
  a one-line description, notable UX patterns. Runs through the Batch API
  (half price, overnight).
- **Search index.** Filters (page type, block type, platform, theme, app,
  industry, style, viewport), full-text on headline and copy, and vector search
  on the AI description so "trust-building strip under the buy box" finds
  things that were never tagged with those words.
- **Web app.** Masonry browse, block detail with the paired viewport, page and
  flow view (home → collection → product → cart → checkout), site profiles,
  boards, share links, account and billing.

## 6. Tech stack (mostly what you already run)

| Layer | Choice | Why |
|---|---|---|
| Web app | Next.js + TypeScript on Vercel | Same as Next Level; you know the deploy flow |
| Database | Postgres on Supabase + Drizzle, pgvector for vectors | Same as Next Level; RLS lessons carry over |
| Images | Cloudflare R2 (recommended: no egress fees for an image-heavy site); DigitalOcean Spaces works identically if you prefer what you have | S3-compatible either way |
| Crawler worker | Node + Playwright on a Hetzner or DO VPS (Phase 1); your PC for Phase 0 | Long-running browsers do not belong in serverless |
| AI tagging | Claude via the Batch API. Sonnet 5 recommended for quality per dollar; Haiku 4.5 if we want cheaper; Opus 5 for premium "design brief" extraction | Costs in section 10 |
| Embeddings | Voyage AI (existing account) or the equivalent | Cheap, small |
| Auth | Supabase magic links, token-hash pattern from Next Level | Works in Safari and cross-device |
| Billing | Paddle (merchant of record) | Stripe does not serve Kosovo; Paddle pays out via Payoneer or IBAN |
| Search | Postgres full-text + pgvector first; Typesense/Meilisearch only if we outgrow it | Fewer moving parts |

## 7. Data model (simplified)

- `sites` (host, name, platform, theme, builder, apps[], industry, country)
- `pages` (site, url, page_type)
- `captures` (page, captured_at, viewport, full screenshot key, height, status) · one per crawl, so history is free
- `blocks` (capture, index, block_type, tags[], headline, text, bbox, bg colour, palette[], image key, ai_description, embedding)
- `taxonomy` (block types, style tags, industries, with synonyms)
- `users`, `orgs`, `plans`, `boards`, `board_items`, `takedown_requests`

## 8. Block taxonomy v1

Global: announcement bar, header/navigation, hero, USP bar, logo/press bar,
image with text, video, features grid, testimonials, UGC gallery, FAQ,
newsletter, CTA band, footer, comparison table, pricing, team, blog teasers,
contact, stats, how-it-works/timeline, app download, trust badges.

E-commerce: featured collection, collection grid, product card, filter/sort
bar, product gallery, buy box (price, variants, add to cart), subscription
picker, bundle builder, size guide, shipping and returns, product tabs,
product reviews, cross-sell/upsell, recently viewed, sticky add to cart,
cart drawer, cart page, checkout step, order confirmation, account, search
results, quiz/finder, store locator, gift card.

Style: minimal, bold, playful, luxury, editorial, brutalist, dark, pastel,
photo-led, illustration-led, typographic, gradient.

## 9. Legal and ethics (do these, not optional)

- Screenshots of public pages shown for reference and comparison is the model
  Mobbin, Refero, Land-book and Baymard run on. It is defensible but not
  risk-free. One hour with an IP lawyer before public launch.
- **Polite crawler** from Phase 1: named user agent, respect robots.txt, one
  request per second per site, cache, never behind logins, never capture pages
  containing someone's personal data.
- **Takedown and opt-out** form on the site, answered within 48 hours, plus a
  domain block list the crawler checks.
- **Attribution.** Every block links to the source page and names the brand.
  We host our screenshots only, never their HTML, images or code.
- Brand names are used to identify, not to imply endorsement.
- Only public storefront JSON is used, never a store's admin API.
- Until Phase 1 rules exist, capture only sites we manage or have permission
  for (the seed file is our client stores).

## 10. Costs

Monthly infrastructure while building: roughly $60 to $100.

| Item | Monthly |
|---|---|
| Vercel (Hobby $0 to start, Pro $20 when we add a team) | $0 to $20 |
| Supabase Pro | $25 |
| Cloudflare R2 (100 GB of WebP blocks) | $5 to $15 |
| VPS for the crawler | €5 to €10 |
| Domain | $40 to $70 a year (.design), or $4,495 for sectionary.com |
| Paddle | 5% + $0.50 per transaction, no fixed fee |

AI tagging, per 1,000 blocks (each block: one screenshot of about 1,100 tokens,
a 600-token prompt, a 250-token JSON answer; Batch API halves the price):

| Model | Per 1,000 blocks (batch) | 100k blocks |
|---|---|---|
| Haiku 4.5 ($1 / $5 per million tokens) | about $1.50 | about $150 |
| Sonnet 5 ($2 / $10) | about $3 | about $300 |
| Opus 5 ($5 / $25) | about $7.50 | about $750 |

So the whole first 100k-block library tags for a few hundred dollars. Sonnet 5
is the sensible default; we can spot-check a sample against Opus 5.

## 11. Phases

**Phase 0 · Prove the capture (done 2026-09-16).** `D:\dev\sectionary`:
capture CLI, Shopify discovery, block cutter, platform/theme/app detection,
local viewer. Tested on myzoobox.com. Next: run it on the other three client
stores and look at the results with a critical eye (see PROGRESS.md).

**Phase 1 · The real pipeline and an internal tool (2 to 3 weeks).**
Postgres schema; WebP conversion and upload to R2; crawl queue with politeness
rules; AI tagger with the v1 taxonomy and an eval set of 200 hand-checked
blocks; 300 to 500 seed stores across 12 industries, target 30k blocks;
internal Next.js app: browse, filter, search, block detail, page view. We use
it at Blackbird daily. Exit test: it beats Google Images and Pinterest for our
own reference hunts.

**Phase 2 · Make it a product (4 to 6 weeks).** Semantic search, boards and
share links, "similar blocks", site profiles with tech stack, flows (home →
collection → product → cart), version history, mobile polish, landing page
and waitlist, weekly recaptures of the top 200 stores.

**Phase 3 · Sell it (6 to 8 weeks).** Auth, Free/Pro/Team plans, Paddle
billing, Terms/Privacy/takedown pages, MCP server, "copy as design brief",
launch on Product Hunt, Shopify partner communities, X and LinkedIn.

**Phase 4 · Scale.** 5,000+ stores, landing pages beyond commerce, API, team
annotations, a Figma plugin.

## 12. Pricing hypothesis (to test, not decided)

Free: browse with a daily cap, no boards. Pro: about $12 a month or $96 a
year. Team: about $20 per seat. Refero charges $10 a month on annual billing;
we carry more per block (tech stack, pairs, history) so a little above it is
defensible. Agencies are the first paying segment.

## 13. Decisions needed from you

1. Name and domain (NAMES.md). Recommendation: Sectionary on sectionary.design.
2. Code location: `D:\dev\sectionary` (created, outside the vault so npm and
   Playwright do not fight the vault path). Fine, or move it?
3. Seed industries: confirm or reorder the 12 in section 5.
4. Budget: about $60 to $100 a month infrastructure, plus a few hundred
   dollars one-off for tagging the first 50k to 100k blocks.
5. Legal consult before public launch (Phase 3).
6. Tracking: do you want a private Next Level space for this build like the
   NLS one, so every task is a real board item? Say the word and I set it up
   under ben@blackbird.marketing.

## 14. Risks and how we handle them

- **Bot blocking.** Cloudflare challenges on some stores. Mitigation: real
  browser, slow polite crawl, skip and log, never fight it.
- **Segmentation quality on non-Shopify sites.** Heuristic today. Mitigation:
  Phase 1 adds per-platform rules (Elementor, Webflow, Framer) and an AI
  "is this one block or two" check on the ambiguous ones.
- **Takedown requests.** Expected, manageable with a fast process and a block list.
- **Copycats.** The moat is the data pipeline, the taxonomy quality and the
  tech-stack layer, not the UI. Keep shipping data.
- **Time.** This runs beside client work and Next Level. Phase 1 is the
  commitment test: if the internal tool is not something we open daily after
  three weeks, we stop.
