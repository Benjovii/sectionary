-- SEC-25: the landing page's waitlist. One row per address; the form writes
-- here through a server action in web/src/app/(marketing)/welcome/actions.ts.
CREATE TABLE waitlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL,
  source text NOT NULL DEFAULT 'landing', referrer text, user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX waitlist_email_uidx ON waitlist(lower(email));
CREATE INDEX waitlist_created_idx ON waitlist(created_at);
-- Email addresses: RLS on, as on every table in 0001, and no policies, so
-- Supabase's public Data API (anon and authenticated keys) can neither read
-- nor write them. The server action connects as the table owner, which RLS
-- does not apply to.
ALTER TABLE waitlist ENABLE ROW LEVEL SECURITY;
