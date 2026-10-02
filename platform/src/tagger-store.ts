// Tagger persistence (SEC-12, migration 0006). Every write here is safe to repeat:
// recording a batch twice, or collecting its results twice, leaves the same rows.

import type postgres from "postgres";
import { PROMPT_VERSION } from "./taxonomy.js";
import type { BlockInput, Outcome } from "./tagging.js";

type Sql = postgres.Sql;
/**
 * An array parameter as a Postgres literal, cast in SQL. Not sql.array(): with
 * prepare: false, postgres.js sends ["a","b"] as "a,b" until a connection has
 * fetched the server's array types (same fix as web/src/server/db.ts).
 */
const pgArray = (values: readonly string[]) => `{${values.map((v) => `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",")}}`;

/** Blocks to consider, latest capture of each page only, keyset-paged by id. */
export async function blockInputs(sql: Sql, opts: { after?: string; limit: number; ids?: string[] }): Promise<BlockInput[]> {
  const rows = await sql`
    SELECT b.id, s.host, p.type AS page_type, p.url AS page_url, b.viewport, b.block_index, b.top, b.height, b.type_hint,
      b.headline, left(b.text, 2000) AS text, b.buttons, b.images, b.videos, s.industry AS site_industry,
      b.image_key, b.image_width, b.image_height, b.blurhash
    FROM blocks b JOIN captures c ON c.id = b.capture_id JOIN pages p ON p.id = c.page_id JOIN sites s ON s.id = p.site_id
    WHERE c.id = (SELECT c2.id FROM captures c2 WHERE c2.page_id = p.id ORDER BY c2.captured_at DESC LIMIT 1)
      AND b.id > ${opts.after ?? "00000000-0000-0000-0000-000000000000"}
      ${opts.ids ? sql`AND b.id = ANY(${pgArray(opts.ids)}::uuid[])` : sql``}
    ORDER BY b.id LIMIT ${opts.limit}`;
  return rows.map((r) => ({
    id: r.id, host: r.host, pageType: r.page_type, pageUrl: r.page_url, viewport: r.viewport, blockIndex: r.block_index,
    top: r.top, height: r.height, typeHint: r.type_hint, headline: r.headline, text: r.text, buttons: r.buttons,
    images: r.images, videos: r.videos, siteIndustry: r.site_industry, imageKey: r.image_key,
    imageWidth: r.image_width, imageHeight: r.image_height, blurhash: r.blurhash,
  }));
}

/** block id -> the input hash its current tags were made from. */
export async function taggedHashes(sql: Sql, ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const rows = await sql`SELECT id, tag_input_hash FROM blocks WHERE id = ANY(${pgArray(ids)}::uuid[]) AND tag_input_hash IS NOT NULL`;
  return new Map(rows.map((r) => [r.id as string, r.tag_input_hash as string]));
}

/** block id -> input hashes already waiting in a batch, so a resumed run does not submit them again. */
export async function pendingHashes(sql: Sql, ids: string[]): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  if (!ids.length) return out;
  const rows = await sql`SELECT block_id, input_hash FROM tag_requests WHERE status = 'pending' AND block_id = ANY(${pgArray(ids)}::uuid[])`;
  for (const r of rows) out.set(r.block_id, (out.get(r.block_id) ?? new Set()).add(r.input_hash));
  return out;
}

/** Spent (collected batches, actual) plus committed (open batches, estimated) under a run label. */
export async function committedUsd(sql: Sql, runLabel: string): Promise<{ spent: number; inFlight: number }> {
  const [r] = await sql`
    SELECT coalesce(sum(actual_cost_usd) FILTER (WHERE status = 'collected'), 0)::float8 AS spent,
           coalesce(sum(estimated_cost_usd) FILTER (WHERE status <> 'collected'), 0)::float8 AS in_flight
    FROM tag_batches WHERE run_label = ${runLabel}`;
  return { spent: r.spent, inFlight: r.in_flight };
}

/** Average output tokens of answers already received from `model`, to keep estimates honest. */
export async function observedOutputTokens(sql: Sql, model: string): Promise<number | null> {
  const [r] = await sql`
    SELECT avg(q.output_tokens)::float8 AS avg, count(*)::int AS n FROM tag_requests q JOIN tag_batches t ON t.id = q.batch_id
    WHERE t.model = ${model} AND q.output_tokens IS NOT NULL`;
  return r.n >= 20 ? r.avg : null;
}

export interface SubmittedRequest { blockId: string; customId: string; inputHash: string; estimatedUsd: number }

export async function recordBatch(sql: Sql, batch: { id: string; runLabel: string; model: string; estimatedUsd: number }, requests: SubmittedRequest[]): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`
      INSERT INTO tag_batches (id, run_label, model, prompt_version, request_count, estimated_cost_usd)
      VALUES (${batch.id}, ${batch.runLabel}, ${batch.model}, ${PROMPT_VERSION}, ${requests.length}, ${batch.estimatedUsd})
      ON CONFLICT (id) DO NOTHING`;
    for (let i = 0; i < requests.length; i += 1000) {
      const rows = requests.slice(i, i + 1000).map((r) => ({ batch_id: batch.id, custom_id: r.customId, block_id: r.blockId, input_hash: r.inputHash, estimated_cost_usd: r.estimatedUsd }));
      await tx`INSERT INTO tag_requests ${tx(rows)} ON CONFLICT (batch_id, custom_id) DO NOTHING`;
    }
  });
}

export interface OpenBatch { id: string; model: string; status: string; requestCount: number; submittedAt: Date }
export async function openBatches(sql: Sql, runLabel?: string): Promise<OpenBatch[]> {
  const rows = await sql`
    SELECT id, model, status, request_count, submitted_at FROM tag_batches
    WHERE status <> 'collected' ${runLabel ? sql`AND run_label = ${runLabel}` : sql``} ORDER BY submitted_at, id`;
  return rows.map((r) => ({ id: r.id, model: r.model, status: r.status, requestCount: r.request_count, submittedAt: r.submitted_at }));
}

export async function setBatchStatus(sql: Sql, id: string, status: string, endedAt: string | null): Promise<void> {
  await sql`UPDATE tag_batches SET status = ${status}, ended_at = ${endedAt} WHERE id = ${id} AND status <> 'collected'`;
}

/**
 * Store one result. The request row always records what came back; a valid
 * answer also becomes the block's tags. Repeating it changes nothing, and an
 * answer never replaces tags made later from a newer batch.
 */
export async function applyOutcome(sql: Sql, batchId: string, customId: string, outcome: Outcome, costUsd: number, model: string): Promise<void> {
  const u = outcome.usage;
  await sql.begin(async (tx) => {
    const [req] = await tx`
      UPDATE tag_requests SET status = ${outcome.status}, error = ${"error" in outcome ? outcome.error : null},
        response = ${outcome.status === "succeeded" ? tx.json(outcome.tags as never) : null},
        input_tokens = ${u?.input_tokens ?? null}, output_tokens = ${u?.output_tokens ?? null},
        cache_creation_tokens = ${u?.cache_creation_input_tokens ?? null}, cache_read_tokens = ${u?.cache_read_input_tokens ?? null},
        cost_usd = ${costUsd}, updated_at = now()
      WHERE batch_id = ${batchId} AND custom_id = ${customId}
      RETURNING block_id, input_hash`;
    if (!req || outcome.status !== "succeeded") return;
    const t = outcome.tags;
    const [batch] = await tx`SELECT submitted_at FROM tag_batches WHERE id = ${batchId}`;
    await tx`
      UPDATE blocks SET block_type = ${t.block_type}, tags = ${pgArray(t.style_tags)}::text[], ai_description = ${t.description},
        ai_response = ${tx.json({ ...t, model, prompt_version: PROMPT_VERSION, batch_id: batchId } as never)},
        tag_model = ${model}, tag_input_hash = ${req.input_hash}, tagged_at = ${batch.submitted_at}, updated_at = now()
      WHERE id = ${req.block_id} AND (tagged_at IS NULL OR tagged_at <= ${batch.submitted_at})`;
  });
}

/** Close a batch: totals from its request rows, actual cost from their usage. */
export async function markCollected(sql: Sql, batchId: string): Promise<void> {
  await sql`
    UPDATE tag_batches t SET status = 'collected', collected_at = coalesce(t.collected_at, now()),
      actual_cost_usd = s.cost, succeeded = s.succeeded, invalid = s.invalid, errored = s.errored, expired = s.expired, canceled = s.canceled,
      input_tokens = s.input_tokens, output_tokens = s.output_tokens, cache_creation_tokens = s.cache_creation_tokens, cache_read_tokens = s.cache_read_tokens
    FROM (
      SELECT coalesce(sum(cost_usd), 0) AS cost,
        count(*) FILTER (WHERE status = 'succeeded') AS succeeded, count(*) FILTER (WHERE status = 'invalid') AS invalid,
        count(*) FILTER (WHERE status = 'errored') AS errored, count(*) FILTER (WHERE status = 'expired') AS expired,
        count(*) FILTER (WHERE status = 'canceled') AS canceled,
        coalesce(sum(input_tokens), 0) AS input_tokens, coalesce(sum(output_tokens), 0) AS output_tokens,
        coalesce(sum(cache_creation_tokens), 0) AS cache_creation_tokens, coalesce(sum(cache_read_tokens), 0) AS cache_read_tokens
      FROM tag_requests WHERE batch_id = ${batchId}
    ) s WHERE t.id = ${batchId}`;
  // A request the results never mentioned is not left pending forever: it is retried by the next submit.
  await sql`UPDATE tag_requests SET status = 'errored', error = 'missing from batch results', updated_at = now() WHERE batch_id = ${batchId} AND status = 'pending'`;
}

export interface LedgerSummary {
  batches: number; open: number; requests: number;
  byStatus: Record<string, number>;
  estimatedUsd: number; actualUsd: number;
  inputTokens: number; outputTokens: number; cacheCreationTokens: number; cacheReadTokens: number;
  models: string[];
}
export async function ledger(sql: Sql, runLabel: string): Promise<LedgerSummary> {
  const [b] = await sql`
    SELECT count(*)::int AS batches, count(*) FILTER (WHERE status <> 'collected')::int AS open,
      coalesce(sum(estimated_cost_usd), 0)::float8 AS est, coalesce(sum(actual_cost_usd), 0)::float8 AS act,
      coalesce(array_agg(DISTINCT model), '{}') AS models
    FROM tag_batches WHERE run_label = ${runLabel}`;
  const rows = await sql`
    SELECT q.status, count(*)::int AS n, coalesce(sum(q.input_tokens), 0)::float8 AS i, coalesce(sum(q.output_tokens), 0)::float8 AS o,
      coalesce(sum(q.cache_creation_tokens), 0)::float8 AS cw, coalesce(sum(q.cache_read_tokens), 0)::float8 AS cr
    FROM tag_requests q JOIN tag_batches t ON t.id = q.batch_id WHERE t.run_label = ${runLabel} GROUP BY q.status`;
  const sum = (k: "i" | "o" | "cw" | "cr") => rows.reduce((s, r) => s + Number(r[k]), 0);
  return {
    batches: b.batches, open: b.open, requests: rows.reduce((s, r) => s + r.n, 0),
    byStatus: Object.fromEntries(rows.map((r) => [r.status, r.n])),
    estimatedUsd: b.est, actualUsd: b.act, models: (b.models as (string | null)[]).filter((m): m is string => Boolean(m)),
    inputTokens: sum("i"), outputTokens: sum("o"), cacheCreationTokens: sum("cw"), cacheReadTokens: sum("cr"),
  };
}

/** The latest answer per block under a run label (for the eval). */
export async function latestAnswers(sql: Sql, runLabel: string, blockIds: string[]): Promise<Map<string, { status: string; blockType: string | null; inputHash: string }>> {
  const rows = await sql`
    SELECT DISTINCT ON (q.block_id) q.block_id, q.status, q.response->>'block_type' AS block_type, q.input_hash
    FROM tag_requests q JOIN tag_batches t ON t.id = q.batch_id
    WHERE t.run_label = ${runLabel} AND q.block_id = ANY(${pgArray(blockIds)}::uuid[]) AND q.status <> 'pending'
    ORDER BY q.block_id, t.submitted_at DESC`;
  return new Map(rows.map((r) => [r.block_id as string, { status: r.status as string, blockType: r.block_type as string | null, inputHash: r.input_hash as string }]));
}
