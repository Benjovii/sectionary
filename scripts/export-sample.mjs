// Exports captured blocks from data/index.js into the web app as sample data:
// web/public/sample/blocks.json plus the block images. Until the real database
// exists (SEC-10) this is what the wall shows.
//   node scripts/export-sample.mjs            all captured pages
//   node scripts/export-sample.mjs myzoobox.com   one site only
import { readFileSync, mkdirSync, copyFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import path from "node:path";

const onlyHost = process.argv[2] || null;
const raw = readFileSync("data/index.js", "utf8");
const json = JSON.parse(raw.slice(raw.indexOf("=") + 1).trim().replace(/;\s*$/, ""));
const outDir = path.join("web", "public", "sample");
if (existsSync(outDir)) rmSync(outDir, { recursive: true });
mkdirSync(outDir, { recursive: true });

const blocks = [];
let bytes = 0;
for (const page of json.pages) {
  if (onlyHost && page.site.host !== onlyHost) continue;
  for (const b of page.blocks) {
    if (!b.file) continue;
    const from = path.join("data", page.dir, b.file);
    const rel = path.join(page.dir, b.file).replace(/\\/g, "/");
    const to = path.join(outDir, rel);
    mkdirSync(path.dirname(to), { recursive: true });
    copyFileSync(from, to);
    bytes += readFileSync(from).length;
    blocks.push({
      id: `${page.dir}/${b.viewport}/${b.index}`,
      host: page.site.host,
      pageType: page.page.type,
      pageUrl: page.page.url,
      pageTitle: page.page.title || null,
      viewport: b.viewport,
      typeHint: b.typeHint,
      headline: b.headline,
      bg: b.bg,
      w: b.width,
      h: b.height,
      src: `/sample/${rel}`,
      platform: page.site.platform || null,
      theme: page.site.theme?.name || null,
      apps: page.site.apps || [],
      buttons: b.buttons,
      images: b.images,
      videos: b.videos,
      text: (b.text || "").slice(0, 400),
    });
  }
}
writeFileSync(path.join(outDir, "blocks.json"), JSON.stringify({ generatedAt: new Date().toISOString(), blocks }));
console.log(`${blocks.length} blocks, ${(bytes / 1e6).toFixed(1)} MB of images -> ${outDir}`);
