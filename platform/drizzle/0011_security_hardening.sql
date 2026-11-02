-- Migration 11: close Supabase's Data API to the app's tables, and rate limits.
--
-- The app never uses Supabase's Data API (PostgREST): the server talks to
-- Postgres directly with DATABASE_URL, and Supabase Auth only proves email
-- addresses. But migration 1 granted the anon and authenticated roles access
-- to some tables, with policies from an earlier org-based design. Anyone
-- signed in to Supabase Auth could create orgs, boards and board items through
-- the Data API, skipping the plan gates and the app's checks, and every table
-- made since was granted to both roles by Supabase's default privileges (RLS
-- with no policy kept those closed). Here every grant and policy goes, so the
-- Data API sees nothing even if it stays switched on. Switch it off as well
-- (docs/OPS.md, Security).
--
-- rate_limits: one counter per key and window (web/src/server/rate-limit.ts).
-- Keys are hashes, never an email address or IP in the clear.

DROP POLICY IF EXISTS "sites are publicly readable" ON sites;
DROP POLICY IF EXISTS "blocks are publicly readable" ON blocks;
DROP POLICY IF EXISTS "users read own profile" ON users;
DROP POLICY IF EXISTS "org owners manage orgs" ON orgs;
DROP POLICY IF EXISTS "org owners manage boards" ON boards;
DROP POLICY IF EXISTS "org owners manage board items" ON board_items;
DROP POLICY IF EXISTS "users create takedowns" ON takedown_requests;
DROP POLICY IF EXISTS "users read own takedowns" ON takedown_requests;

CREATE TABLE rate_limits (
  key text NOT NULL,
  window_start timestamptz NOT NULL,
  hits integer NOT NULL DEFAULT 0,
  PRIMARY KEY (key, window_start)
);
ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
-- Tables made later by this role (the one running migrations) are not granted either.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
