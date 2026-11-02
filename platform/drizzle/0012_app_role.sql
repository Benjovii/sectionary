-- Migration 12: sectionary_app, a database role for the web app with only what it needs.
--
-- The web app has connected as postgres, which owns every table, skips RLS and
-- can drop anything. This role reads every table and writes only the nine the
-- app writes. Migrations and the capture pipeline (platform/) keep the owner role.
--
-- It is created without a password and cannot sign in until one is set, by
-- hand, in Supabase's SQL editor, never in a file (docs/OPS.md, Security):
--   ALTER ROLE sectionary_app WITH LOGIN PASSWORD '...';
-- then DATABASE_URL uses it. Until then nothing changes.
--
-- A new table later needs, in its own migration: the writes it takes
-- (GRANT INSERT ... TO sectionary_app) and, with RLS on, the policy below.
-- Reading comes from the default privileges at the end.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sectionary_app') THEN
    CREATE ROLE sectionary_app NOLOGIN;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO sectionary_app;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO sectionary_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO sectionary_app;

-- What the app writes (web/src/server, web/src/app). ON CONFLICT ... DO UPDATE
-- and SELECT ... FOR UPDATE need UPDATE too; users, sessions and recovery_codes have it.
GRANT INSERT, UPDATE ON users TO sectionary_app;
GRANT INSERT, UPDATE, DELETE ON sessions, boards, board_items, recovery_codes, rate_limits TO sectionary_app;
GRANT INSERT, UPDATE ON paddle_events TO sectionary_app;
GRANT INSERT ON block_views, waitlist TO sectionary_app;

-- Every table has RLS on with no policy for the Data API (migration 11). This
-- role is not the owner, so it needs a policy to see rows; the grants above
-- decide what it may do with them.
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relrowsecurity LOOP
    EXECUTE format('CREATE POLICY "web app" ON public.%I TO sectionary_app USING (true) WITH CHECK (true)', t.relname);
  END LOOP;
END $$;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO sectionary_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO sectionary_app;
