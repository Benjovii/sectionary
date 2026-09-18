CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE sites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), host text NOT NULL UNIQUE, origin text NOT NULL,
  brand text, title text, platform text, builder text, theme_name text, theme_version text, theme jsonb,
  apps text[] NOT NULL DEFAULT '{}', currency text, locale text, country text,
  industry text NOT NULL DEFAULT 'other', industry_score real NOT NULL DEFAULT 0, rank integer,
  mentions integer NOT NULL DEFAULT 0, sources text[] NOT NULL DEFAULT '{}', validated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sites_platform_idx ON sites(platform); CREATE INDEX sites_theme_idx ON sites(theme_name);
CREATE INDEX sites_industry_idx ON sites(industry); CREATE INDEX sites_country_idx ON sites(country);
CREATE INDEX sites_rank_idx ON sites(rank); CREATE INDEX sites_apps_gin_idx ON sites USING gin(apps);
CREATE INDEX sites_search_idx ON sites USING gin(to_tsvector('simple', coalesce(host,'') || ' ' || coalesce(brand,'') || ' ' || coalesce(title,'')));

CREATE TABLE pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), site_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  url text NOT NULL, type text NOT NULL, slug text NOT NULL, title text, description text, canonical text,
  og_image text, lang text, h1 text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(site_id, url)
);
CREATE INDEX pages_site_idx ON pages(site_id); CREATE INDEX pages_type_idx ON pages(type);

CREATE TABLE captures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), page_id uuid NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  captured_at timestamptz NOT NULL, desktop jsonb, mobile jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(page_id, captured_at)
);
CREATE INDEX captures_page_idx ON captures(page_id); CREATE INDEX captures_time_idx ON captures(captured_at DESC);

CREATE TABLE blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), capture_id uuid NOT NULL REFERENCES captures(id) ON DELETE CASCADE,
  ref text NOT NULL, block_index integer NOT NULL, viewport text NOT NULL CHECK (viewport IN ('desktop','mobile')),
  type_hint text NOT NULL, block_type text, tags text[] NOT NULL DEFAULT '{}', parent_type text, tag text,
  element_id text, classes text, top integer NOT NULL, height integer NOT NULL, width integer NOT NULL,
  text text NOT NULL, text_length integer NOT NULL, headline text, buttons integer NOT NULL,
  images integer NOT NULL, videos integer NOT NULL, background text NOT NULL, image_key text,
  ai_description text, embedding vector(1536), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(capture_id, viewport, block_index)
);
CREATE INDEX blocks_capture_idx ON blocks(capture_id); CREATE INDEX blocks_viewport_idx ON blocks(viewport);
CREATE INDEX blocks_type_hint_idx ON blocks(type_hint); CREATE INDEX blocks_block_type_idx ON blocks(block_type);
CREATE INDEX blocks_tags_gin_idx ON blocks USING gin(tags);
CREATE INDEX blocks_search_idx ON blocks USING gin(to_tsvector('english', coalesce(headline,'') || ' ' || coalesce(text,'') || ' ' || coalesce(type_hint,'')));
CREATE INDEX blocks_embedding_hnsw_idx ON blocks USING hnsw (embedding vector_cosine_ops);

CREATE TABLE taxonomy (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), kind text NOT NULL, key text NOT NULL, label text NOT NULL,
  synonyms text[] NOT NULL DEFAULT '{}', parent_id uuid REFERENCES taxonomy(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(kind,key)
);
CREATE INDEX taxonomy_kind_idx ON taxonomy(kind); CREATE INDEX taxonomy_synonyms_gin_idx ON taxonomy USING gin(synonyms);

CREATE TABLE site_tech (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), site_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  kind text NOT NULL, name text NOT NULL, version text, metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(site_id,kind,name)
);
CREATE INDEX site_tech_site_idx ON site_tech(site_id); CREATE INDEX site_tech_kind_name_idx ON site_tech(kind,name);

CREATE TABLE users (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE, email text, name text, avatar_url text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE orgs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL REFERENCES users(id), name text NOT NULL, slug text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX orgs_owner_idx ON orgs(owner_id);
CREATE TABLE boards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES users(id), name text NOT NULL, description text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX boards_org_idx ON boards(org_id); CREATE INDEX boards_created_by_idx ON boards(created_by);
CREATE TABLE board_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), board_id uuid NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  block_id uuid NOT NULL REFERENCES blocks(id) ON DELETE CASCADE, added_by uuid NOT NULL REFERENCES users(id), note text,
  position integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(board_id,block_id)
);
CREATE INDEX board_items_board_position_idx ON board_items(board_id,position); CREATE INDEX board_items_block_idx ON board_items(block_id); CREATE INDEX board_items_added_by_idx ON board_items(added_by);
CREATE TABLE takedown_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), requester_user_id uuid REFERENCES users(id), email text NOT NULL,
  host text NOT NULL, reason text NOT NULL, status text NOT NULL DEFAULT 'pending', resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX takedown_user_idx ON takedown_requests(requester_user_id); CREATE INDEX takedown_host_idx ON takedown_requests(host); CREATE INDEX takedown_status_idx ON takedown_requests(status);

ALTER TABLE sites ENABLE ROW LEVEL SECURITY; ALTER TABLE pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE captures ENABLE ROW LEVEL SECURITY; ALTER TABLE blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE taxonomy ENABLE ROW LEVEL SECURITY; ALTER TABLE site_tech ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY; ALTER TABLE orgs ENABLE ROW LEVEL SECURITY;
ALTER TABLE boards ENABLE ROW LEVEL SECURITY; ALTER TABLE board_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE takedown_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sites are publicly readable" ON sites FOR SELECT USING (true);
CREATE POLICY "blocks are publicly readable" ON blocks FOR SELECT USING (true);
CREATE POLICY "users read own profile" ON users FOR SELECT USING (id = auth.uid());
CREATE POLICY "users create own profile" ON users FOR INSERT WITH CHECK (id = auth.uid());
CREATE POLICY "users update own profile" ON users FOR UPDATE USING (id = auth.uid()) WITH CHECK (id = auth.uid());
CREATE POLICY "org owners manage orgs" ON orgs FOR ALL USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE POLICY "org owners manage boards" ON boards FOR ALL
  USING (EXISTS (SELECT 1 FROM orgs WHERE orgs.id = boards.org_id AND orgs.owner_id = auth.uid()))
  WITH CHECK (created_by = auth.uid() AND EXISTS (SELECT 1 FROM orgs WHERE orgs.id = boards.org_id AND orgs.owner_id = auth.uid()));
CREATE POLICY "org owners manage board items" ON board_items FOR ALL
  USING (EXISTS (SELECT 1 FROM boards JOIN orgs ON orgs.id = boards.org_id WHERE boards.id = board_items.board_id AND orgs.owner_id = auth.uid()))
  WITH CHECK (added_by = auth.uid() AND EXISTS (SELECT 1 FROM boards JOIN orgs ON orgs.id = boards.org_id WHERE boards.id = board_items.board_id AND orgs.owner_id = auth.uid()));
CREATE POLICY "users create takedowns" ON takedown_requests FOR INSERT WITH CHECK (requester_user_id IS NULL OR requester_user_id = auth.uid());
CREATE POLICY "users read own takedowns" ON takedown_requests FOR SELECT USING (requester_user_id = auth.uid());

GRANT SELECT ON sites, blocks TO anon, authenticated;
GRANT SELECT, UPDATE ON users TO authenticated;
GRANT ALL ON orgs, boards, board_items, takedown_requests TO authenticated;
