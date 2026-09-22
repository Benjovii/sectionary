# Sectionary (codename)

A reference library for real websites and online stores, cut into **blocks**
(hero, featured collection, buy box, reviews, FAQ, cart…) at desktop and phone
width, with the platform, theme and apps behind each store detected
automatically. Mobbin for storefronts, at block level, at scale.

Live preview: https://sectionary-pink.vercel.app

## Start here

| If you want to know | Read |
|---|---|
| Who does what, the milestones, how we avoid collisions | [docs/TEAM-PLAN.md](docs/TEAM-PLAN.md) |
| Branches, pull requests, setup, the rules | [CONTRIBUTING.md](CONTRIBUTING.md) |
| The shapes that cross lanes and how to change them | [docs/CONTRACTS.md](docs/CONTRACTS.md) |
| What we are building and why | [docs/PLAN.md](docs/PLAN.md) |
| The name question | [docs/NAMES.md](docs/NAMES.md) |

Work is tracked on the private Next Level space **SEC**. Three lanes: Capture
(`src/`, Ben), Platform (`platform/` and the API routes, Buna), Web (`web/`,
Leke).

## Layout

```
src/crawl.ts          the crawl worker: works through the queue unattended (npm run crawl)
src/sample-seeds.ts   picks a varied set of stores for a pilot run
src/prune-seeds.ts    holds back the validated rows that are not stores (npm run prune-seeds)
src/review-sheets.ts  contact sheets for reviewing a crawl by eye
src/queue.ts          the crawl queue, one SQLite file: data/queue.sqlite
src/capture-page.ts   captures one page: both viewports, screenshots, manifest
src/capture.ts        one-off capture CLI for a single store or URL
src/page-script.ts    runs inside the page: block detection, platform/app detection, links
src/discover.ts       which pages to capture: Shopify's JSON feeds, or the home page's links
src/polite.ts         polite-crawler rules: bot UA, robots.txt, pacing, block list
src/polite-check.ts   17 checks for the rules above (npm run polite-check)
src/harvest.ts        seed harvester: finds and ranks the stores to capture
src/build-index.ts    folds manifests into data/index.js for the local viewer
scripts/serve.js      local viewer server (npm run viewer -> http://localhost:4321)
scripts/export-sample.mjs  exports captured blocks into web/public/sample
viewer/index.html     local viewer for what was captured
config/               blocklist.txt (opt-outs), own-sites.txt (our stores), not-stores.txt (judged by eye), list-pages.txt
seeds/                stores.validated.csv (the list we capture), stores.heldback.csv (not stores, with reasons), candidates.csv (everything found)
docs/bot-page.md      copy for the /bot page
web/                  the Next.js app (Vercel: https://sectionary-pink.vercel.app)
data/                 capture output, Tranco list (git-ignored)
```

## Setup (Windows, C: drive nearly full)

```powershell
cd D:\dev\sectionary
$env:npm_config_cache="D:\dev\_claude-tmp\npm-cache"; $env:TEMP="D:\dev\_claude-tmp\temp"; $env:TMP="D:\dev\_claude-tmp\temp"
npm install
```

`playwright` is pinned to 1.58.0 because Chromium 1208 is already installed
in `%LOCALAPPDATA%\ms-playwright`. Secrets go in `.env` (git-ignored):
`FIRECRAWL_API_KEY` for the harvester's search source.

## Commands

| Command | What it does |
|---|---|
| `npm run harvest` | Builds `seeds/stores.csv`: stores from ecomm.design's API, stores.gallery and catalog.cool sitemaps, industry searches and hand-picked articles, ranked by Tranco traffic rank, alive and shop-like only. Merges with the previous run. Flags: `--limit 1000`, `--sources ecomm,gallery,catalog,search,lists`, `--no-live`, `--fresh`. |
| `npm run polite-check` | Verifies robots parsing, block list, pacing and a live robots.txt. |
| `npm run wall-check` | Verifies that bot walls and geo-blocks are recognised and that normal pages are not mistaken for one. Offline. |
| `npm run capture -- myzoobox.com --discover` | Captures a store: pages found through Shopify's JSON, desktop + mobile, full page + every block, platform/theme/apps, manifests. Robots and pacing enforced; skips logged in `data/crawl-log.jsonl`. |
| `npm run capture -- --seeds seeds/phase0.txt --discover` | Same for a seed list. |
| `npm run crawl -- --seed seeds/stores.validated.csv --limit 50` | Puts the top 50 stores in the queue and captures them, three stores at a time. See "The crawl worker" below. |
| `npm run crawl` | Carries on with whatever is still queued (after a stop, a crash or a reboot). |
| `npm run crawl -- --report` | Progress, failure reasons, disk use and time left. Safe while a crawl is running. |
| `npm run crawl -- --stop` | Asks a running crawl to finish its pages and stop cleanly. |
| `npm run prune-seeds` | Holds back the rows of `seeds/stores.validated.csv` that are not stores (see "Seed quality" below) and writes them to `seeds/stores.heldback.csv` with the reason. `-- --dry` previews. Follow with `npm run export-stores`. |
| `npm run sample-seeds -- --n 50` | Picks a varied set of stores for a pilot run into `seeds/pilot-50.csv`: Shopify capped at half, every other platform represented, industries rotated, clear store evidence first. Same input, same output. |
| `npm run review-sheets` | Contact sheets of a crawl in `data/_review/`: the top of each store's home, product and collection page, desktop and mobile. The fast way to spot consent dialogs, popups, bot walls and geo-blocks. |
| `npm run viewer` | Serves the local viewer at http://localhost:4321. |
| `node scripts/export-sample.mjs myzoobox.com` | Copies captured blocks into `web/public/sample` for the web app. |
| `cd web && npm run dev` | The web app locally (http://localhost:3000). `vercel deploy --prod --yes` deploys it. |

## The crawl worker

`npm run crawl` is the unattended capture run. The queue is one file,
`data/queue.sqlite` (the SQLite built into Node, nothing to install), so the
capture lane needs no database server.

For each store it captures the home page, then picks two collection pages, two
product pages and the cart. The pages a store features on its own home page
come first (they are the merchandised ones). On Shopify the JSON feeds fill
the gaps, fullest non-empty collections first, because the top of the feed is
often an empty or internal collection. Pages of one store go one at a time;
`--parallel 3` (default) is how many stores run side by side.

What it is built to survive:

- **A crash, a kill, a reboot.** Run `npm run crawl` again. Stores that were
  mid-capture go back in line, and pages already captured are not captured
  twice. The page list chosen for a store is remembered, so a resume captures
  the same pages.
- **A page that hangs.** Each viewport of each page has a hard limit of 150
  seconds. The page is recorded as failed and the run moves on.
- **A browser that dies.** A new one is started and the page is tried again.
- **Throttling and flaky sites.** A store whose home page fails for a passing
  reason (429, 5xx, timeout, robots.txt unreachable) cools off for five minutes
  and gets one more try (`--retry-delay`, `--max-attempts`). A bot wall (403)
  or a dead domain is marked failed straight away.
- **Two runs at once.** `data/crawl.lock` holds the running process id. A
  second crawl refuses to start, because two crawls from one IP get both
  throttled. A lock left by a killed run is detected and taken over.

Stopping: Ctrl+C once (the pages in flight finish, the stores go back to the
queue), or `npm run crawl -- --stop` from another terminal. `--retry-failed`
puts failed and partial stores back in line; `--hosts a.com,b.com --recapture`
starts the named stores over, every page afresh. Every page is logged to
`data/crawl-log.jsonl`, and each run ends by writing `data/crawl-report.md`.

Store states: `pending`, `running`, `done` (every page captured), `partial`
(some pages or one viewport failed), `failed`, `skipped` (robots.txt or the
block list said no, or the store sits behind Shopify's password page).

Walls are recognised, never worked around. A human check ("press and hold"),
an access-denied page or a geo-block usually answers "200 OK" and would pass
for a captured page. `detectWall` in `src/page-script.ts` knows their wording
(`npm run wall-check` tests it offline), and the page fails with a reason such
as `wall:human-check: "Please verify you are a human..."`. A page that loads
but has nothing to cut into blocks fails the same way, with the page's own
words as the reason (`no-content: "..."`), and its files are removed so they
cannot be imported. robots.txt that does not answer is a hiccup, not a "no":
it gets a second try, and if that fails the store ends `partial`.

Known gap: on stores with free-form addresses (most Magento, Salesforce and
custom builds) the home page's links cannot be told apart by their address, so
only the home page is captured. The report counts those stores. Each home page
also saves its links (`links.json`), so better discovery can be re-run later
without visiting the store again.

## How a page is cut into blocks

`collectBlocks` in `src/page-script.ts` runs inside the page. It tries three
ways and trusts none of them blindly:

1. **Shopify's own section markers** (`.shopify-section`).
2. **Tags and page-builder classes**: `header`, `footer`, `section`, Elementor
   and Webflow section classes.
3. **The page's flow**: starting at the body, take the full-width rows, and
   keep descending into anything taller than about two screens.

Each way is scored by **how much of the page's height it covers with
block-sized pieces**. The first way that covers at least 60% wins (markers
beat tags, tags beat flow); otherwise the best cover wins. The score exists
because a way can "work" and still miss nearly everything: farrow-ball.com has
a header and a footer tag and 16 plain rows in between (14% covered), and
jbhifi.com.au marks only its header and footer as Shopify sections (8%).

Details that matter:

- An element's own height cannot be trusted. store.dji.com's `main` claims one
  screen while its content runs for eight, so the cutter measures how far the
  content extends.
- A child counts as a row only if it is at least half the screen wide, so
  side-by-side columns never split their parent. A product grid stays one
  block however tall it is.
- Pinned and absolutely placed elements are overlays, not rows, except a
  header laid over the hero (wide, short, at the top). A sticky layer as tall
  as the screen is a pinned backdrop (anker.com's video stages), not a row:
  its picture would only repeat its neighbours.
- Blocks with nothing to look at are dropped: no words, no media, no
  background picture. Page builders space their rows with empty strips and
  reserve scroll room with empty full-screen boxes.
- The header has a safety net. A pinned header often sits in a zero-height
  wrapper that no walk through the rows reaches (zwift.com), so if no chosen
  block is or contains the header, it is looked up near the top and added.
- The walk from the body always makes its first cut, however short the page
  (amydiener.com is under two screens and used to come out as its footer).
- A block's label comes from the block itself. What a split wrapper says about
  itself is passed down as `<type>-part`; the body's classes never are
  (WordPress puts `wp-custom-logo` there).
- The manifest records which way won (`strategy`: `shopify-sections`,
  `semantic`, `flow`, with `+refine` when something tall was split).

**Nothing floats on a block's picture.** While one block is photographed,
everything pinned to the screen that is not part of it is hidden and then put
back: sticky headers, chat bubbles, discount tabs, location dialogs and their
backdrops. The sticky header still gets a clean shot of its own. The full-page
picture hides the same things but keeps a header pinned to the top, because
that is part of the design. Pinned elements are looked for twice, at the top
and further down, because many headers only become pinned after scrolling.
Hidden by making them transparent, which moves nothing on the page and which
no child element can override. Never clicked. A pinned layer as large as the
screen that sits behind the content (a video backdrop) is left alone.

Before a block is photographed the capture waits up to three seconds for the
pictures inside it, because lazy images only start loading once the block is
on screen.

To judge the result by eye: `npm run review-sheets -- --blocks` shows every
block a page was cut into, in order (`--type product`, `--viewport mobile`,
`--stores-per-sheet 3`). Measured on 21 September 2026 on the home pages of 24
non-Shopify stores: 198 blocks, 8 bad (4%). Known leftovers: a heading that
is its own row becomes its own block, a very tall section that cannot be
split stays one giant block, and a store whose content never loads for the
crawler (shop.swatch.com) yields blank blocks.

## Seed quality

The validator judged pages by their words, and publishers, agencies and
software vendors that run a shop plugin have the same words as a store
(labusinessjournal.com, feedonomics.com and chargeflow.io all passed). Weak
store evidence alone proves nothing the other way: Nike, Gap, Wayfair and
Ulta score "weak" because their pages are built with JavaScript. So the
judgement is by eye, written down in `config/not-stores.txt` with a reason
per host, and `npm run prune-seeds` applies it together with three automatic
cases: hijacked domains (gambling or news spam), "coming soon" pages with no
store evidence, and domains that forward to a marketplace or a domain seller.
Held rows go to `seeds/stores.heldback.csv`; removing a host from the list
lets it back in on the next run. On 22 Sep 2026: 1,005 rows, 968 kept, 37
held.

The better judge is the capture itself: a store where the crawler finds no
product page with a price and an add-to-cart button is not a store. That
check runs after the full capture (SEC-49).

## Why the crawler scripts go through `scripts/with-dns-pool.mjs`

Node resolves host names on a pool of four threads. A crawler that meets a few
dead domains (each lookup hanging for about ten seconds) blocks that pool, and
every other request then times out looking like "robots unreachable". The
launcher starts `tsx` with `UV_THREADPOOL_SIZE=64`, which has to happen before
the process starts. `npm run validate`, `harvest` and `capture` use it; if you
run `tsx` directly, export the variable first.

## Crawler conduct

Every third-party request identifies as `SectionaryBot/<version>` (appended to
the real browser UA), honours robots.txt, keeps to one navigation per second
per host or the site's Crawl-delay, and skips anything in
`config/blocklist.txt`. Only the stores in `config/own-sites.txt` (ours) bypass
robots. Never add a third-party site there.

Cookie consent dialogs are hidden with a style rule, never clicked: a bot
cannot give consent, so none is recorded. Newsletter popups are closed, never
submitted. A 403 is a "no": the store is marked failed and not retried.
