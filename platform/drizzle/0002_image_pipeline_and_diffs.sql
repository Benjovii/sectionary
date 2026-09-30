-- Migration 2: Add image pipeline support and capture diffs

-- Add new columns to blocks table for image metadata
ALTER TABLE blocks
ADD COLUMN thumbnail_key text,
ADD COLUMN blurhash text,
ADD COLUMN image_width integer,
ADD COLUMN image_height integer,
ADD COLUMN ai_response jsonb;

-- Create capture_diffs table to track changes between capture versions
CREATE TABLE capture_diffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id uuid NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  from_capture_id uuid NOT NULL REFERENCES captures(id) ON DELETE CASCADE,
  to_capture_id uuid NOT NULL REFERENCES captures(id) ON DELETE CASCADE,
  added_block_count integer NOT NULL DEFAULT 0,
  removed_block_count integer NOT NULL DEFAULT 0,
  changed_block_count integer NOT NULL DEFAULT 0,
  summary jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX capture_diffs_page_idx ON capture_diffs(page_id);
CREATE INDEX capture_diffs_from_idx ON capture_diffs(from_capture_id);
CREATE INDEX capture_diffs_to_idx ON capture_diffs(to_capture_id);
