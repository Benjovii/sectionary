-- Migration 4: search (SEC-17). Full text, typo tolerance and semantic vectors.
--
-- Full text: one weighted tsvector per block, kept by Postgres itself.
--   A  headline
--   B  AI description, block type and tags (what the tagger says it is)
--   C  the block's copy
-- It replaces blocks_search_idx, which indexed an expression the API had to
-- repeat word for word to use.
--
-- Typo tolerance: search_terms is every word in the corpus with how many
-- blocks use it, trigram-indexed. A query word that is not in it is swapped
-- for the closest word that is ("subscripton" -> "subscription") before the
-- full-text query is built. Refresh it after an import or a tagging run:
--   REFRESH MATERIALIZED VIEW CONCURRENTLY search_terms;
-- (npm run embed does this at the end of every run.)
--
-- Semantic: Voyage embeddings of the AI description. Voyage models return
-- 256, 512, 1024 or 2048 dimensions, never 1536, and nothing has written the
-- column yet, so it is recreated at 1024. embedding_model and embedding_hash
-- record what was embedded, so a changed description or a new model is
-- re-embedded and nothing else is.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- array_to_string is only STABLE; a generated column needs IMMUTABLE. Joining
-- text[] with a space is immutable in fact, so say so.
CREATE OR REPLACE FUNCTION sectionary_join(text[]) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$ SELECT coalesce(array_to_string($1, ' '), '') $$;

DROP INDEX IF EXISTS blocks_search_idx;
ALTER TABLE blocks ADD COLUMN search_tsv tsvector GENERATED ALWAYS AS (
  setweight(to_tsvector('english', coalesce(headline, '')), 'A') ||
  setweight(to_tsvector('english', coalesce(ai_description, '') || ' ' || coalesce(block_type, type_hint) || ' ' || sectionary_join(tags)), 'B') ||
  setweight(to_tsvector('english', left(text, 4000)), 'C')
) STORED;
CREATE INDEX blocks_search_tsv_idx ON blocks USING gin(search_tsv);

CREATE MATERIALIZED VIEW search_terms AS
  SELECT word AS term, ndoc AS docs
  FROM ts_stat($$
    SELECT to_tsvector('simple', coalesce(headline, '') || ' ' || coalesce(ai_description, '') || ' ' || left(text, 4000)) FROM public.blocks
  $$) -- schema-qualified: Postgres 17 builds and refreshes views with an empty search_path
  WHERE length(word) BETWEEN 3 AND 40 AND word ~ '^[a-z][a-z''-]*$';
CREATE UNIQUE INDEX search_terms_term_uidx ON search_terms(term);
CREATE INDEX search_terms_trgm_idx ON search_terms USING gin(term gin_trgm_ops);

DROP INDEX IF EXISTS blocks_embedding_hnsw_idx;
ALTER TABLE blocks
  ALTER COLUMN embedding TYPE vector(1024) USING NULL,
  ADD COLUMN embedding_model text,
  ADD COLUMN embedding_hash text,
  ADD COLUMN embedded_at timestamptz;
CREATE INDEX blocks_embedding_hnsw_idx ON blocks USING hnsw (embedding vector_cosine_ops);
