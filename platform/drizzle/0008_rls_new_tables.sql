-- Migration 8: row-level security on the tables added since 0001.
--
-- Supabase exposes the public schema through its Data API, and its default
-- grants let the anon and authenticated keys read and write any table there
-- that has no row-level security. 0002_image_pipeline_and_diffs (capture_diffs)
-- and 0006_tagger (tag_batches, tag_requests) created tables without it.
-- RLS on, with no policies, closes them to those keys; the app, the importer and
-- the tagger connect as the table owner, which RLS does not apply to.
-- Safe to run where it is already on (capture_diffs on the live database since 2 Oct).
ALTER TABLE capture_diffs ENABLE ROW LEVEL SECURITY;
ALTER TABLE tag_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE tag_requests ENABLE ROW LEVEL SECURITY;
