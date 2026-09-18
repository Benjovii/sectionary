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
src/capture.ts        capture CLI: browser control, screenshots, manifests, crawl log
src/page-script.ts    runs inside the page: block detection, platform/app detection
src/discover.ts       Shopify /products.json + /collections.json page discovery
src/polite.ts         polite-crawler rules: bot UA, robots.txt, pacing, block list
src/polite-check.ts   17 checks for the rules above (npm run polite-check)
src/harvest.ts        seed harvester: finds and ranks the stores to capture
src/build-index.ts    folds manifests into data/index.js for the local viewer
scripts/serve.js      local viewer server (npm run viewer -> http://localhost:4321)
scripts/export-sample.mjs  exports captured blocks into web/public/sample
viewer/index.html     local viewer for what was captured
config/               blocklist.txt (opt-outs), own-sites.txt (our stores), list-pages.txt
seeds/                stores.csv (chosen), candidates.csv (everything found)
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
| `npm run capture -- myzoobox.com --discover` | Captures a store: pages found through Shopify's JSON, desktop + mobile, full page + every block, platform/theme/apps, manifests. Robots and pacing enforced; skips logged in `data/crawl-log.jsonl`. |
| `npm run capture -- --seeds seeds/phase0.txt --discover` | Same for a seed list. |
| `npm run viewer` | Serves the local viewer at http://localhost:4321. |
| `node scripts/export-sample.mjs myzoobox.com` | Copies captured blocks into `web/public/sample` for the web app. |
| `cd web && npm run dev` | The web app locally (http://localhost:3000). `vercel deploy --prod --yes` deploys it. |

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
