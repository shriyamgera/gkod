-- The parts library: the generator runs that were loaded and the parts they made.
-- Applied once by "python -m gkod_api.migrate". Never edit this file after it is applied;
-- add a new numbered file instead.

CREATE EXTENSION IF NOT EXISTS vector;

-- One row per loaded generator file. A run comes from exactly one file, and a file is one run.
CREATE TABLE runs (
  run_id text PRIMARY KEY CHECK (run_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  source_file text NOT NULL,
  file_sha256 text NOT NULL UNIQUE CHECK (file_sha256 ~ '^[0-9a-f]{64}$'),
  manifest_sha256 text CHECK (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  manifest jsonb,
  rows_read integer NOT NULL DEFAULT 0,
  rows_refused integer NOT NULL DEFAULT 0,
  -- Why rows were refused: reason -> count.
  refused jsonb NOT NULL DEFAULT '{}',
  first_loaded_at timestamptz NOT NULL DEFAULT now(),
  last_loaded_at timestamptz NOT NULL DEFAULT now()
);

-- One row per generated part. Every row names the generator that made it (name, version and commit),
-- its seed and its place in the run, so the training loader can trace each example to its source.
CREATE TABLE parts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id text NOT NULL REFERENCES runs (run_id) ON DELETE CASCADE,
  generator_name text NOT NULL CHECK (generator_name <> ''),
  generator_version text NOT NULL CHECK (generator_version <> ''),
  generator_commit text NOT NULL CHECK (generator_commit ~ '^[0-9a-f]{7,64}$'),
  -- True when the generator ran with uncommitted changes, so its commit alone does not rebuild the part.
  generator_dirty boolean,
  seed bigint NOT NULL,
  part_index integer NOT NULL CHECK (part_index >= 0),
  family text,
  request text NOT NULL CHECK (request <> ''),
  title text,
  tree jsonb,
  facts jsonb,
  code text NOT NULL CHECK (code <> ''),
  labels jsonb NOT NULL DEFAULT '{}',
  -- Read from labels when loading, so they can be filtered and indexed.
  compile_ok boolean,
  checks_ok boolean,
  -- Fields of the generator's row that have no column of their own.
  extra jsonb NOT NULL DEFAULT '{}',
  -- Filled on day 7 (the names mlx-lm uses for its files).
  split text CHECK (split IN ('train', 'valid', 'test')),
  -- Filled on day 8: a 384-number embedding of the request.
  embedding vector(384),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, part_index)
);

-- One per filter of GET /parts, ending in id for its ORDER BY id. run_id is covered by the unique key.
CREATE INDEX parts_family_idx ON parts (family, id);
CREATE INDEX parts_split_idx ON parts (split, id);
CREATE INDEX parts_compile_ok_idx ON parts (compile_ok, id);
CREATE INDEX parts_checks_ok_idx ON parts (checks_ok, id);
