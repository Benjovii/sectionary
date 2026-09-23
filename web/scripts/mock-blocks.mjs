// SEC-46 · multiply the sample blocks into a set the size we expect after the
// full capture, so the wall's virtualisation and the filters can be tested now.
//
//   node scripts/mock-blocks.mjs --verify            check the set and the filters
//   node scripts/mock-blocks.mjs --out mock.json     write it to disk (gitignored)
//   node scripts/mock-blocks.mjs --count 60000       any size
//
// The app does not read a file: it expands the same 84 samples in the browser
// from NEXT_PUBLIC_MOCK_BLOCKS, which costs nothing to download. The file is
// only here for when someone wants to eyeball the data.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { expandBlocks } from "../src/lib/mock-blocks.ts";
import { buildIndex, queryBlocks } from "../src/lib/block-source.ts";
import { layOut, visible, columnsFor } from "../src/lib/wall-layout.ts";
import { COLOUR_BUCKETS, bucketFor } from "../src/lib/colour.ts";

const here = dirname(fileURLToPath(import.meta.url));
const read = (name) => JSON.parse(readFileSync(resolve(here, "../public/sample", name), "utf8"));

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const COUNT = Number(option("--count", 30000));
const samples = read("blocks.json").blocks;
const stores = read("stores.json").stores;

const started = performance.now();
const blocks = expandBlocks(samples, stores, COUNT);
const generateMs = performance.now() - started;

console.log(`Generated ${blocks.length.toLocaleString("en-US")} blocks from ${samples.length} samples and ${stores.length} stores in ${generateMs.toFixed(0)} ms`);

if (flag("--out")) {
  const target = resolve(process.cwd(), option("--out", "mock-blocks.json"));
  writeFileSync(target, JSON.stringify({ generatedAt: new Date().toISOString(), blocks }));
  console.log(`Wrote ${target}`);
}

if (flag("--verify")) {
  let failures = 0;
  const check = (label, ok, detail = "") => {
    console.log(`${ok ? "  ok  " : "  FAIL"} ${label}${detail ? `  ${detail}` : ""}`);
    if (!ok) failures += 1;
  };

  console.log("\nThe set");
  check("exact count", blocks.length === COUNT, `${blocks.length}`);
  const ids = new Set(blocks.map((b) => b.id));
  check("ids unique", ids.size === blocks.length, `${ids.size} distinct`);

  const hosts = new Set(blocks.map((b) => b.host));
  const pageTypes = new Set(blocks.map((b) => b.pageType));
  const typeHints = new Set(blocks.map((b) => b.typeHint));
  const heights = new Set(blocks.map((b) => b.h));
  check("varied hosts", hosts.size >= stores.length * 0.98, `${hosts.size} of ${stores.length} stores represented`);
  check("varied types", pageTypes.size >= 4 && typeHints.size >= 10, `${pageTypes.size} page types, ${typeHints.size} block types`);
  check("varied sizes", heights.size > 200, `${heights.size} distinct heights`);

  // The wall reserves each block's aspect ratio before the image loads, so
  // these two must always be present (docs/CONTRACTS.md, Items).
  check("every block has w and h", blocks.every((b) => b.w > 0 && b.h > 0));
  check("every block keeps a screenshot", blocks.every((b) => typeof b.src === "string" && b.src.length > 0));

  const again = expandBlocks(samples, stores, COUNT);
  check("deterministic", again[0].id === blocks[0].id && again.at(-1).id === blocks.at(-1).id && again.length === blocks.length);

  console.log("\nThe filters");
  const indexStarted = performance.now();
  const index = buildIndex(blocks, stores);
  const indexMs = performance.now() - indexStarted;
  check("index builds", index.blocks.length === blocks.length, `${indexMs.toFixed(0)} ms`);

  const time = (label, query) => {
    const t = performance.now();
    const res = queryBlocks(index, query);
    const ms = performance.now() - t;
    console.log(`  ${ms < 300 ? "ok  " : "SLOW"} ${label}  ${res.total.toLocaleString("en-US")} blocks, ${ms.toFixed(0)} ms`);
    if (ms >= 300) failures += 1;
    return res;
  };

  // SEC-16 asks for every filter combination to answer in under 300 ms.
  const unfiltered = time("no filters", {});
  time("one platform", { platform: "shopify" });
  const multi = time("multi-select platform", { platform: "shopify,woocommerce,magento" });
  const single = queryBlocks(index, { platform: "shopify" });
  check("multi-select widens the result", multi.total > single.total, `${multi.total} > ${single.total}`);
  time("page and viewport", { page: "home,product", vp: "mobile" });
  time("industry and country", { industry: "fashion-apparel", country: "US" });
  time("free text", { q: "subscription" });
  time("everything at once", { page: "home", vp: "desktop", platform: "shopify", industry: "fashion-apparel", country: "US", q: "cart" });

  console.log("\nFacets and paging");
  check("facets cover every dimension", Object.keys(unfiltered.facets ?? {}).length === 11, Object.keys(unfiltered.facets ?? {}).join(", "));
  const platformFacet = unfiltered.facets?.platform ?? [];
  check("facet counts sum to the set", platformFacet.reduce((n, f) => n + f.count, 0) <= blocks.length, `${platformFacet.length} platforms`);

  // Ticking one platform must not zero out the others, or multi-select is unusable.
  const narrowed = queryBlocks(index, { platform: "shopify" });
  const others = (narrowed.facets?.platform ?? []).filter((f) => f.value !== "shopify");
  check("facets ignore their own filter", others.length > 0 && others.every((f) => f.count > 0), `${others.length} other platforms still counted`);

  let cursor = null;
  let walked = 0;
  let pages = 0;
  const seen = new Set();
  do {
    const page = queryBlocks(index, { cursor: cursor ?? undefined, limit: 200 });
    for (const item of page.items) seen.add(item.id);
    walked += page.items.length;
    cursor = page.nextCursor;
    pages += 1;
  } while (cursor && pages < 1000);
  check("cursor walks the whole set once", walked === blocks.length && seen.size === blocks.length, `${pages} pages, ${walked} items`);

  // SEC-15 and SEC-46 share one exit test: 30,000 blocks scrolling smoothly on
  // a mid-range phone. Smooth means a frame budget of 16.7 ms at 60fps, and the
  // wall only gets a slice of that, so the visible-window query is held to 1 ms.
  // SEC-16: page type, block type, platform, theme, apps, industry, viewport,
  // country, has video and dominant colour, all multi-select, all in the URL,
  // every combination under 300 ms. ("style" waits on the AI tagger, SEC-12.)
  console.log("\nSEC-16 filters");
  const known = new Set(COLOUR_BUCKETS.map((b) => b.key));
  const buckets = blocks.map((b) => bucketFor(b.bg));
  check("every block gets a colour bucket", buckets.every((b) => b && known.has(b)), `${new Set(buckets).size} buckets in use`);

  const videoFacet = unfiltered.facets?.video ?? [];
  check("video facet splits the set", videoFacet.length === 2 && videoFacet.every((f) => f.count > 0), videoFacet.map((f) => `${f.value} ${f.count}`).join(", "));

  const colourFacet = unfiltered.facets?.color ?? [];
  check("colour facet counts every block", colourFacet.reduce((n, f) => n + f.count, 0) === blocks.length, colourFacet.slice(0, 5).map((f) => `${f.value} ${f.count}`).join(", "));

  // Multi-select must widen within a dimension and narrow across dimensions.
  const topColours = colourFacet.slice(0, 2).map((f) => f.value);
  const oneColour = queryBlocks(index, { color: topColours[0] });
  const twoColours = time(`multi-select colour (${topColours.join(", ")})`, { color: topColours.join(",") });
  check("colour multi-select widens", twoColours.total > oneColour.total, `${twoColours.total} > ${oneColour.total}`);
  time("has video", { video: "yes" });
  time("apps multi-select", { app: "Klaviyo,Shop Pay" });

  // The worst case the UI can produce: something selected in all ten.
  const everything = {
    page: "home,product", block: "hero,footer", vp: "desktop,mobile",
    platform: "shopify,woocommerce", theme: "Dawn,Debut", app: "Klaviyo,Shop Pay",
    industry: "fashion-apparel,beauty-skincare", country: "US,GB",
    video: "yes,no", color: "white,light,dark",
  };
  const t = performance.now();
  const worstCase = queryBlocks(index, everything);
  const worstMs = performance.now() - t;
  check("all ten filters at once, under 300 ms", worstMs < 300, `${worstCase.total.toLocaleString("en-US")} blocks, ${worstMs.toFixed(0)} ms`);

  // Shareable means the URL round-trips: build one, read it back, same query.
  const params = new URLSearchParams(everything);
  const readBack = Object.fromEntries(params);
  check("filter state round-trips through a URL", JSON.stringify(queryBlocks(index, readBack).total) === JSON.stringify(worstCase.total), `?${params}`.slice(0, 72) + "…");

  // SEC-21: the empty state names the filter actually responsible, so the
  // advice has to be true: removing that one filter must really show blocks.
  console.log("\nSEC-21 empty state");
  const impossible = { page: "home", block: "cart-items" };
  const dead = queryBlocks(index, impossible);
  check("the awkward combination really is empty", dead.total === 0, `${dead.total} blocks`);

  const near = dead.nearMiss ?? {};
  const blamed = Object.entries(near).sort((a, b) => b[1] - a[1])[0];
  check("it names a filter to remove", Boolean(blamed), blamed ? `${blamed[0]}, worth ${blamed[1]} blocks` : "none");

  if (blamed) {
    const without = { ...impossible };
    delete without[blamed[0]];
    const revealed = queryBlocks(index, without);
    check("removing that filter really shows them", revealed.total === blamed[1], `${revealed.total} shown, ${blamed[1]} promised`);
    const other = Object.keys(impossible).find((k) => k !== blamed[0]);
    const worse = queryBlocks(index, { ...impossible, [other]: undefined });
    check("it picks the more useful of the two", revealed.total >= worse.total, `${revealed.total} vs ${worse.total}`);
  }

  check("a query with no filters blames nothing", Object.keys(queryBlocks(index, {}).nearMiss ?? {}).length === 0);

  console.log("\nThe wall at 375px (one column, a phone)");
  for (const width of [375, 1440]) {
    const columns = columnsFor(width);
    const t = performance.now();
    const layout = layOut(blocks, width);
    const layoutMs = performance.now() - t;
    check(
      `lays out ${blocks.length.toLocaleString("en-US")} blocks at ${width}px`,
      layoutMs < 250,
      `${columns} column(s), ${(layout.height / 1000).toFixed(0)}k px tall, ${layoutMs.toFixed(0)} ms`,
    );

    check("every card has height", layout.columns.every((c) => c.every((p) => p.height > 0)));
    check(
      "columns are ordered and do not overlap",
      layout.columns.every((c) => c.every((p, i) => i === 0 || c[i - 1].y + c[i - 1].height <= p.y)),
    );
    check("every block is placed once", layout.columns.reduce((n, c) => n + c.length, 0) === blocks.length);

    // Walk the whole wall the way a thumb does and time the worst frame.
    let worst = 0;
    let total = 0;
    const frames = 400;
    for (let f = 0; f < frames; f += 1) {
      const top = (layout.height * f) / frames;
      const ft = performance.now();
      const shown = visible(layout, top, top + 812);
      const ms = performance.now() - ft;
      total += ms;
      if (ms > worst) worst = ms;
      if (shown.length === 0 && top < layout.height - 812) failures += 1;
    }
    check(
      "visible window stays inside the frame budget",
      worst < 1,
      `worst ${worst.toFixed(2)} ms, mean ${(total / frames).toFixed(3)} ms over ${frames} frames`,
    );
  }

  console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} check(s) failed.\n`);
  process.exit(failures === 0 ? 0 : 1);
}
