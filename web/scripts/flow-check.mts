// Checks lib/flows.ts: which stores have a complete flow, the step order, the
// gaps, and that mock blocks never count. No network:  npm run flow-check
import { readFileSync } from "node:fs";
import { buildIndex } from "../src/lib/block-source.ts";
import { cutBlocks, flowCounts, flowOf, flowSummaries, pageView, FLOW_STEPS } from "../src/lib/flows.ts";
import { pagesFromBlocks } from "../src/lib/site-profile.ts";
import { expandBlocks } from "../src/lib/mock-blocks.ts";
import type { Block } from "../src/contracts/block.ts";
import type { Store } from "../src/contracts/store.ts";

let bad = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok || !detail ? "" : `  (${detail})`}`);
  if (!ok) bad++;
}

let n = 0;
function block(host: string, type: string, path: string, extra: Partial<Block> = {}): Block {
  n++;
  const slug = path === "/" ? "home" : path.slice(1).replace(/\//g, "-");
  return {
    id: `${host}/${slug}/${extra.viewport ?? "desktop"}/${n}`,
    host, pageType: type, pageUrl: `https://${host}${path}`, pageTitle: null,
    viewport: "desktop", typeHint: "hero", headline: null, bg: "rgb(255, 255, 255)",
    w: 1440, h: 600, src: `/x/${n}.jpg`, platform: "shopify", theme: null, apps: [],
    buttons: 0, images: 0, videos: 0, text: "", ...extra,
  } as Block;
}
const shop = (host: string, types: [string, string][]) => types.map(([t, p]) => block(host, t, p));

const full = shop("full.test", [["home", "/"], ["collection", "/collections/a"], ["product", "/products/b"], ["cart", "/cart"]]);
const noProduct = shop("noproduct.test", [["home", "/"], ["collection", "/collections/a"]]);
const twoProducts = shop("two.test", [["home", "/"], ["collection", "/collections/a"], ["product", "/products/z"], ["product", "/products/a"]]);
const extras = shop("extras.test", [["home", "/"], ["collection", "/collections/a"], ["product", "/products/b"], ["blog", "/blogs/news"], ["page", "/pages/about"]]);
const mockOnly = shop("mock.test", [["home", "/"], ["collection", "/collections/a"], ["product", "/products/b"]]).map((b) => ({ ...b, mock: true }) as Block);

// 1. One store's flow.
const fullFlow = flowOf(pagesFromBlocks(full));
check("steps are always the four, in order, with no cart", fullFlow.steps.map((s) => s.type).join() === "home,collection,product,checkout");
check("home+collection+product is complete", fullFlow.complete && fullFlow.missing.length === 0);
check("captured counts steps with pages, the cart page not among them", fullFlow.captured === 3, String(fullFlow.captured));
check("checkout is a 'never' gap", fullFlow.steps[3].gap === "never" && fullFlow.steps[3].pages.length === 0);

const noProductFlow = flowOf(pagesFromBlocks(noProduct));
check("missing product is incomplete", !noProductFlow.complete && noProductFlow.missing.join() === "product", noProductFlow.missing.join());
check("missing product is a 'missing' gap", noProductFlow.steps[2].gap === "missing");

const twoFlow = flowOf(pagesFromBlocks(twoProducts));
check("two products both on the step, by URL", twoFlow.steps[2].pages.map((p) => p.url).join() === "https://two.test/products/a,https://two.test/products/z");
check("two products is complete", twoFlow.complete);

const extrasFlow = flowOf(pagesFromBlocks(extras));
check("blog and page types stay out of the flow", extrasFlow.steps.every((s) => s.pages.every((p) => FLOW_STEPS.includes(p.type as never))));

check("an empty page does not count", !flowOf([{ key: "k", url: "https://e.test/", type: "home", title: null, capturedAt: null, desktop: null, mobile: null, blockCount: 0, desktopBlocks: [], mobileBlocks: [] }]).steps[0].pages.length);
check("a full-page screenshot counts", flowOf([{ key: "k", url: "https://e.test/", type: "home", title: null, capturedAt: null, desktop: "/p.jpg", mobile: null, blockCount: 3, desktopBlocks: [], mobileBlocks: [] }]).steps[0].pages.length === 1);

// 2. Every store at once.
const listed: Store = { n: 1, host: "noproduct.test", brand: "No Product", title: null, platform: "shopify", builder: null, theme: null, themeVersion: null, currency: null, country: null, industry: "other", industryScore: 0, apps: [], collections: null, rank: 5, mentions: 0, sources: [], validatedAt: null } as Store;
const uncaptured: Store = { ...listed, n: 2, host: "never.test", brand: "Never" };
const index = buildIndex([...full, ...noProduct, ...twoProducts, ...extras, ...mockOnly], [listed, uncaptured]);
const all = flowSummaries(index);
check("one summary per captured store, mock-only and uncaptured left out", all.map((s) => s.store.host).sort().join() === "extras.test,full.test,noproduct.test,two.test", all.map((s) => s.store.host).join());
check("complete stores first", all.slice(0, 3).every((s) => s.flow.complete) && !all[3].flow.complete);
check("cart blocks never reach a flow", all.every((s) => s.flow.steps.every((step) => step.pages.every((p) => p.type !== "cart"))));
check("listed store keeps its validated record", all.find((s) => s.store.host === "noproduct.test")?.listed === true);
const counts = flowCounts(all);
check("counts", counts.complete === 3 && counts.captured === 4, JSON.stringify(counts));

// 3. The committed sample: myzoobox has home, two collections and two products (its cart page is left out).
const sample = JSON.parse(readFileSync(new URL("../public/sample/blocks.json", import.meta.url), "utf8")).blocks as Block[];
const stores = JSON.parse(readFileSync(new URL("../public/sample/stores.json", import.meta.url), "utf8")).stores as Store[];
const real = flowSummaries(buildIndex(sample, stores));
const zoo = real.find((s) => s.store.host === "myzoobox.com");
check("sample: myzoobox has a complete flow", Boolean(zoo?.flow.complete));
check("sample: collections and products are two each", zoo?.flow.steps[1].pages.length === 2 && zoo.flow.steps[2].pages.length === 2);

// 4. Drawing a page.
const tall = (h: number) => block("draw.test", "home", "/", { w: 100, h });
const page = pagesFromBlocks([tall(100), tall(100), block("draw.test", "home", "/", { viewport: "mobile", w: 100, h: 50 })])[0];
check("pageView: the wanted viewport", pageView(page, "desktop")?.blocks.length === 2 && pageView(page, "desktop")?.fallback === false);
const onlyDesktop = { ...page, mobileBlocks: [] };
check("pageView: falls back to the other viewport and says so", pageView(onlyDesktop, "mobile")?.viewport === "desktop" && pageView(onlyDesktop, "mobile")?.fallback === true);
check("pageView: ratio sums the blocks", pageView(page, "desktop")?.ratio === 2);
check("pageView: a full screenshot is taken as tall", pageView({ ...page, desktop: "/p.jpg" }, "desktop")?.ratio === Number.POSITIVE_INFINITY);
check("pageView: nothing in either viewport is null", pageView({ ...page, desktopBlocks: [], mobileBlocks: [] }, "desktop") === null);
const ones = [tall(100), tall(100), tall(100)];
const cut = cutBlocks(ones, 1.5);
check("cutBlocks: stops at the cap and cuts the block crossing it", cut.length === 2 && cut[0].cut === null && cut[1].cut === 0.5, JSON.stringify(cut.map((c) => c.cut)));
check("cutBlocks: no cap draws everything", cutBlocks(ones, null).length === 3);
check("cutBlocks: an exact fit is not cut", cutBlocks([tall(75), tall(75), tall(100)], 1.5).every((c) => c.cut === null) && cutBlocks([tall(75), tall(75), tall(100)], 1.5).length === 2);
check("cutBlocks: a sliver left over is not drawn", cutBlocks([tall(149), tall(100)], 1.5).length === 1);

// 5. Capture scale. The mock's blocks, stripped of their mock flag, stand in
// for a full run: 30,000 blocks over the 1,005 listed stores. This proves the
// count and the one-pass grouping hold up at the size SEC-20 is judged at,
// not that 200 stores are captured (the mock never reaches the app's flows).
const scaled = [...sample, ...expandBlocks(sample, stores, 30_000 - sample.length)].map(({ ...b }) => {
  delete (b as Block & { mock?: boolean }).mock;
  return b as Block;
});
const started = performance.now();
const atScale = flowSummaries(buildIndex(scaled, stores));
const ms = performance.now() - started;
const scaleCounts = flowCounts(atScale);
check(`scale: ${scaleCounts.complete} of ${scaleCounts.captured} stores complete in ${Math.round(ms)} ms`, scaleCounts.complete >= 200 && ms < 1500);

console.log(bad ? `\n${bad} failed` : "\nall passed");
process.exit(bad ? 1 : 0);
