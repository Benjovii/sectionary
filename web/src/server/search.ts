import type { Block } from "@/contracts/block";
import { database, pgArray } from "@/server/db";
import { blockColumns, blockJoins, blockWhere, facetCounts, toBlock, type BlockFilters, type Facet } from "@/server/blocks";
import { detectIntents, editDistance, intentTerms, maxEdits } from "@/server/search-intent";

type Sql = ReturnType<typeof database>;
/** One part of the query: OR-ed websearch terms, counted as `weight` query words when a block matches. */
type Group = { terms: string[]; weight: number };

// Search (SEC-17): full text and semantic, fused.
//
// 0. Block types. Words that name a type from the taxonomy, typos included
//    ("subscripton pickr"), become one group: the type as tagged, or the copy
//    that marks it ("subscribe & save", "deliver every"). See search-intent.ts.
// 1. Typo tolerance. Each other query word the corpus has never seen gets its
//    closest word in search_terms (trigram similarity) if it is a typo away, so
//    "savngs" searches for "savings"; known words pick up close forms.
// 2. Full text over headline (A), AI description, type and tags (B) and copy
//    (C), any word matching, ranked by how many of the query's words a block
//    has, then by where they sit.
// 3. Semantic: the query embedded by Voyage, nearest AI descriptions by cosine
//    distance (HNSW). Skipped, not failed, without VOYAGE_API_KEY or when
//    Voyage is slow: search degrades to full text.
// 4. Reciprocal rank fusion: score = sum of 1 / (60 + rank) over both lists.
//    Rank-based, so the two scores never need calibrating against each other.
//
// Tuning, all optional: SEARCH_MIN_SIMILARITY (default 0.3) drops semantic
// neighbours less similar than that; VOYAGE_MODEL must match `npm run embed`.

const CANDIDATES = 200; // from each list
const RRF_K = 60;
const MODEL = process.env.VOYAGE_MODEL || "voyage-3.5";
/** VOYAGE_BASE_URL is for a proxy or a local stand-in; unset, it is Voyage itself. */
const ENDPOINT = `${process.env.VOYAGE_BASE_URL?.replace(/\/$/, "") ?? "https://api.voyageai.com"}/v1/embeddings`;
const MIN_SIMILARITY = Number(process.env.SEARCH_MIN_SIMILARITY ?? 0.3);
const EMBED_TIMEOUT_MS = 2500;

/** Lowercase words, no punctuation. Numbers stay: "3 month plan" is a real query. */
export function queryWords(q: string): string[] {
  return [...new Set(q.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "").match(/[a-z0-9]+(?:'[a-z]+)?/g) ?? [])].slice(0, 12);
}

/**
 * One group per query word: the word, plus what the corpus vocabulary adds.
 * - A word the corpus has never seen gets its closest word ("savngs" -> "savings"),
 *   but only one a typo away (one edit, two from eight letters): a real word the
 *   corpus lacks ("badge") is searched as typed, never swapped for "bad".
 * - A word it knows gets up to three close forms sharing its first four letters
 *   ("subscription" -> "subscribe", "subscriptions"), because the English stemmer
 *   keeps "subscript" and "subscrib" apart and people mean both.
 * Stop words are left alone; they match nothing anyway.
 */
async function expand(sql: Sql, words: string[]): Promise<{ groups: string[][]; corrected: Record<string, string> }> {
  const extra = new Map<string, string[]>();
  const corrected: Record<string, string> = {};
  const candidates = words.filter((w) => w.length >= 4 && /^[a-z]/.test(w));
  if (candidates.length) {
    try {
      const rows = await sql`
        SELECT w, known, array(
          SELECT term FROM search_terms
          WHERE term % w AND term <> w AND (NOT known OR (left(term, 4) = left(w, 4) AND similarity(term, w) >= 0.5))
          ORDER BY similarity(term, w) DESC, docs DESC LIMIT CASE WHEN known THEN 3 ELSE 5 END
        ) AS near
        FROM unnest(${pgArray(candidates)}::text[]) AS w,
          LATERAL (SELECT EXISTS (SELECT 1 FROM search_terms WHERE term = w) AS known) k
        WHERE to_tsvector('english', w) <> ''::tsvector`;
      for (const r of rows) {
        const w = r.w as string;
        const near = r.known ? (r.near as string[]) : (r.near as string[]).filter((t) => editDistance(w, t, maxEdits(w)) <= maxEdits(w)).slice(0, 1);
        if (!near.length) continue;
        extra.set(w, near);
        if (!r.known) corrected[w] = near[0];
      }
    } catch (error) {
      // Before migration 0004 there is no vocabulary: search the words as typed.
      if ((error as { code?: string }).code !== "42P01") throw error;
    }
  }
  return { groups: words.map((w) => [w, ...(extra.get(w) ?? [])]), corrected };
}

// A few hundred searches repeat all day (the same chips, the same demo query).
const embedCache = new Map<string, number[]>();

async function embedQuery(q: string): Promise<number[] | null> {
  const key = process.env.VOYAGE_API_KEY;
  if (!key) return null;
  const cacheKey = `${MODEL}\n${q.toLowerCase()}`;
  const hit = embedCache.get(cacheKey);
  if (hit) return hit;
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ input: [q], model: MODEL, input_type: "query", output_dimension: 1024 }),
      signal: AbortSignal.timeout(EMBED_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Voyage ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const vector = ((await res.json()) as { data: { embedding: number[] }[] }).data[0].embedding;
    if (embedCache.size > 500) embedCache.delete(embedCache.keys().next().value!);
    embedCache.set(cacheKey, vector);
    return vector;
  } catch (error) {
    console.error("Semantic search skipped:", error);
    return null;
  }
}

type Candidate = { id: string; score: number };

/**
 * Both lists, fused. Filters apply inside each list, so every candidate is a real result.
 *
 * The full-text list ranks by how many of the query's words a block has (each
 * word group counts once, however often it repeats, and a block-type group as
 * many words as it stands for), then by where they are:
 * ts_rank weighs headline and description above copy. Without the first key a
 * header that says "Subscriptions" twice beats a block that says "subscribe
 * and save 20%".
 */
async function candidates(sql: Sql, f: BlockFilters, groups: Group[], vector: string | null): Promise<Candidate[]> {
  const where = blockWhere(sql, f);
  // websearch syntax with "or" between terms: nothing to escape, stop words drop out.
  const any = groups.flatMap((g) => g.terms).join(" or ");
  const each = groups.map((g) => g.terms.join(" or "));
  const weights = groups.map((g) => String(g.weight));
  return sql.begin(async (tx) => {
    // A stop word ("with") makes an empty query; Postgres says so as a NOTICE on every row.
    await tx`SET LOCAL client_min_messages = warning`;
    // Enough of the graph explored that a filtered scan still finds CANDIDATES rows.
    if (vector) await tx`SET LOCAL hnsw.ef_search = ${sql.unsafe(String(CANDIDATES))}`;
    const rows = await tx`
      WITH words AS (
        SELECT q, w FROM unnest(${pgArray(each)}::text[], ${pgArray(weights)}::int[]) AS t(term, w), websearch_to_tsquery('english', term) AS q WHERE numnode(q) > 0
      ), fts AS (
        SELECT id, row_number() OVER (ORDER BY coverage DESC, weight DESC, id) AS r FROM (
          SELECT b.id,
            (SELECT coalesce(sum(w), 0) FROM words WHERE b.search_tsv @@ words.q) AS coverage,
            ts_rank(b.search_tsv, query, 1) AS weight
          FROM ${blockJoins(sql)}, websearch_to_tsquery('english', ${any}) AS query
          WHERE ${where} AND b.search_tsv @@ query
        ) matched
        ORDER BY r LIMIT ${CANDIDATES}
      ), sem AS (
        SELECT id, row_number() OVER (ORDER BY d, id) AS r FROM (
          SELECT b.id, b.embedding <=> ${vector}::vector AS d
          FROM ${blockJoins(sql)}
          WHERE ${vector}::text IS NOT NULL AND b.embedding IS NOT NULL AND ${where}
          ORDER BY d LIMIT ${CANDIDATES}
        ) nearest WHERE d <= ${1 - MIN_SIMILARITY}
      ), fused AS (
        SELECT id, sum(1.0 / (${RRF_K} + r)) AS score FROM (SELECT * FROM fts UNION ALL SELECT * FROM sem) lists GROUP BY id
      )
      SELECT id, score::float8 AS score FROM fused ORDER BY score DESC, id`;
    return rows.map((r) => ({ id: r.id, score: r.score }));
  });
}

export type SearchResult = {
  items: Block[];
  total: number;
  nextCursor: string | null;
  /** First page only, see searchBlocks. */
  facets?: Record<string, Facet[]>;
  nearMiss?: Record<string, number>;
  /** How the query was read, for the UI and for debugging relevance. */
  search: { terms: string[]; corrected: Record<string, string>; semantic: boolean; intents: string[] };
};

/** The query as groups: words naming a block type become that type's group (when `intents`); the rest are corrected and expanded one by one. */
async function readQuery(sql: Sql, words: string[], intents: boolean): Promise<{ groups: Group[]; corrected: Record<string, string>; intents: string[] }> {
  const found = intents ? detectIntents(words) : [];
  const named = new Set(found.flatMap((i) => i.words));
  const expanded = await expand(sql, words.filter((w) => !named.has(w)));
  return {
    groups: [
      ...found.map((i) => ({ terms: intentTerms(i.type), weight: i.words.length })),
      ...expanded.groups.map((terms) => ({ terms, weight: 1 })),
    ],
    corrected: expanded.corrected,
    intents: found.map((i) => i.type),
  };
}

/**
 * One page of search results. With `withFacets` (the first page), facets and
 * near misses too, counted by facetCounts over the candidates the query finds
 * with no filters, plus the filtered ones, so a facet shows what its other
 * values would add. Each list is capped at CANDIDATES, so on a broad query the
 * counts describe the best matches rather than every match.
 */
export async function searchBlocks(q: string, f: BlockFilters, limit: number, offset: number, withFacets = true): Promise<SearchResult> {
  const sql = database();
  const words = queryWords(q);
  const [first, embedding] = await Promise.all([readQuery(sql, words, true), embedQuery(q.trim())]);
  const vector = embedding ? `[${embedding.join(",")}]` : null;
  const filtered = Object.keys(f).length > 0;
  let query = first;
  if (!query.groups.length && !vector) {
    return { items: [], total: 0, nextCursor: null, ...(withFacets && (await withoutQuery(sql, f))), search: { terms: [], corrected: query.corrected, semantic: false, intents: query.intents } };
  }

  const rank = (groups: Group[]) => Promise.all([
    candidates(sql, f, groups, vector),
    withFacets && filtered ? candidates(sql, {}, groups, vector) : null,
  ]);
  let [ranked, pool] = await rank(query.groups);
  // Nothing in the corpus looks like the block type the query names: search its words as typed instead of showing nothing.
  if (!ranked.length && query.intents.length) {
    query = await readQuery(sql, words, false);
    [ranked, pool] = await rank(query.groups);
  }
  const { groups, corrected, intents: types } = query;
  const page = ranked.slice(offset, offset + limit);
  const [rows, counts] = await Promise.all([
    page.length ? sql`SELECT ${blockColumns(sql)} FROM ${blockJoins(sql)} WHERE b.id = ANY(${pgArray(page.map((c) => c.id))}::uuid[])` : [],
    withFacets ? facetCounts(sql, f, [...new Set([...ranked, ...(pool ?? [])].map((c) => c.id))]) : null,
  ]);
  const byId = new Map(rows.map((r) => [r.id as string, toBlock(r)]));
  // Nothing found: say how many blocks these filters hold without the search.
  const nearMiss = counts && ranked.length === 0 ? { ...counts.nearMiss, ...(await withoutQuery(sql, f)).nearMiss } : counts?.nearMiss;

  return {
    items: page.map((c) => byId.get(c.id)).filter((b): b is Block => Boolean(b)),
    total: ranked.length,
    nextCursor: offset + page.length < ranked.length ? String(offset + page.length) : null,
    ...(counts && { facets: counts.facets, nearMiss }),
    search: { terms: groups.flatMap((g) => g.terms), corrected, semantic: Boolean(vector), intents: types },
  };
}

/** Facets and the `q` near miss for a search that found nothing: the same filters, no query. */
async function withoutQuery(sql: Sql, f: BlockFilters): Promise<{ facets: Record<string, Facet[]>; nearMiss: Record<string, number> }> {
  const { facets, total } = await facetCounts(sql, f);
  return { facets: Object.fromEntries(Object.keys(facets).map((key) => [key, [] as Facet[]])), nearMiss: total > 0 ? { q: total } : {} };
}
