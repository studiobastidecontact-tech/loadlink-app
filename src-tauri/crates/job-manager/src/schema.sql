-- LoadLink — Schema for the job queue
-- This file is embedded in the binary via include_str! and run on every
-- JobManager initialization. Safe to call multiple times (uses IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS jobs (
    id            TEXT PRIMARY KEY NOT NULL,
    kind          TEXT NOT NULL,
    state         TEXT NOT NULL DEFAULT 'queued',
    progress      REAL NOT NULL DEFAULT 0.0,
    created_at    TEXT NOT NULL,
    started_at    TEXT,
    finished_at   TEXT,
    title         TEXT NOT NULL,
    input_path    TEXT,
    output_path   TEXT,
    error         TEXT,
    metadata      TEXT NOT NULL DEFAULT '{}'
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_jobs_state ON jobs(state);
CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_kind ON jobs(kind);
