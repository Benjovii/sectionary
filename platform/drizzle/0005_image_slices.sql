-- Migration 5: sliced images (SEC-9).
--
-- WebP cannot hold an image taller than 16,383 px, so the image pipeline cuts
-- taller ones into ordered slices (src/images.ts) and lists them in each page's
-- images.json. The importer copies a block's slices here: an array of
-- {index, src, top, width, height}, top to bottom. NULL when the image is one
-- file, which is nearly always; image_key then holds it as before, and for a
-- sliced image image_key is the first (topmost) slice.
-- Viewport screenshots keep theirs inside captures.desktop/mobile (key "image").

ALTER TABLE blocks ADD COLUMN IF NOT EXISTS image_slices jsonb;
