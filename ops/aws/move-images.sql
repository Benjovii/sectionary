-- Move image addresses from DigitalOcean Spaces to the AWS image address.
-- Run each part on its own (Supabase SQL editor or psql), in order.
-- Before part 2: put the new address in place of NEW_BASE below (once), no slash at the end,
-- e.g. https://d1234abcd.cloudfront.net or https://img.example.com

-- ── Part 1: dry run. Every text/jsonb column in public that still holds a Spaces address.
-- Expect blocks.image_key, blocks.thumbnail_key, blocks.image_slices, captures.desktop,
-- captures.mobile. Anything else listed here: stop and add it to part 2.
do $$
declare c record; n bigint;
begin
  for c in
    select table_name, column_name from information_schema.columns
    where table_schema = 'public' and data_type in ('text', 'jsonb', 'character varying')
  loop
    execute format('select count(*) from public.%I where %I::text like %L', c.table_name, c.column_name, '%digitaloceanspaces.com%') into n;
    if n > 0 then raise notice '%.%: % rows', c.table_name, c.column_name, n; end if;
  end loop;
end $$;

-- ── Part 2: the rewrite, in one transaction. Both the CDN and the origin Spaces address.
begin;

create temporary table move_base on commit drop as
select 'https://sectionary-blocks.fra1.cdn.digitaloceanspaces.com' as cdn,
       'https://sectionary-blocks.fra1.digitaloceanspaces.com'     as origin,
       'NEW_BASE'                                                   as new;

-- Stops here if NEW_BASE was not filled in.
do $$ begin
  if (select new from move_base) !~ '^https://[^/]+[^/]$' then
    raise exception 'Put the new address in place of NEW_BASE first (https://..., no slash at the end)';
  end if;
end $$;

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

-- Must be 0 and 0. If not: rollback; and tell Buna what it shows.
select (select count(*) from public.blocks where concat(image_key, thumbnail_key, image_slices::text) like '%digitaloceanspaces.com%') as blocks_left,
       (select count(*) from public.captures where concat(desktop::text, mobile::text) like '%digitaloceanspaces.com%') as captures_left;

commit;  -- or: rollback;

-- ── Part 3: run part 1 again. It should print nothing.
