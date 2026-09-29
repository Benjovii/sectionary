-- SEC-25: the landing page's waitlist. One row per address; the form writes
-- here through a server action in web/src/app/(marketing)/welcome/actions.ts.
CREATE TABLE waitlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL,
  source text NOT NULL DEFAULT 'landing', referrer text, user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX waitlist_email_uidx ON waitlist(lower(email));
CREATE INDEX waitlist_created_idx ON waitlist(created_at);
