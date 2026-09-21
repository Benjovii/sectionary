// Contact sheets for reviewing a crawl by eye: for every captured store, the
// top of its home, product and collection page at desktop and mobile width.
// Overlays that spoil captures (consent dialogs, newsletter popups, bot walls,
// closure notices) sit at the top of the page, so they show up here at a glance.
//
//   npm run review-sheets                 -> data/_review/sheet-01.jpg, ...
//   npm run review-sheets -- --per-sheet 5 --only partial,failed
//   npm run review-sheets -- --seed seeds/pilot-50.csv     only the stores of one seed file
//
// No image library: the sheets are small HTML pages that the already installed
// Chromium turns into JPEGs.
import { chromium } from 'playwright';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pageSlug } from './capture-page.js';
import { parseCsv } from './csv.js';

type StoreRow = { host: string; platform: string | null; status: string; pages_ok: number; pages_total: number; blocks: number; reason: string | null };
type PageRow = { url: string; type: string; status: string; blocks: number };

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const arg = (name: string, fallback: string) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback);
  const out = arg('--out', 'data');
  const perSheet = Number(arg('--per-sheet', '5'));
  const only = arg('--only', '').split(',').filter(Boolean);

  const db = new DatabaseSync(path.join(out, 'queue.sqlite'), { readOnly: true });
  let stores = db.prepare(`select host, platform, status, pages_ok, pages_total, blocks, reason from stores where status in ('done', 'partial', 'failed', 'skipped') order by (rank is null), rank, host`).all() as StoreRow[];
  if (only.length) stores = stores.filter((s) => only.includes(s.status));
  const seed = arg('--seed', '');
  if (seed) {
    const wanted = new Set(parseCsv(readFileSync(seed, 'utf8')).map((r) => r.host));
    stores = stores.filter((s) => wanted.has(s.host));
  }
  const pagesOf = db.prepare(`select url, type, status, blocks from pages where host = ? order by captured_at`);

  const reviewDir = path.join(out, '_review');
  await mkdir(reviewDir, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1840, height: 900 } });

  let sheet = 0;
  for (let i = 0; i < stores.length; i += perSheet) {
    sheet++;
    const rows = stores.slice(i, i + perSheet).map((s) => {
      const pages = pagesOf.all(s.host) as PageRow[];
      // One page of each kind is enough to judge a store: home, a product, a collection.
      const shown = ['home', 'product', 'collection'].map((t) => pages.find((p) => p.type === t && p.status !== 'failed' && p.status !== 'skipped')).filter((p): p is PageRow => Boolean(p));
      const shots = shown
        .map((p) => {
          const dir = `../${s.host}/${pageSlug(new URL(p.url))}`;
          const has = (f: string) => existsSync(path.join(out, s.host, pageSlug(new URL(p.url)), f));
          return `<figure><figcaption>${esc(p.type)} · ${p.blocks} blocks</figcaption><div class="pair">${has('desktop.jpg') ? `<img class="d" src="${dir}/desktop.jpg">` : '<div class="d none">no desktop</div>'}${has('mobile.jpg') ? `<img class="m" src="${dir}/mobile.jpg">` : '<div class="m none">no mobile</div>'}</div></figure>`;
        })
        .join('');
      const label = `<b>${esc(s.host)}</b><br>${esc(s.platform || 'unknown')}<br><span class="${s.status}">${s.status}</span> · ${s.pages_ok}/${s.pages_total} pages<br>${s.blocks} blocks${s.reason ? `<br><i>${esc(s.reason.slice(0, 90))}</i>` : ''}`;
      return `<section><div class="label">${label}</div>${shots || '<div class="empty">nothing captured</div>'}</section>`;
    });
    const html = `<!doctype html><meta charset="utf-8"><style>
      body{margin:0;padding:12px;background:#111;color:#ddd;font:13px/1.35 system-ui,sans-serif;width:1816px}
      section{display:flex;gap:14px;align-items:flex-start;padding:10px 0;border-bottom:1px solid #333}
      .label{width:170px;flex:none;word-break:break-word} .label i{color:#f99} .done{color:#7d7} .partial{color:#fc6} .failed,.skipped{color:#f77}
      figure{margin:0} figcaption{color:#999;margin-bottom:4px} .pair{display:flex;gap:6px}
      img.d,.d{width:400px;height:250px;object-fit:cover;object-position:top;background:#222} img.m,.m{width:116px;height:250px;object-fit:cover;object-position:top;background:#222}
      .none,.empty{display:flex;align-items:center;justify-content:center;color:#666}
    </style>${rows.join('')}`;
    const htmlFile = path.join(reviewDir, `sheet-${String(sheet).padStart(2, '0')}.html`);
    await writeFile(htmlFile, html, 'utf8');
    await page.goto('file:///' + path.resolve(htmlFile).replace(/\\/g, '/'));
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.screenshot({ path: htmlFile.replace(/\.html$/, '.jpg'), fullPage: true, type: 'jpeg', quality: 80 });
  }
  await browser.close();
  db.close();
  console.log(`${sheet} sheet(s) for ${stores.length} store(s) -> ${reviewDir}`);
}

main();
