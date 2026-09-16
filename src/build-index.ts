// Aggregates every data/<site>/<page>/manifest.json into data/index.js, which
// viewer/index.html loads with a plain <script> tag (works from file://, no server).
import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export async function buildIndex(dataDir: string): Promise<number> {
  const pages: unknown[] = [];
  let sites: string[] = [];
  try {
    sites = await readdir(dataDir);
  } catch {
    sites = [];
  }
  for (const site of sites) {
    const siteDir = path.join(dataDir, site);
    if (!(await stat(siteDir)).isDirectory()) continue;
    for (const page of await readdir(siteDir)) {
      const mf = path.join(siteDir, page, 'manifest.json');
      try {
        const json = JSON.parse(await readFile(mf, 'utf8'));
        json.dir = `${site}/${page}`;
        pages.push(json);
      } catch {
        /* not a page folder */
      }
    }
  }
  const out = `window.SECTIONARY_DATA = ${JSON.stringify({ generatedAt: new Date().toISOString(), pages })};\n`;
  await writeFile(path.join(dataDir, 'index.js'), out, 'utf8');
  return pages.length;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = process.argv[2] || 'data';
  buildIndex(dir).then((n) => console.log(`index.js written with ${n} page(s) -> ${path.join(dir, 'index.js')}`));
}
