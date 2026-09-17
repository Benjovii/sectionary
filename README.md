# Sectionary (codename)

A reference library for real websites and online stores, cut into **blocks**
(hero, featured collection, buy box, reviews, FAQ, cart…) at desktop and phone
width, with the platform, theme and apps behind each store detected
automatically. Mobbin for storefronts, at block level, at scale.

The plan, name research and session log live in the vault:
`D:\Ben's Vault\To Do's\New APP Mobbin Recreate\`. Work is tracked on the
private Next Level space **SEC**.

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

## Crawler conduct

Every third-party request identifies as `SectionaryBot/<version>` (appended to
the real browser UA), honours robots.txt, keeps to one navigation per second
per host or the site's Crawl-delay, and skips anything in
`config/blocklist.txt`. Only the stores in `config/own-sites.txt` (ours) bypass
robots. Never add a third-party site there.
