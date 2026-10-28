-- Migration 10: the 7-day Pro trial and two-step sign-in (authenticator apps).
--
-- Trial: every account gets Pro for seven days from its first sign-in, with no
-- card. trial_ends_at is set when the users row is created; accounts that
-- already exist get seven days from now. After it, Free (docs/AUTH-AND-BILLING.md).
--
-- Two-step: an optional authenticator-app code (TOTP, RFC 6238) after the email
-- link. The secret is encrypted by the app (AES-256-GCM, AUTH_ENCRYPTION_KEY)
-- before it is stored. totp_last_step is the last 30-second step accepted, so
-- one code cannot be used twice. Recovery codes are stored only as SHA-256.
-- A session row with mfa_pending=true is the ten minutes between the email
-- link and the code: it signs nobody in.

ALTER TABLE users
  ADD COLUMN trial_ends_at timestamptz,
  ADD COLUMN totp_secret text,
  ADD COLUMN totp_pending_secret text,
  ADD COLUMN totp_enabled_at timestamptz,
  ADD COLUMN totp_last_step bigint;
UPDATE users SET trial_ends_at = now() + interval '7 days' WHERE trial_ends_at IS NULL;

CREATE TABLE recovery_codes (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash text NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, code_hash)
);

ALTER TABLE sessions
  ADD COLUMN mfa_pending boolean NOT NULL DEFAULT false,
  ADD COLUMN mfa_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN next_path text;

ALTER TABLE recovery_codes ENABLE ROW LEVEL SECURITY;
