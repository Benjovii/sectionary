// npm test: persistence against a real Postgres (PGlite, every migration applied).
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { startLocalDb, type LocalDb } from "./local-db.js";
import {
  applyOutcome, blockInputs, committedUsd, latestAnswers, ledger, markCollected, openBatches, pendingHashes, recordBatch, setBatchStatus, taggedHashes,
} from "./tagger-store.js";
import { customIdOf, type Outcome } from "./tagging.js";
import type { BlockTags } from "./taxonomy.js";

let local: LocalDb;
let sql: postgres.Sql;
const ids: string[] = [];

const tags = (block_type: BlockTags["block_type"]): BlockTags => ({
  block_type, page_role: "conversion", style_tags: ["minimal"], industry: "pets", description: `A ${block_type}`,
  patterns: ["savings badge"], has_price: true, has_reviews: false, has_video: false,
});
const usage = { input_tokens: 1000, output_tokens: 200, cache_creation_input_tokens: 0, cache_read_input_tokens: 1500 };
const ok = (t: BlockTags): Outcome => ({ status: "succeeded", tags: t, usage });

before(async () => {
  local = await startLocalDb();
  sql = postgres(local.url, { max: 2, prepare: false, onnotice: () => {} });
  const [site] = await sql`INSERT INTO sites (host, origin, industry) VALUES ('nativepet.com', 'https://nativepet.com', 'pets') RETURNING id`;
  const [page] = await sql`INSERT INTO pages (site_id, url, type, slug) VALUES (${site.id}, 'https://nativepet.com/products/x', 'product', 'products-x') RETURNING id`;
  const [capture] = await sql`INSERT INTO captures (page_id, captured_at) VALUES (${page.id}, now()) RETURNING id`;
  for (let i = 0; i < 3; i++) {
    const [b] = await sql`
      INSERT INTO blocks (capture_id, ref, block_index, viewport, type_hint, top, height, width, text, text_length, buttons, images, videos, background, image_key)
      VALUES (${capture.id}, ${`b${i}`}, ${i}, 'desktop', 'main-product', ${i * 500}, 500, 1440, ${`Subscribe and save ${i}`}, 20, 1, 1, 0, '#fff', ${i < 2 ? `/x/${i}.webp` : null})
      RETURNING id`;
    ids.push(b.id);
  }
});
after(async () => { await sql.end(); await local.stop(); });

test("every migration applies on a fresh Postgres 17, in order", () => {
  assert.deepEqual(local.migrations, [
    "0001_schema_v1.sql", "0002_image_pipeline_and_diffs.sql", "0002_waitlist.sql", "0003_boards_sharing.sql",
    "0004_search.sql", "0005_image_slices.sql", "0006_tagger.sql", "0007_search_terms_taxonomy.sql",
  ]);
});

test("blockInputs reads the latest capture's blocks with their site context", async () => {
  const rows = await blockInputs(sql, { limit: 10 });
  assert.equal(rows.length, 3);
  assert.equal(rows[0].host, "nativepet.com");
  assert.equal(rows[0].siteIndustry, "pets");
  assert.deepEqual((await blockInputs(sql, { limit: 10, ids: [ids[1]] })).map((b) => b.id), [ids[1]]);
});

test("recording a batch is idempotent and makes its blocks pending", async () => {
  const requests = ids.slice(0, 2).map((id) => ({ blockId: id, customId: customIdOf(id), inputHash: `h-${id}`, estimatedUsd: 0.004 }));
  await recordBatch(sql, { id: "msgbatch_1", runLabel: "default", model: "claude-sonnet-5-5", estimatedUsd: 0.008 }, requests);
  await recordBatch(sql, { id: "msgbatch_1", runLabel: "default", model: "claude-sonnet-5-5", estimatedUsd: 0.008 }, requests);
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM tag_requests WHERE batch_id = 'msgbatch_1'`;
  assert.equal(n, 2);
  const pending = await pendingHashes(sql, ids);
  assert.ok(pending.get(ids[0])?.has(`h-${ids[0]}`));
  assert.equal(pending.has(ids[2]), false);
  assert.deepEqual(await committedUsd(sql, "default"), { spent: 0, inFlight: 0.008 });
  assert.deepEqual((await openBatches(sql)).map((b) => b.id), ["msgbatch_1"]);
});

test("a valid answer becomes the block's tags; storing it twice changes nothing", async () => {
  const outcome = ok(tags("subscription-picker"));
  await applyOutcome(sql, "msgbatch_1", customIdOf(ids[0]), outcome, 0.0031, "claude-sonnet-5-5");
  const [first] = await sql`SELECT block_type, tags, ai_description, ai_response, tag_model, tag_input_hash, tagged_at, search_tsv::text AS tsv FROM blocks WHERE id = ${ids[0]}`;
  assert.equal(first.block_type, "subscription-picker");
  assert.deepEqual(first.tags, ["minimal"]);
  assert.equal(first.ai_response.has_price, true);
  assert.equal(first.ai_response.prompt_version, "tagger-v1.0");
  assert.equal(first.tag_input_hash, `h-${ids[0]}`);
  assert.match(first.tsv, /'subscript/); // the description and type now feed full-text search

  await applyOutcome(sql, "msgbatch_1", customIdOf(ids[0]), outcome, 0.0031, "claude-sonnet-5-5");
  const [second] = await sql`SELECT block_type, tags, ai_description, ai_response, tag_model, tag_input_hash, tagged_at, search_tsv::text AS tsv FROM blocks WHERE id = ${ids[0]}`;
  assert.deepEqual(second, first);
  assert.equal((await taggedHashes(sql, ids)).get(ids[0]), `h-${ids[0]}`);
});

test("an invalid answer is recorded on the request and leaves the block untagged", async () => {
  await applyOutcome(sql, "msgbatch_1", customIdOf(ids[1]), { status: "invalid", error: "block_type \"x\" is not in the taxonomy", usage }, 0.003, "claude-sonnet-5-5");
  const [req] = await sql`SELECT status, error, output_tokens FROM tag_requests WHERE batch_id = 'msgbatch_1' AND block_id = ${ids[1]}`;
  assert.deepEqual(req, { status: "invalid", error: "block_type \"x\" is not in the taxonomy", output_tokens: 200 });
  const [b] = await sql`SELECT block_type, tag_input_hash FROM blocks WHERE id = ${ids[1]}`;
  assert.deepEqual(b, { block_type: null, tag_input_hash: null });
});

test("collecting a batch totals it, prices it, and turns it from in flight into spent", async () => {
  await setBatchStatus(sql, "msgbatch_1", "ended", new Date().toISOString());
  await markCollected(sql, "msgbatch_1");
  await markCollected(sql, "msgbatch_1"); // again: same totals
  const [b] = await sql`SELECT status, succeeded, invalid, errored, actual_cost_usd::float8 AS cost, input_tokens::int, output_tokens::int, cache_read_tokens::int FROM tag_batches WHERE id = 'msgbatch_1'`;
  assert.deepEqual(b, { status: "collected", succeeded: 1, invalid: 1, errored: 0, cost: 0.0061, input_tokens: 2000, output_tokens: 400, cache_read_tokens: 3000 });
  const committed = await committedUsd(sql, "default");
  assert.ok(Math.abs(committed.spent - 0.0061) < 1e-9 && committed.inFlight === 0);
  assert.deepEqual(await openBatches(sql), []);
  // Collected batches never reopen.
  await setBatchStatus(sql, "msgbatch_1", "in_progress", null);
  assert.deepEqual(await openBatches(sql), []);
});

test("a request missing from the results is marked errored so the next run retries it", async () => {
  await recordBatch(sql, { id: "msgbatch_2", runLabel: "default", model: "claude-sonnet-5-5", estimatedUsd: 0.004 },
    [{ blockId: ids[1], customId: customIdOf(ids[1]), inputHash: `h2-${ids[1]}`, estimatedUsd: 0.004 }]);
  await markCollected(sql, "msgbatch_2");
  const [req] = await sql`SELECT status, error FROM tag_requests WHERE batch_id = 'msgbatch_2'`;
  assert.deepEqual(req, { status: "errored", error: "missing from batch results" });
  assert.equal((await pendingHashes(sql, [ids[1]])).size, 0);
});

test("an answer from an older batch never overwrites tags from a newer one", async () => {
  await sql`INSERT INTO tag_batches (id, model, prompt_version, request_count, estimated_cost_usd, submitted_at) VALUES ('msgbatch_old', 'claude-sonnet-5-5', 'tagger-v1.0', 1, 0.004, now() - interval '1 day')`;
  await sql`INSERT INTO tag_batches (id, model, prompt_version, request_count, estimated_cost_usd, submitted_at) VALUES ('msgbatch_new', 'claude-sonnet-5-5', 'tagger-v1.0', 1, 0.004, now())`;
  for (const b of ["msgbatch_old", "msgbatch_new"]) await sql`INSERT INTO tag_requests (batch_id, custom_id, block_id, input_hash, estimated_cost_usd) VALUES (${b}, ${customIdOf(ids[2])}, ${ids[2]}, ${`h-${b}`}, 0.004)`;
  await applyOutcome(sql, "msgbatch_new", customIdOf(ids[2]), ok(tags("buy-box")), 0.003, "claude-sonnet-5-5");
  await applyOutcome(sql, "msgbatch_old", customIdOf(ids[2]), ok(tags("hero")), 0.003, "claude-sonnet-5-5");
  const [b] = await sql`SELECT block_type, tag_input_hash FROM blocks WHERE id = ${ids[2]}`;
  assert.deepEqual(b, { block_type: "buy-box", tag_input_hash: "h-msgbatch_new" });
});

test("the ledger and the eval's latest answers read back what was stored", async () => {
  const l = await ledger(sql, "default");
  assert.equal(l.batches, 4);
  assert.equal(l.byStatus.succeeded, 3);
  assert.equal(l.byStatus.invalid, 1);
  const answers = await latestAnswers(sql, "default", ids);
  assert.equal(answers.get(ids[2])?.blockType, "buy-box");
  assert.equal(answers.get(ids[0])?.blockType, "subscription-picker");
  assert.equal(answers.get(ids[1])?.status, "errored"); // msgbatch_2 is its latest
});
