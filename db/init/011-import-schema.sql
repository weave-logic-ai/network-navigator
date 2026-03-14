-- 011-import-schema.sql
-- Import tracking tables: import_sessions, import_files, import_change_log

CREATE TABLE import_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')),
  total_files INTEGER DEFAULT 0,
  processed_files INTEGER DEFAULT 0,
  total_records INTEGER DEFAULT 0,
  new_records INTEGER DEFAULT 0,
  updated_records INTEGER DEFAULT 0,
  skipped_records INTEGER DEFAULT 0,
  error_count INTEGER DEFAULT 0,
  errors JSONB DEFAULT '[]',
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now_utc()
);

CREATE TABLE import_files (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id UUID NOT NULL REFERENCES import_sessions(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  file_type TEXT NOT NULL,
  file_size_bytes INTEGER,
  record_count INTEGER DEFAULT 0,
  processed_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'pending',
  errors JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT now_utc()
);

CREATE TABLE import_change_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id UUID NOT NULL REFERENCES import_sessions(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  change_type TEXT NOT NULL CHECK (change_type IN ('created', 'updated', 'skipped', 'error')),
  field_changes JSONB DEFAULT '{}',
  old_values JSONB DEFAULT '{}',
  new_values JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now_utc()
);

-- Indexes
CREATE INDEX idx_import_files_session_id ON import_files(session_id);
CREATE INDEX idx_import_change_log_session_id ON import_change_log(session_id);
CREATE INDEX idx_import_change_log_contact_id ON import_change_log(contact_id);
