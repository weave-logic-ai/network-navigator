-- 001-extensions.sql
-- Enable required PostgreSQL extensions and create helper functions

-- UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Trigram-based fuzzy matching
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Vector storage, HNSW indexes, graph functions, embedding functions
CREATE EXTENSION IF NOT EXISTS ruvector;

-- Levenshtein distance calculations
CREATE EXTENSION IF NOT EXISTS fuzzystrmatch;

-- Helper: generate URL-safe slug from text
CREATE OR REPLACE FUNCTION generate_slug(input TEXT)
RETURNS TEXT AS $$
BEGIN
  RETURN lower(
    regexp_replace(
      regexp_replace(
        trim(input),
        '[^a-zA-Z0-9\s-]', '', 'g'
      ),
      '\s+', '-', 'g'
    )
  );
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Helper: current timestamp in UTC
CREATE OR REPLACE FUNCTION now_utc()
RETURNS TIMESTAMPTZ AS $$
BEGIN
  RETURN CURRENT_TIMESTAMP AT TIME ZONE 'UTC';
END;
$$ LANGUAGE plpgsql STABLE;

-- Helper: auto-update updated_at column
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now_utc();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
