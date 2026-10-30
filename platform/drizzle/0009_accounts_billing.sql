-- Migration 9: accounts, sessions, plans and Paddle billing (SEC-27, SEC-28).
--
-- Sign-in is a Supabase magic link (token-hash pattern): Supabase sends the
-- email and verifies the link, and the user lands in auth.users as usual. The
-- app does not use Supabase sessions after that. It upserts a row in `users`
-- (same id as auth.users) and gives the browser its own session: a random
-- token in an httpOnly cookie, stored here only as a SHA-256, the same rule as
-- board edit tokens. One cookie, no JWT refresh, nothing for Safari's tracking
-- protection to drop.
--
-- The plan lives on the user. Paddle (merchant of record) tells us about it
-- through webhooks; every webhook is kept in paddle_events, which also makes a
-- redelivered event a no-op. plan_event_at is the occurred_at of the event that
-- last set the plan, so an older event that arrives late cannot undo a newer one.

ALTER TABLE users
  ADD COLUMN plan text NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro', 'team')),
  ADD COLUMN plan_status text,
  ADD COLUMN plan_seats integer NOT NULL DEFAULT 1,
  ADD COLUMN plan_renews_at timestamptz,
  ADD COLUMN plan_cancel_at timestamptz,
  ADD COLUMN plan_event_at timestamptz,
  ADD COLUMN paddle_customer_id text,
  ADD COLUMN paddle_subscription_id text,
  ADD COLUMN last_sign_in_at timestamptz;
CREATE UNIQUE INDEX users_email_uidx ON users(lower(email));
CREATE INDEX users_paddle_customer_idx ON users(paddle_customer_id);
CREATE INDEX users_paddle_subscription_idx ON users(paddle_subscription_id);

CREATE TABLE sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX sessions_user_idx ON sessions(user_id);
CREATE INDEX sessions_expires_idx ON sessions(expires_at);

CREATE TABLE paddle_events (
  event_id text PRIMARY KEY,
  event_type text NOT NULL,
  occurred_at timestamptz NOT NULL,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  outcome text NOT NULL,
  payload jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX paddle_events_user_idx ON paddle_events(user_id);

-- The Free plan's daily view cap counts distinct blocks opened per viewer per
-- UTC day. A viewer is "u:<user id>" when signed in, "a:<random id>" from a
-- cookie when not. Opening the same block again the same day is free.
CREATE TABLE block_views (
  viewer text NOT NULL,
  day date NOT NULL,
  block_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (viewer, day, block_id)
);
CREATE INDEX block_views_day_idx ON block_views(day);

-- Boards get an owner. Token boards from before accounts keep working, and the
-- first signed-in request that carries a board's token claims it.
ALTER TABLE boards ADD COLUMN owner_id uuid REFERENCES users(id) ON DELETE CASCADE;
CREATE INDEX boards_owner_idx ON boards(owner_id);

-- No policies: Supabase's Data API (anon and authenticated keys) gets nothing.
-- The app connects as the table owner, which RLS does not apply to.
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE paddle_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE block_views ENABLE ROW LEVEL SECURITY;
-- users had "update own profile" for authenticated: with plan columns on the
-- row, that would let anyone with a Supabase session give themselves Team.
DROP POLICY "users update own profile" ON users;
DROP POLICY "users create own profile" ON users;
REVOKE UPDATE ON users FROM authenticated;
