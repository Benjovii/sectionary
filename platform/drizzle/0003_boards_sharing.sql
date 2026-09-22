-- Migration 3: boards that work before accounts exist, and public share links.
--
-- Until auth lands (SEC-27) a board is owned by whoever holds its edit token:
-- the API returns the token once, at creation, and stores only its SHA-256.
-- org_id, created_by and added_by become optional so an anonymous board is
-- valid; when accounts arrive, claiming a board fills them in.
--
-- share_slug is the public, read-only address (/b/<slug>). It exists from
-- creation but serves nothing until `shared` is true, so a link can be turned
-- off without changing it, and turned back on without breaking the one the
-- client already has.

ALTER TABLE boards
  ALTER COLUMN org_id DROP NOT NULL,
  ALTER COLUMN created_by DROP NOT NULL,
  ADD COLUMN share_slug text,
  ADD COLUMN shared boolean NOT NULL DEFAULT false,
  ADD COLUMN edit_token_hash text;

UPDATE boards SET share_slug = encode(gen_random_bytes(8), 'hex') WHERE share_slug IS NULL;
ALTER TABLE boards ALTER COLUMN share_slug SET NOT NULL;
CREATE UNIQUE INDEX boards_share_slug_uidx ON boards(share_slug);

ALTER TABLE board_items ALTER COLUMN added_by DROP NOT NULL;
