-- Every image file the database points to on DigitalOcean Spaces, one path per row
-- (e.g. arcticfoxandco.com/home/desktop_thumb.webp). For copying without a Spaces key:
-- the files are public to read, so rclone fetches each one by its address (docs/AWS.md, Images).
-- Run before move-images.sql: afterwards the addresses no longer point to Spaces.
-- Export the result as CSV (Supabase SQL editor: Download → CSV) and save it as keys.txt.
with cols as (
  select image_key as t from public.blocks
  union all select thumbnail_key from public.blocks
  union all select image_slices::text from public.blocks
  union all select desktop::text from public.captures
  union all select mobile::text from public.captures
)
select distinct m[1] as path
from cols, regexp_matches(t, 'sectionary-blocks\.fra1\.(?:cdn\.)?digitaloceanspaces\.com/([^"\s\\?]+)', 'g') as m
order by 1;
