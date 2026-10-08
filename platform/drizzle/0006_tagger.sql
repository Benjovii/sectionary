-- Migration 6: AI tagger (SEC-12). A ledger of Batch API jobs, so a run can stop
-- and resume, never submits a block twice, and can account for every dollar.
--
-- tag_batches   one row per Anthropic message batch (id = the batch id), with its
--               estimated cost when submitted and its actual cost once collected.
--               run_label groups batches under one cost cap ("default", "eval").
-- tag_requests  one row per block in a batch: the input hash it was built from,
--               what came back (status, error, parsed answer, tokens, cost).
-- blocks        tag_model / tag_input_hash / tagged_at say what the current tags
--               were made from, so only new or changed blocks are tagged again.

CREATE TABLE IF NOT EXISTS tag_batches (
  id text PRIMARY KEY,
  run_label text NOT NULL DEFAULT 'default',
  model text NOT NULL,
  prompt_version text NOT NULL,
  status text NOT NULL DEFAULT 'in_progress', -- the API's processing_status, then 'collected'
  request_count integer NOT NULL,
  estimated_cost_usd numeric(12, 6) NOT NULL,
  actual_cost_usd numeric(12, 6),
  succeeded integer, invalid integer, errored integer, expired integer, canceled integer,
  input_tokens bigint, output_tokens bigint, cache_creation_tokens bigint, cache_read_tokens bigint,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  collected_at timestamptz
);
CREATE INDEX IF NOT EXISTS tag_batches_status_idx ON tag_batches(status);
CREATE INDEX IF NOT EXISTS tag_batches_label_idx ON tag_batches(run_label);

CREATE TABLE IF NOT EXISTS tag_requests (
  batch_id text NOT NULL REFERENCES tag_batches(id) ON DELETE CASCADE,
  custom_id text NOT NULL,
  block_id uuid NOT NULL REFERENCES blocks(id) ON DELETE CASCADE,
  input_hash text NOT NULL,
  estimated_cost_usd numeric(12, 6) NOT NULL,
  status text NOT NULL DEFAULT 'pending', -- pending | succeeded | invalid | errored | expired | canceled
  error text,
  response jsonb,
  input_tokens integer, output_tokens integer, cache_creation_tokens integer, cache_read_tokens integer,
  cost_usd numeric(12, 6),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (batch_id, custom_id)
);
CREATE INDEX IF NOT EXISTS tag_requests_block_idx ON tag_requests(block_id);
CREATE INDEX IF NOT EXISTS tag_requests_pending_idx ON tag_requests(block_id) WHERE status = 'pending';

ALTER TABLE blocks
  ADD COLUMN IF NOT EXISTS tag_model text,
  ADD COLUMN IF NOT EXISTS tag_input_hash text,
  ADD COLUMN IF NOT EXISTS tagged_at timestamptz;
