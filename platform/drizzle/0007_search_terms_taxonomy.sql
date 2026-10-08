-- Migration 7: typo tolerance knows the tagger's words (SEC-17, SEC-12).
--
-- search_terms (migration 0004) is the vocabulary a query word is corrected
-- against. It was built from headline, AI description and copy only, while
-- blocks.search_tsv also indexes block_type and tags. So once blocks are tagged
-- "subscription-picker", the query word "picker" was still unknown to the
-- vocabulary and got "corrected" to "pick", missing exactly those blocks.
-- Same view, plus block_type and tags. Refreshed by the importer, `npm run embed`
-- and `npm run tag-blocks -- collect`.

DROP MATERIALIZED VIEW IF EXISTS search_terms;
CREATE MATERIALIZED VIEW search_terms AS
  SELECT word AS term, ndoc AS docs
  FROM ts_stat($$
    SELECT to_tsvector('simple', coalesce(headline, '') || ' ' || coalesce(ai_description, '') || ' ' || coalesce(block_type, '') || ' ' || public.sectionary_join(tags) || ' ' || left(text, 4000)) FROM public.blocks
  $$) -- schema-qualified: Postgres 17 builds and refreshes views with an empty search_path
  WHERE length(word) BETWEEN 3 AND 40 AND word ~ '^[a-z][a-z''-]*$';
CREATE UNIQUE INDEX search_terms_term_uidx ON search_terms(term);
CREATE INDEX search_terms_trgm_idx ON search_terms USING gin(term gin_trgm_ops);
