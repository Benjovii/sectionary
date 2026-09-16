# Sectionary (working name) · Phase 0 prototype

A reference library for real websites and online stores, cut into **blocks**
(hero, featured collection, reviews, FAQ, footer…) instead of whole pages.
Think Mobbin, but for landing pages and e-commerce, at block level, with the
platform, theme and apps behind each store detected automatically.

This folder is the **Phase 0 capture prototype**: it proves we can turn a URL
into tagged block screenshots at desktop and mobile widths. The plan, name
research and session log live in the vault:
`D:\Ben's Vault\To Do's\New APP Mobbin Recreate\`.

## Run it

Prerequisites: Node 24 (installed), Playwright's Chromium 1208 (already in
`%LOCALAPPDATA%\ms-playwright`, which is why `playwright` is pinned to 1.58.0).

Because the C: drive is nearly full, point npm's cache and temp at D: first
(PowerShell):

```powershell
cd D:\dev\sectionary
$env:npm_config_cache="D:\dev\_claude-tmp\npm-cache"; $env:TEMP="D:\dev\_claude-tmp\temp"; $env:TMP="D:\dev\_claude-tmp\temp"
npm install
```

Capture one Shopify store end to end (home, 2 collections, 2 products, cart):

```powershell
npm run capture -- myzoobox.com --discover
```

Capture specific pages, or a whole seed list:

```powershell
npm run capture -- https://sisterlylab.com/products/the-daily-duo --only mobile
npm run capture -- --seeds seeds/phase0.txt --discover
```

Then open `viewer\index.html` by double-clicking it (no server needed).
Blocks tab = masonry of every block with filters; Pages tab = desktop and
mobile full-page screenshots side by side, with the detected platform, theme
and apps.

Flags: `--discover`, `--seeds <file>`, `--only desktop|mobile`, `--out <dir>`,
`--max-blocks 40`, `--min-height 80`, `--quality 88`, `--headed` (watch it).

## What it does per page

1. Opens the page in a real Chromium at 1440px (desktop) and 390px (mobile, 2x).
2. Waits for network idle, scrolls to the bottom so lazy images load, presses
   Escape and closes obvious popups and cookie banners (never accepts them).
3. Detects the platform (Shopify, WooCommerce, WordPress, Webflow, Framer,
   Squarespace, Wix, BigCommerce, Magento, Next.js…), the Shopify theme name and
   version, page builders (GemPages, PageFly, Elementor…) and ~55 apps and
   pixels (Klaviyo, Recharge, Skio, Rebuy, Gorgias, Judge.me, Loox, GA4, Meta…).
4. Takes a full-page screenshot.
5. Cuts the page into blocks. On Shopify every `.shopify-section` is a block and
   its section id gives the type for free (`hero-banner`, `featured-collection`,
   `image-with-text`, `collapsible-content`…). Elsewhere it falls back to
   top-level `header`/`section`/`footer` elements, then to the children of `main`.
6. Screenshots every block and records its headline, text, button/image/video
   counts, background colour and position.
7. Writes `data/<host>/<page>/manifest.json` and rebuilds `data/index.js`.

## Layout

```
src/capture.ts       CLI: browser control, screenshots, manifests
src/page-script.ts   code that runs inside the page: block detection, platform/app detection
src/discover.ts      Shopify /products.json + /collections.json page discovery
src/build-index.ts   folds all manifests into data/index.js for the viewer
viewer/index.html    local browser for what was captured
seeds/phase0.txt     the first sites to capture (our own client stores)
data/                output (git-ignored)
```

## Known limits (Phase 0)

- Non-Shopify segmentation is heuristic; expect a few merged or split blocks.
- Sticky headers can overlap the top of a block screenshot on some themes.
- Chromium cannot render full-page screenshots taller than ~16,000px; the
  script falls back to the first screen for those pages.
- No robots.txt handling or rate limiting yet: only run it against sites we
  manage or with permission until Phase 1 adds the polite-crawler rules.
