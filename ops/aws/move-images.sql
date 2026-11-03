-- Move the stored image addresses from DigitalOcean Spaces to CloudFront.
--
-- Why: the importer saves each image's full address (https://sectionary-blocks.fra1.cdn.
-- digitaloceanspaces.com/<path>) in the database, and the site shows whatever is stored.
-- The files are already copied to S3 under the same <path>, so only the front of each
-- address changes: .../digitaloceanspaces.com/<path>  →  https://d1jstas0718wp8.cloudfront.net/<path>
--
-- Supabase SQL editor: select one part with the mouse and click Run (it runs only the
-- selection). Each Run is its own connection, so part 2 must run whole, in one go.
-- Safe to run again: rows already moved are left alone.

-- ── Part 1: check (changes nothing). Which columns still hold a Spaces address, and how many rows.
-- Expect blocks.image_key, blocks.thumbnail_key, blocks.image_slices, captures.desktop,
-- captures.mobile. Any other column listed: stop, it would be missed by part 2.
-- After part 2 this returns no rows.
select table_name, column_name, rows
from (
  select table_name, column_name,
         (xpath('/row/n/text()', query_to_xml(format(
           'select count(*) as n from public.%I where %I::text like %L',
           table_name, column_name, '%digitaloceanspaces.com%'), false, true, '')))[1]::text::bigint as rows
  from information_schema.columns
  where table_schema = 'public' and data_type in ('text', 'jsonb', 'character varying')
) counts
where rows > 0
order by 1, 2;

-- ── Part 2: the rewrite. All or nothing: if the check at the end finds a Spaces address
-- left, it raises an error and Postgres undoes every change in this part.
begin;

create temporary table move_base on commit drop as
select 'https://sectionary-blocks.fra1.cdn.digitaloceanspaces.com' as cdn,     -- old, with CDN
       'https://sectionary-blocks.fra1.digitaloceanspaces.com'     as origin,  -- old, without CDN
       'https://d1jstas0718wp8.cloudfront.net'                     as new;     -- new, no slash at the end

update public.blocks b set
  image_key     = replace(replace(b.image_key,     m.cdn, m.new), m.origin, m.new),
  thumbnail_key = replace(replace(b.thumbnail_key, m.cdn, m.new), m.origin, m.new),
  image_slices  = replace(replace(b.image_slices::text, m.cdn, m.new), m.origin, m.new)::jsonb
from move_base m
where b.image_key like '%digitaloceanspaces.com%'
   or b.thumbnail_key like '%digitaloceanspaces.com%'
   or b.image_slices::text like '%digitaloceanspaces.com%';

update public.captures c set
  desktop = replace(replace(c.desktop::text, m.cdn, m.new), m.origin, m.new)::jsonb,
  mobile  = replace(replace(c.mobile::text,  m.cdn, m.new), m.origin, m.new)::jsonb
from move_base m
where c.desktop::text like '%digitaloceanspaces.com%'
   or c.mobile::text like '%digitaloceanspaces.com%';

do $$ declare b bigint; c bigint; begin
  select count(*) into b from public.blocks
   where concat(image_key, thumbnail_key, image_slices::text) like '%digitaloceanspaces.com%';
  select count(*) into c from public.captures
   where concat(desktop::text, mobile::text) like '%digitaloceanspaces.com%';
  if b > 0 or c > 0 then
    raise exception 'Still on Spaces after the rewrite: % blocks, % captures. Nothing was changed.', b, c;
  end if;
end $$;

commit;

-- How many rows now point at CloudFront (should match part 1's counts).
select (select count(*) from public.blocks   where image_key like 'https://d1jstas0718wp8.cloudfront.net/%') as blocks_on_cloudfront,
       (select count(*) from public.captures where concat(desktop::text, mobile::text) like '%d1jstas0718wp8.cloudfront.net%') as captures_on_cloudfront;

-- ── Part 3: run part 1 again. No rows = done.
--
-- Later, for a custom domain: same script with the cloudfront.net address as the old one
-- and the new domain as `new`.
