// Search acceptance (SEC-17), deterministic: builds a throwaway Postgres from
// the committed fixtures and runs the app's own search code against it.
//
//   npm run search:acceptance                       # from web/
//   npm run search:acceptance -- --out ../docs/reviews/search-eval.md
//
// 1. A local Postgres 17 (PGlite, platform/src/local-db.ts) with every migration
//    in platform/drizzle applied, unchanged.
// 2. The real importer (platform/src/import.ts) loads fixtures/manifests (the same
//    34 pages as the shared database) and fixtures/search-corpus (product pages
//    of subscription stores, which the first set lacks); it refreshes search_terms.
// 3. searchBlocks() from src/server/search.ts, in process, in three modes:
//    A  full text only (no VOYAGE_API_KEY): the gate, and the production fallback.
//    B  VOYAGE_API_KEY set but the embeddings endpoint failing: must degrade to A.
//    C  full text fused with semantic neighbours. Embeddings come from a local
//       stand-in for Voyage (feature-hashed bag of words, deterministic) via the
//       real `npm run embed`, so pgvector, HNSW and rank fusion all run. It
//       proves the fusion path works; it says nothing about Voyage's quality.
// The acceptance queries and judges are platform/src/search-queries.ts.
// Exit 0 when every scored query passes in every mode.

import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { startLocalDb } from "../../platform/src/local-db.ts";
import { ACCEPTANCE_QUERIES } from "../../platform/src/search-queries.ts";

const run = promisify(execFile);
const here = import.meta.dirname;
const platform = resolve(here, "../../platform");
const args = process.argv.slice(2);
const option = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const corpora = args.includes("--corpus")
  ? args.flatMap((a, i) => (args[i - 1] === "--corpus" ? [resolve(a)] : []))
  : [resolve(here, "../../fixtures/manifests"), resolve(here, "../../fixtures/search-corpus")];

// ---------------------------------------------------------------- a stand-in for Voyage's embeddings endpoint

const DIMENSIONS = 1024;
function fnv(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}
/** Feature hashing over crude stems: texts sharing words point the same way. Deterministic. */
export function standInEmbedding(text: string): number[] {
  const v = new Array<number>(DIMENSIONS).fill(0);
  for (const word of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    if (word.length < 3) continue;
    const h = fnv(word.slice(0, 6));
    v[h % DIMENSIONS] += h & 0x80000000 ? -1 : 1;
  }
  const norm = Math.hypot(...v) || 1;
  return v.map((x) => x / norm);
}
let voyageUp = true;
const voyage = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    if (!voyageUp) { res.writeHead(503).end("stand-in is down"); return; }
    const { input } = JSON.parse(body) as { input: string[] };
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ data: input.map((t, index) => ({ index, embedding: standInEmbedding(t) })) }));
  });
});
await new Promise<void>((r) => voyage.listen(0, "127.0.0.1", r));
const voyageUrl = `http://127.0.0.1:${(voyage.address() as { port: number }).port}`;

// ---------------------------------------------------------------- database and corpus

const local = await startLocalDb();
const env = { ...process.env, DATABASE_URL: local.url, VOYAGE_BASE_URL: voyageUrl, VOYAGE_API_KEY: "stand-in" };
const lines: string[] = [];
const say = (s = "") => { console.log(s); lines.push(s); };
let failed = 0;

try {
  for (const dir of corpora) {
    const { stdout } = await run("npm", ["run", "-s", "import", "--", dir], { cwd: platform, env, shell: true, maxBuffer: 1 << 26 });
    console.log(stdout.trim().split("\n").filter((l) => l.startsWith("Done")).join("\n"));
  }
  const [{ count: blocks }] = (await local.db.query<{ count: number }>("SELECT count(*)::int AS count FROM blocks")).rows;
  const [{ count: sites }] = (await local.db.query<{ count: number }>("SELECT count(*)::int AS count FROM sites")).rows;

  // The app's search, in process. Env is read when it runs: database URL now, Voyage per mode.
  process.env.DATABASE_URL = local.url;
  process.env.VOYAGE_BASE_URL = voyageUrl;
  delete process.env.VOYAGE_API_KEY;
  const { searchBlocks } = await import("@/server/search");

  type Row = { id: string; host: string; pageType: string; typeHint: string; headline: string | null; text: string; ok: boolean | undefined };
  async function evaluate(mode: string) {
    const out: { q: string; ids: string[]; hits: number; min: number; scored: boolean; semantic: boolean; corrected: Record<string, string>; intents: string[]; total: number; rows: Row[] }[] = [];
    for (const { q, relevant, min = 1 } of ACCEPTANCE_QUERIES) {
      const r = await searchBlocks(q, {}, 10, 0);
      // Judge the block's whole stored text, what search indexed, not the API's 400-character excerpt:
      // a buy box's purchase options usually sit past the first 400 characters.
      const full = new Map((await local.db.query<{ id: string; text: string }>("SELECT id::text, text FROM blocks WHERE id = ANY($1::uuid[])", [r.items.map((b) => b.id)])).rows.map((x) => [x.id, x.text]));
      const rows = r.items.map((b) => ({ id: b.id, host: b.host, pageType: b.pageType, typeHint: b.typeHint, headline: b.headline, text: b.text, ok: relevant?.({ headline: b.headline, text: full.get(b.id) ?? b.text }) }));
      out.push({ q, ids: rows.map((x) => x.id), hits: rows.filter((x) => x.ok).length, min, scored: Boolean(relevant), semantic: r.search.semantic, corrected: r.search.corrected, intents: r.search.intents, total: r.total, rows });
    }
    return { mode, results: out };
  }
  const passes = (e: Awaited<ReturnType<typeof evaluate>>) => e.results.every((r) => !r.scored || r.hits >= r.min);
  const same = (a: Awaited<ReturnType<typeof evaluate>>, b: Awaited<ReturnType<typeof evaluate>>) => a.results.every((r, i) => r.ids.join() === b.results[i].ids.join());

  // A: full text only, twice, to show it is repeatable.
  const a = await evaluate("A full text only");
  const a2 = await evaluate("A again");
  // B: a key, but the endpoint fails.
  process.env.VOYAGE_API_KEY = "stand-in";
  voyageUp = false;
  const origError = console.error;
  console.error = () => {}; // search logs "Semantic search skipped" per query; expected here
  const b = await evaluate("B Voyage failing");
  console.error = origError;
  // C: embed the corpus through the stand-in with the real embed script, then fuse.
  voyageUp = true;
  const { stdout: embedOut } = await run("npm", ["run", "-s", "embed"], { cwd: platform, env, shell: true, maxBuffer: 1 << 26 });
  const c = await evaluate("C full text + semantic (stand-in embeddings)");

  const checks: [string, boolean][] = [
    ["A: every scored query has enough relevant results in the top 10", passes(a)],
    ["A: repeat run returns the same ranking", same(a, a2)],
    ["A: semantic is off without VOYAGE_API_KEY", a.results.every((r) => !r.semantic)],
    ["B: a failing embeddings endpoint degrades to full text, same ranking as A", same(a, b) && b.results.every((r) => !r.semantic)],
    ["C: semantic neighbours are fused in", c.results.every((r) => r.semantic)],
    ["C: every scored query still passes with fusion", passes(c)],
  ];
  failed = checks.filter(([, ok]) => !ok).length;

  const date = new Date().toISOString().slice(0, 10);
  say(`# Search acceptance (SEC-17), ${date}`);
  say();
  say(`Generated by \`npm run search:acceptance\` (web/scripts/search-acceptance.mts). Local Postgres 17 (PGlite) with migrations ${local.migrations.join(", ")}; corpus imported with the real importer from ${corpora.map((d) => `\`${d.replace(/\\/g, "/").split("/").slice(-2).join("/")}\``).join(" and ")}: ${blocks} blocks from ${sites} sites. ${embedOut.trim().split("\n").find((l) => l.startsWith("Embedded")) ?? ""}`);
  say();
  for (const [name, ok] of checks) say(`- ${ok ? "PASS" : "FAIL"} ${name}`);
  for (const e of [a, c]) {
    say();
    say(`## Mode ${e.mode}`);
    for (const r of e === a ? e.results : e.results.filter((x) => x.scored)) {
      say();
      const corrected = Object.entries(r.corrected).map(([f, t]) => `${f}→${t}`).join(", ");
      say(`**"${r.q}"** · ${r.total} results${r.intents.length ? ` · block type ${r.intents.join(", ")}` : ""}${corrected ? ` · corrected ${corrected}` : ""}${r.scored ? ` · **${r.hits}/10 relevant (want ${r.min}+) ${r.hits >= r.min ? "PASS" : "FAIL"}**` : ""}`);
      say();
      r.rows.forEach((x, i) => say(`${i + 1}. ${x.ok === undefined ? "" : x.ok ? "✓ " : "✗ "}${x.host} · ${x.pageType} · ${x.typeHint} · ${(x.headline || x.text).replace(/\s+/g, " ").trim().slice(0, 90).replace(/[|*_`]/g, " ")}`));
    }
  }
  say();
  say(failed ? `FAILED: ${failed} check(s)` : "All checks passed.");
  if (option("out")) await writeFile(resolve(option("out")!), lines.join("\n") + "\n");
} finally {
  voyage.close();
  await (globalThis as { sectionarySql?: { end(): Promise<void> } }).sectionarySql?.end();
  await local.stop();
}
process.exitCode = failed ? 1 : 0;
