// Semantic search vectors (SEC-17): Voyage embeddings of each block's AI description.
//
//   npm run embed                 # embed every block that is new or changed
//   npm run embed -- --dry-run    # count what would be embedded, call nothing
//   npm run embed -- --limit 500  # stop after 500 blocks
//
// Requires DATABASE_URL and VOYAGE_API_KEY in platform/.env. VOYAGE_MODEL
// defaults to voyage-3.5; the web app must use the same model for queries.
//
// A block is embedded from its AI description. Until the tagger has written
// one, it is embedded from its type, headline and copy instead, so semantic
// search works from the first import. embedding_hash records exactly what was
// embedded (model + input), so when a description arrives, or the model
// changes, the block is embedded again and nothing else is.
//
// Ends by refreshing search_terms, the vocabulary behind typo tolerance.

import { createHash } from "node:crypto";
import { resolve } from "node:path";
import postgres from "postgres";

try { process.loadEnvFile(resolve(import.meta.dirname, "../.env")); } catch {}

const DIMENSIONS = 1024; // blocks.embedding is vector(1024), see migration 0004
const BATCH = 128; // inputs per Voyage request (the API allows 1,000)
const MAX_INPUT_CHARS = 2000;

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const limitAt = args.indexOf("--limit");
const limit = limitAt >= 0 ? Number(args[limitAt + 1]) : Infinity;

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) throw new Error("DATABASE_URL is required (set it in platform/.env)");
const apiKey = process.env.VOYAGE_API_KEY;
if (!apiKey && !dryRun) throw new Error("VOYAGE_API_KEY is required (set it in platform/.env), or pass --dry-run");
const model = process.env.VOYAGE_MODEL || "voyage-3.5";
// VOYAGE_BASE_URL is for a proxy or a local stand-in; unset, it is Voyage itself.
const endpoint = `${process.env.VOYAGE_BASE_URL?.replace(/\/$/, "") ?? "https://api.voyageai.com"}/v1/embeddings`;

const sql = postgres(dbUrl, { max: 1, prepare: false });

type Row = { id: string; ai_description: string | null; block_type: string | null; type_hint: string; headline: string | null; text: string; embedding_hash: string | null };

/** What a block is embedded from. The description is the point; the rest is the fallback until it exists. */
function embeddingInput(b: Omit<Row, "id" | "embedding_hash">): string {
  const kind = (b.block_type ?? b.type_hint).replace(/-/g, " ");
  const body = b.ai_description?.trim()
    ? b.ai_description.trim()
    : [b.headline?.trim(), b.text.replace(/\s+/g, " ").trim()].filter(Boolean).join(". ");
  return `${kind} block. ${body}`.slice(0, MAX_INPUT_CHARS);
}

const hashOf = (input: string) => createHash("sha256").update(`${model}\n${input}`).digest("hex");

async function voyage(inputs: string[]): Promise<number[][]> {
  for (let attempt = 0; ; attempt += 1) {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ input: inputs, model, input_type: "document", output_dimension: DIMENSIONS, truncation: true }),
    });
    if (res.ok) {
      const body = (await res.json()) as { data: { index: number; embedding: number[] }[] };
      return body.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
    }
    // Rate limits and the odd 5xx: back off and try again, a few times.
    if ((res.status === 429 || res.status >= 500) && attempt < 5) {
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      continue;
    }
    throw new Error(`Voyage ${res.status}: ${await res.text()}`);
  }
}

try {
  let seen = 0, embedded = 0, skipped = 0;
  // Keyset over id, so a long run neither rescans nor holds a cursor open.
  let after = "00000000-0000-0000-0000-000000000000";
  while (seen < limit) {
    const rows = await sql<Row[]>`
      SELECT id, ai_description, block_type, type_hint, headline, left(text, ${MAX_INPUT_CHARS}) AS text, embedding_hash
      FROM blocks WHERE id > ${after} ORDER BY id LIMIT ${Math.min(1000, limit - seen)}`;
    if (!rows.length) break;
    after = rows[rows.length - 1].id;
    seen += rows.length;

    const todo = rows
      .map((r) => ({ id: r.id, input: embeddingInput(r), old: r.embedding_hash }))
      .map((r) => ({ ...r, hash: hashOf(r.input) }))
      .filter((r) => r.hash !== r.old);
    skipped += rows.length - todo.length;
    if (dryRun) {
      embedded += todo.length;
      continue;
    }

    for (let i = 0; i < todo.length; i += BATCH) {
      const chunk = todo.slice(i, i + BATCH);
      const vectors = await voyage(chunk.map((c) => c.input));
      const values = chunk.map((c, j) => [c.id, `[${vectors[j].join(",")}]`, c.hash]);
      await sql`
        UPDATE blocks b SET embedding = v.embedding::vector, embedding_model = ${model}, embedding_hash = v.hash, embedded_at = now()
        FROM (VALUES ${sql(values)}) AS v(id, embedding, hash)
        WHERE b.id = v.id::uuid`;
      embedded += chunk.length;
      console.log(`  embedded ${embedded} (${seen} blocks read)`);
    }
  }

  console.log(`${dryRun ? "Would embed" : "Embedded"} ${embedded} blocks with ${model}; ${skipped} already current.`);
  if (!dryRun) {
    await sql`REFRESH MATERIALIZED VIEW CONCURRENTLY search_terms`;
    console.log("Refreshed search_terms.");
  }
} finally {
  await sql.end();
}
