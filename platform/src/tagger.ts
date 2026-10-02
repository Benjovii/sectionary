// AI tagger v1 (SEC-12): block screenshots + DOM context -> Claude (Message
// Batches API) -> block_type, page_role, style_tags, industry, description,
// patterns, has_price/has_reviews/has_video, validated against the taxonomy
// (taxonomy.ts) and stored on the block.
//
//   npm run tag-blocks -- run                  # submit, wait, collect, report (resumable)
//   npm run tag-blocks -- submit [--limit N] [--dry-run]
//   npm run tag-blocks -- status               # poll open batches
//   npm run tag-blocks -- collect              # store results of ended batches
//   npm run tag-blocks -- report [--out file]  # counts, tokens, estimated and actual cost
//
//   npm run tag-blocks -- eval-create          # pick the 200-block eval set (platform/eval/)
//   npm run tag-blocks -- eval-sheet           # HTML sheet to label it by hand
//   npm run tag-blocks -- eval                 # tag all 200, agreement on block_type, fail < 90%
//
// Every command takes --run <label> (default "default"; the eval uses "eval").
// The cost cap applies per label, to what was spent plus what is in flight.
//
// Environment (platform/.env): DATABASE_URL, ANTHROPIC_API_KEY, object storage
// (S3_* or TAGGER_IMAGE_BASE_URL, see tagger-images.ts) and optionally
//   TAGGER_MODEL=sonnet|haiku|<model id>   default sonnet (TAGGER_SONNET_MODEL / TAGGER_HAIKU_MODEL)
//   TAGGER_MAX_COST_USD                    default 150; nothing is submitted past it
//   TAGGER_EVAL_MAX_COST_USD               default 5, the cap for --run eval
//   TAGGER_BATCH_SIZE                      default 2000 requests per batch
//   TAGGER_EXPECTED_OUTPUT_TOKENS          default 300, replaced by the observed average once known
//   TAGGER_POLL_SECONDS                    default 60
//
// Resuming: batches are recorded the moment they are created, and results are
// stored idempotently. Re-running `run` (or `collect`) after a crash picks up
// open batches; blocks already tagged from the same inputs, or waiting in an
// open batch, are not submitted again; failed or invalid answers are.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import postgres from "postgres";
import Anthropic from "@anthropic-ai/sdk";
import { BLOCK_TYPES, PROMPT_VERSION, type BlockTags } from "./taxonomy.js";
import {
  batchCost, blockIdOf, blockTypeAgreement, buildRequest, customIdOf, estimateRequest, inputHash, parseResult,
  planWithinCap, priceOf, resolveModel, sentSize, IMAGE_MAX_SIDE, type BlockInput,
} from "./tagging.js";
import {
  applyOutcome, blockInputs, committedUsd, latestAnswers, ledger, markCollected, observedOutputTokens,
  openBatches, pendingHashes, recordBatch, setBatchStatus, taggedHashes, type SubmittedRequest,
} from "./tagger-store.js";
import { imageSource, prepareImage } from "./tagger-images.js";

try { process.loadEnvFile(resolve(import.meta.dirname, "../.env")); } catch {}

const args = process.argv.slice(2);
const command = args[0];
const flag = (name: string) => args.includes(`--${name}`);
const option = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const runLabel = option("run") ?? (command === "eval" ? "eval" : "default");
const model = resolveModel();
const EVAL_SET = resolve(import.meta.dirname, "../eval/tagger-eval-set.json");
const EVAL_REPORTS = resolve(import.meta.dirname, "../eval/reports");
const EVAL_THRESHOLD = 0.9;
const capUsd = Number(runLabel === "eval" ? process.env.TAGGER_EVAL_MAX_COST_USD || 5 : process.env.TAGGER_MAX_COST_USD || 150);
const batchSize = Math.min(100_000, Number(process.env.TAGGER_BATCH_SIZE || 2000));
const pollMs = 1000 * Number(process.env.TAGGER_POLL_SECONDS || 60);

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) throw new Error("DATABASE_URL is required (set it in platform/.env)");
const sql = postgres(dbUrl, { max: 2, prepare: false, onnotice: () => {} });
let client: Anthropic | null = null;
function anthropic(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is required (set it in platform/.env)");
  return (client ??= new Anthropic());
}
const usd = (n: number) => `$${n.toFixed(n < 1 ? 4 : 2)}`;

// ---------------------------------------------------------------- submit

interface Candidate { block: BlockInput; hash: string; estimate: number }

/** Blocks that need an answer: no tags from these exact inputs yet, and none waiting in an open batch. */
async function candidates(opts: { ids?: string[]; limit: number; force?: boolean }): Promise<{ todo: Candidate[]; noImage: BlockInput[]; current: number; waiting: number }> {
  const price = priceOf(model);
  const expected = Math.max(Number(process.env.TAGGER_EXPECTED_OUTPUT_TOKENS || 300), (await observedOutputTokens(sql, model)) ?? 0);
  const todo: Candidate[] = [];
  const noImage: BlockInput[] = [];
  let current = 0, waiting = 0;
  let after: string | undefined;
  while (todo.length < opts.limit) {
    const page = await blockInputs(sql, { after, limit: 1000, ids: opts.ids });
    if (!page.length) break;
    after = page[page.length - 1].id;
    const ids = page.map((b) => b.id);
    const [tagged, pending] = await Promise.all([opts.force ? new Map<string, string>() : taggedHashes(sql, ids), pendingHashes(sql, ids)]);
    for (const block of page) {
      const hash = inputHash(block, model);
      if (tagged.get(block.id) === hash) { current += 1; continue; }
      if (pending.get(block.id)?.has(hash)) { waiting += 1; continue; }
      if (!block.imageKey) { noImage.push(block); continue; }
      // Before the screenshot is fetched its size is known from the import; assume the largest when it is not.
      const sent = block.imageWidth && block.imageHeight ? sentSize(block.imageWidth, block.imageHeight) : { width: IMAGE_MAX_SIDE, height: IMAGE_MAX_SIDE };
      todo.push({ block, hash, estimate: estimateRequest(block, sent, price, expected).usd });
      if (todo.length >= opts.limit) break;
    }
  }
  return { todo, noImage, current, waiting };
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]); }
  }));
  return out;
}

async function submit(opts: { ids?: string[]; limit?: number; dryRun?: boolean; force?: boolean } = {}): Promise<{ submitted: number; deferred: number }> {
  const { todo, noImage, current, waiting } = await candidates({ ids: opts.ids, limit: opts.limit ?? Infinity, force: opts.force });
  const { spent, inFlight } = await committedUsd(sql, runLabel);
  const plan = planWithinCap(todo, (c) => c.estimate, spent + inFlight, capUsd);
  console.log(`${model} · run "${runLabel}" · ${PROMPT_VERSION}`);
  console.log(`  ${current} blocks already tagged from the same inputs, ${waiting} waiting in open batches, ${noImage.length} without a screenshot (skipped)`);
  console.log(`  ${todo.length} to tag, estimated ${usd(todo.reduce((s, c) => s + c.estimate, 0))}`);
  console.log(`  cap ${usd(capUsd)}: ${usd(spent)} spent, ${usd(inFlight)} in flight -> ${plan.accepted.length} fit (${usd(plan.estimatedUsd)})${plan.deferred.length ? `, ${plan.deferred.length} deferred by the cost cap` : ""}`);
  if (opts.dryRun || !plan.accepted.length) return { submitted: 0, deferred: plan.deferred.length };

  const source = imageSource();
  let submitted = 0;
  const unreadable: string[] = [];
  for (let i = 0; i < plan.accepted.length; i += batchSize) {
    const chunk = plan.accepted.slice(i, i + batchSize);
    const built = await mapLimit(chunk, 8, async (c) => {
      try {
        const image = await prepareImage(await source(c.block.imageKey!));
        return { c, request: buildRequest(c.block, image, model) };
      } catch (e) {
        unreadable.push(`${c.block.imageKey}: ${(e as Error).message}`);
        return null;
      }
    });
    const ready = built.filter((b): b is NonNullable<typeof b> => b !== null);
    if (!ready.length) continue;
    const batch = await anthropic().messages.batches.create({ requests: ready.map((r) => r.request) });
    const requests: SubmittedRequest[] = ready.map(({ c }) => ({ blockId: c.block.id, customId: customIdOf(c.block.id), inputHash: c.hash, estimatedUsd: c.estimate }));
    await recordBatch(sql, { id: batch.id, runLabel, model, estimatedUsd: requests.reduce((s, r) => s + r.estimatedUsd, 0) }, requests);
    submitted += ready.length;
    console.log(`  submitted ${batch.id}: ${ready.length} blocks`);
  }
  if (unreadable.length) {
    console.log(`  ${unreadable.length} screenshots could not be read and were not submitted:`);
    for (const u of unreadable.slice(0, 10)) console.log(`    ${u}`);
  }
  return { submitted, deferred: plan.deferred.length };
}

// ---------------------------------------------------------------- status and collect

async function poll(): Promise<number> {
  const open = await openBatches(sql, runLabel);
  for (const b of open) {
    const remote = await anthropic().messages.batches.retrieve(b.id);
    await setBatchStatus(sql, b.id, remote.processing_status, remote.ended_at);
    const c = remote.request_counts;
    console.log(`  ${b.id} ${remote.processing_status}: ${c.processing} processing, ${c.succeeded} succeeded, ${c.errored} errored, ${c.expired} expired, ${c.canceled} canceled`);
  }
  return open.length;
}

async function collect(): Promise<number> {
  let collected = 0;
  for (const b of await openBatches(sql, runLabel)) {
    const remote = await anthropic().messages.batches.retrieve(b.id);
    await setBatchStatus(sql, b.id, remote.processing_status, remote.ended_at);
    if (remote.processing_status !== "ended") continue;
    const price = priceOf(b.model);
    const counts: Record<string, number> = {};
    for await (const line of await anthropic().messages.batches.results(b.id)) {
      const outcome = parseResult(line.result);
      counts[outcome.status] = (counts[outcome.status] ?? 0) + 1;
      blockIdOf(line.custom_id); // a foreign custom_id is a bug, fail loudly
      await applyOutcome(sql, b.id, line.custom_id, outcome, outcome.usage ? batchCost(outcome.usage, price) : 0, b.model);
    }
    await markCollected(sql, b.id);
    collected += 1;
    console.log(`  collected ${b.id}: ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(", ")}`);
  }
  if (collected) {
    // New block types, tags and descriptions are search vocabulary (migration 0007); `npm run embed` re-embeds the described blocks.
    await sql`REFRESH MATERIALIZED VIEW CONCURRENTLY search_terms`;
    console.log("Refreshed search_terms. Run `npm run embed` to re-embed blocks from their new descriptions.");
  }
  return collected;
}

async function waitAndCollect(): Promise<void> {
  for (;;) {
    await collect();
    const open = await openBatches(sql, runLabel);
    if (!open.length) return;
    console.log(`${open.length} batch(es) still processing; checking again in ${pollMs / 1000}s`);
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

// ---------------------------------------------------------------- report

async function report(extra: string[] = []): Promise<string> {
  const l = await ledger(sql, runLabel);
  const answered = l.requests - (l.byStatus.pending ?? 0);
  const perBlock = answered ? l.actualUsd / answered : null;
  const [{ total }] = await sql`SELECT count(*)::int AS total FROM blocks`;
  const [{ tagged }] = await sql`SELECT count(*)::int AS tagged FROM blocks WHERE tag_input_hash IS NOT NULL`;
  const lines = [
    `# Tagger report: run "${runLabel}"`,
    "",
    `Generated ${new Date().toISOString()} · prompt ${PROMPT_VERSION} · model(s) ${l.models.join(", ") || model}`,
    "",
    "| | |",
    "|---|---|",
    `| Batches | ${l.batches} (${l.open} open) |`,
    `| Requests | ${l.requests} |`,
    ...["succeeded", "invalid", "errored", "expired", "canceled", "pending"].map((s) => `| ${s} | ${l.byStatus[s] ?? 0} |`),
    `| Input tokens (uncached) | ${l.inputTokens.toLocaleString("en")} |`,
    `| Cache write / read tokens | ${l.cacheCreationTokens.toLocaleString("en")} / ${l.cacheReadTokens.toLocaleString("en")} |`,
    `| Output tokens | ${l.outputTokens.toLocaleString("en")} |`,
    `| Estimated cost (at submission) | ${usd(l.estimatedUsd)} |`,
    `| Actual cost (from usage, batch prices) | ${usd(l.actualUsd)} |`,
    `| Cost cap | ${usd(capUsd)} |`,
    `| Actual cost per answered block | ${perBlock === null ? "n/a" : usd(perBlock)} |`,
    `| Projected cost of 30,000 blocks | ${perBlock === null ? "n/a (nothing answered yet)" : `${usd(perBlock * 30000)} (${perBlock * 30000 < 150 ? "under" : "OVER"} $150)`} |`,
    `| Blocks in the database tagged | ${tagged} of ${total} |`,
    "",
    `Actual cost is computed from each answer's token usage at ${model} batch prices (half the standard rate); check it against the Anthropic console.`,
    ...extra,
  ];
  const text = lines.join("\n") + "\n";
  return text;
}

// ---------------------------------------------------------------- eval set

interface EvalBlock {
  key: string;
  blockId: string;
  host: string; pageType: string; pageUrl: string; viewport: string; blockIndex: number;
  typeHint: string; headline: string | null; text: string; imageKey: string | null;
  /** Filled in by a person (eval-sheet). block_type is required for every block; the rest are optional. */
  gold: Omit<Partial<BlockTags>, "block_type"> & { block_type: string | null };
  reviewedBy: string | null;
}
interface EvalSet { version: 1; createdAt: string; selection: string; blocks: EvalBlock[] }
const naturalKey = (b: { host: string; pageUrl: string; viewport: string; blockIndex: number }) => `${b.host}|${b.pageUrl}|${b.viewport}|${b.blockIndex}`;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/**
 * 200 blocks, deterministic for a given database: blocks with a screenshot,
 * one per distinct (site, copy) so the footer repeated on every page counts
 * once, spread round-robin across (site, page type), each stratum in hash order.
 */
async function evalCreate(size: number): Promise<void> {
  try {
    const existing = JSON.parse(await readFile(EVAL_SET, "utf8")) as EvalSet;
    if (existing.blocks.some((b) => b.gold.block_type) && !flag("force")) throw new Error(`${EVAL_SET} already has hand labels; pass --force to replace it`);
  } catch (e) { if ((e as { code?: string }).code !== "ENOENT") throw e; }

  const all = await blockInputs(sql, { limit: 1_000_000 });
  const seen = new Set<string>();
  const strata = new Map<string, BlockInput[]>();
  for (const b of [...all].sort((x, y) => sha(x.id).localeCompare(sha(y.id)))) {
    if (!b.imageKey) continue;
    const copy = `${b.host}|${sha(b.text.replace(/\s+/g, " ").trim().toLowerCase())}`;
    if (seen.has(copy)) continue;
    seen.add(copy);
    const s = `${b.host}|${b.pageType}`;
    strata.set(s, [...(strata.get(s) ?? []), b]);
  }
  const picked: BlockInput[] = [];
  const queues = [...strata.keys()].sort().map((k) => strata.get(k)!);
  while (picked.length < size && queues.some((q) => q.length)) for (const q of queues) if (q.length && picked.length < size) picked.push(q.shift()!);
  if (picked.length < size) console.warn(`Only ${picked.length} distinct blocks with screenshots; the eval set needs ${size}. Import more captures first.`);

  const set: EvalSet = {
    version: 1,
    createdAt: new Date().toISOString(),
    selection: `${picked.length} of ${all.length} blocks (latest captures): with a screenshot, one per distinct site+copy, round-robin over site+page type in sha256(id) order`,
    blocks: picked.map((b) => ({
      key: naturalKey(b), blockId: b.id, host: b.host, pageType: b.pageType, pageUrl: b.pageUrl, viewport: b.viewport,
      blockIndex: b.blockIndex, typeHint: b.typeHint, headline: b.headline, text: b.text.replace(/\s+/g, " ").trim().slice(0, 400),
      imageKey: b.imageKey, gold: { block_type: null }, reviewedBy: null,
    })),
  };
  await mkdir(dirname(EVAL_SET), { recursive: true });
  await writeFile(EVAL_SET, JSON.stringify(set, null, 2) + "\n");
  console.log(`Wrote ${set.blocks.length} blocks to ${EVAL_SET}. Next: npm run tag-blocks -- eval-sheet, label every block, save the file back.`);
}

function publicImageUrl(key: string | null): string {
  if (!key) return "";
  if (/^https?:\/\//.test(key)) return key;
  const base = (process.env.S3_PUBLIC_BASE_URL || process.env.TAGGER_IMAGE_BASE_URL || "").replace(/\/$/, "");
  return base ? `${base}/${key.replace(/^\/+/, "")}` : key;
}

/** A self-contained HTML page: each block's screenshot and context, a form for its labels, and a button that downloads the labelled set. */
async function evalSheet(out: string): Promise<void> {
  const set = JSON.parse(await readFile(EVAL_SET, "utf8")) as EvalSet;
  const data = set.blocks.map((b) => ({ ...b, src: publicImageUrl(b.imageKey) }));
  const { GLOBAL_BLOCK_TYPES, ECOMMERCE_BLOCK_TYPES, PAGE_ROLES, STYLE_TAGS, INDUSTRIES } = await import("./taxonomy.js");
  const html = `<!doctype html><meta charset="utf-8"><title>Tagger eval labels</title>
<style>body{font:14px system-ui;margin:16px;max-width:1100px}article{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:16px;border-top:1px solid #ccc;padding:12px 0}
img{max-width:100%;max-height:600px;object-fit:contain;object-position:top left;background:#eee}small{color:#666}label{display:block;margin:4px 0}select,input[type=text]{width:100%}
.done{background:#f3fbf3}#bar{position:sticky;top:0;background:#fff;padding:8px 0;border-bottom:2px solid #000;z-index:1}</style>
<div id="bar"><b>${data.length} blocks</b> · <span id="count"></span> · reviewer <input id="who" placeholder="your name"> <button id="save">Download labelled set</button>
<small>Replace platform/eval/tagger-eval-set.json with the download. Labels are kept in this browser until then.</small></div>
<div id="list"></div>
<script>
const SET=${JSON.stringify({ ...set, blocks: data })};
const TYPES={global:${JSON.stringify(GLOBAL_BLOCK_TYPES)},ecommerce:${JSON.stringify(ECOMMERCE_BLOCK_TYPES)}};
const ROLES=${JSON.stringify(Object.keys(PAGE_ROLES))},STYLES=${JSON.stringify(STYLE_TAGS)},INDUSTRIES=${JSON.stringify(INDUSTRIES)};
let saved={};try{saved=JSON.parse(localStorage.getItem("tagger-eval")||"{}")}catch{}
const esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const opt=(v,sel,t)=>'<option value="'+v+'"'+(v===sel?' selected':'')+'>'+esc(t??v)+'</option>';
const list=document.getElementById("list");
SET.blocks.forEach((b,i)=>{const g=Object.assign({},b.gold,saved[b.key]||{});const a=document.createElement("article");a.dataset.i=i;
a.innerHTML='<div>'+(b.src?'<img loading="lazy" src="'+esc(b.src)+'">':'<i>no screenshot URL (set S3_PUBLIC_BASE_URL)</i>')+'<p><b>'+(i+1)+'. '+esc(b.host)+'</b> · '+esc(b.pageType)+' · '+esc(b.viewport)+' · hint '+esc(b.typeHint)+'<br><b>'+esc(b.headline||"")+'</b> <small>'+esc(b.text)+'</small></p></div>'
+'<div><label>block_type <select name="block_type"><option value="">(choose)</option><optgroup label="Global">'+Object.entries(TYPES.global).map(([k,d])=>opt(k,g.block_type,k+" — "+d)).join("")+'</optgroup><optgroup label="E-commerce">'+Object.entries(TYPES.ecommerce).map(([k,d])=>opt(k,g.block_type,k+" — "+d)).join("")+'</optgroup></select></label>'
+'<label>page_role <select name="page_role"><option value=""></option>'+ROLES.map(r=>opt(r,g.page_role)).join("")+'</select></label>'
+'<label>industry <select name="industry"><option value=""></option>'+INDUSTRIES.map(r=>opt(r,g.industry)).join("")+'</select></label>'
+'<div>'+STYLES.map(s=>'<label style="display:inline-block;margin-right:8px"><input type="checkbox" name="style" value="'+s+'"'+((g.style_tags||[]).includes(s)?' checked':'')+'> '+s+'</label>').join("")+'</div>'
+['has_price','has_reviews','has_video'].map(k=>'<label><input type="checkbox" name="'+k+'"'+(g[k]?' checked':'')+'> '+k+'</label>').join("")+'</div>';
list.append(a);});
function read(a){const q=n=>a.querySelector('[name="'+n+'"]');const g={block_type:q("block_type").value||null};
if(q("page_role").value)g.page_role=q("page_role").value;if(q("industry").value)g.industry=q("industry").value;
const st=[...a.querySelectorAll('[name=style]:checked')].map(x=>x.value);if(st.length)g.style_tags=st;
for(const k of ['has_price','has_reviews','has_video'])g[k]=q(k).checked;return g;}
function refresh(){let n=0;document.querySelectorAll("article").forEach(a=>{const g=read(a);saved[SET.blocks[a.dataset.i].key]=g;a.classList.toggle("done",!!g.block_type);if(g.block_type)n++;});
document.getElementById("count").textContent=n+" labelled";try{localStorage.setItem("tagger-eval",JSON.stringify(saved))}catch{}}
list.addEventListener("change",refresh);refresh();
document.getElementById("save").onclick=()=>{const who=document.getElementById("who").value.trim();if(!who){alert("Enter your name first");return;}
const out={...SET,blocks:SET.blocks.map(b=>{const g=saved[b.key]||{block_type:null};const {src,...rest}=b;return {...rest,gold:g,reviewedBy:g.block_type?who:null};})};
const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([JSON.stringify(out,null,2)+"\\n"],{type:"application/json"}));a.download="tagger-eval-set.json";a.click();};
</script>`;
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, html);
  console.log(`Wrote ${out} (${data.length} blocks). Open it in a browser, label every block, then save the download over ${EVAL_SET}.`);
}

/** Tag every block of the eval set (resumable), then score block_type agreement over all of them. */
async function evalRun(): Promise<number> {
  const set = JSON.parse(await readFile(EVAL_SET, "utf8")) as EvalSet;
  const unlabelled = set.blocks.filter((b) => !b.gold.block_type);
  const invalid = set.blocks.filter((b) => b.gold.block_type && !(BLOCK_TYPES as string[]).includes(b.gold.block_type));
  if (unlabelled.length || invalid.length || set.blocks.length < 200) {
    console.error(`The eval set is not ready: ${set.blocks.length} blocks${set.blocks.length < 200 ? " (need 200)" : ""}, ${unlabelled.length} without a hand label, ${invalid.length} with a label outside the taxonomy.`);
    console.error("Run npm run tag-blocks -- eval-sheet and label every block. Agreement is only reported over a fully labelled set.");
    return 2;
  }

  // Find each block in this database: by id, else by its natural key.
  const live = await blockInputs(sql, { limit: 1_000_000 });
  const byId = new Map(live.map((b) => [b.id, b]));
  const byKey = new Map(live.map((b) => [naturalKey(b), b]));
  const resolved = set.blocks.map((e) => ({ e, block: byId.get(e.blockId) ?? byKey.get(e.key) ?? null }));
  const missing = resolved.filter((r) => !r.block);
  const ids = resolved.flatMap((r) => (r.block ? [r.block.id] : []));

  // Resume: blocks whose latest eval answer came from the same inputs are not asked again.
  const answers = await latestAnswers(sql, runLabel, ids);
  const toAsk = resolved.filter((r) => r.block && !(["succeeded", "invalid"].includes(answers.get(r.block.id)?.status ?? "") && answers.get(r.block.id)?.inputHash === inputHash(r.block, model)));
  if (toAsk.length) {
    const { deferred } = await submit({ ids: toAsk.map((r) => r.block!.id), force: true, dryRun: flag("dry-run") });
    if (flag("dry-run")) return 0;
    if (deferred) { console.error(`The eval cap (${usd(capUsd)}) defers ${deferred} blocks; raise TAGGER_EVAL_MAX_COST_USD.`); return 1; }
  }
  await waitAndCollect();

  const final = await latestAnswers(sql, runLabel, ids);
  const gold = new Map(resolved.map((r) => [r.e.key, r.e.gold.block_type!]));
  const predicted = new Map(resolved.flatMap((r) => { const a = r.block && final.get(r.block.id); return a?.blockType ? [[r.e.key, a.blockType] as [string, string]] : []; }));
  const agreement = blockTypeAgreement(gold, predicted);
  const pass = agreement.rate >= EVAL_THRESHOLD && agreement.total >= 200;

  const lines = [
    "",
    "## Evaluation",
    "",
    `${agreement.total} hand-labelled blocks (${set.blocks.filter((b) => b.reviewedBy).length} with a reviewer name), all evaluated; ${missing.length} not found in this database count as misses.`,
    "",
    `**block_type agreement: ${agreement.matched}/${agreement.total} = ${(agreement.rate * 100).toFixed(1)}% — ${pass ? "PASS" : "FAIL"} (threshold ${EVAL_THRESHOLD * 100}%)**`,
    "",
    ...(agreement.confusions.length ? ["| gold | predicted | count |", "|---|---|---|", ...agreement.confusions.map((c) => `| ${c.gold} | ${c.predicted} | ${c.count} |`)] : ["No disagreements."]),
  ];
  const text = await report(lines);
  await mkdir(EVAL_REPORTS, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  await writeFile(resolve(EVAL_REPORTS, `tagger-eval-${stamp}.md`), text);
  console.log(text);
  console.log(`Report written to ${resolve(EVAL_REPORTS, `tagger-eval-${stamp}.md`)}`);
  return pass ? 0 : 1;
}

// ---------------------------------------------------------------- main

try {
  if (!["eval-create", "eval-sheet", ""].includes(command ?? "")) {
    const [{ ok }] = await sql`SELECT to_regclass('public.tag_batches') IS NOT NULL AS ok`;
    if (!ok) throw new Error("This database has no tagger tables yet: run `npm run db:migrate` (migrations 0005-0007) first.");
  }
  switch (command) {
    case "submit": await submit({ limit: option("limit") ? Number(option("limit")) : undefined, dryRun: flag("dry-run") }); break;
    case "status": console.log(`${await poll()} open batch(es)`); break;
    case "collect": console.log(`${await collect()} batch(es) collected`); break;
    case "run": {
      await collect(); // finish anything a previous run left behind first
      await submit({ limit: option("limit") ? Number(option("limit")) : undefined, dryRun: flag("dry-run") });
      if (!flag("dry-run")) await waitAndCollect();
      const text = await report();
      if (option("out")) await writeFile(resolve(option("out")!), text);
      console.log(text);
      break;
    }
    case "report": {
      const text = await report();
      if (option("out")) await writeFile(resolve(option("out")!), text);
      console.log(text);
      break;
    }
    case "eval-create": await evalCreate(Number(option("size") ?? 200)); break;
    case "eval-sheet": await evalSheet(resolve(option("out") ?? resolve(import.meta.dirname, "../../data/tagger-eval-review.html"))); break;
    case "eval": process.exitCode = await evalRun(); break;
    default:
      console.log("Usage: npm run tag-blocks -- run | submit [--limit N] [--dry-run] | status | collect | report [--out file] | eval-create | eval-sheet | eval   (each takes --run <label>)");
      process.exitCode = command ? 1 : 0;
  }
} finally {
  await sql.end();
}

