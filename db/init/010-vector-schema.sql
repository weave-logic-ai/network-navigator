-- 010-vector-schema.sql
-- Embedding tables with HNSW indexes: profile_embeddings, content_embeddings, company_embeddings

CREATE TABLE profile_embeddings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  embedding RUVECTOR(384) NOT NULL,
  source_text TEXT,
  model TEXT NOT NULL DEFAULT 'all-MiniLM-L6-v2',
  created_at TIMESTAMPTZ DEFAULT now_utc(),
  updated_at TIMESTAMPTZ DEFAULT now_utc(),
  UNIQUE(contact_id)
);

CREATE TABLE content_embeddings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  content_type TEXT NOT NULL,
  content_ref TEXT,
  embedding RUVECTOR(384) NOT NULL,
  source_text TEXT,
  model TEXT NOT NULL DEFAULT 'all-MiniLM-L6-v2',
  created_at TIMESTAMPTZ DEFAULT now_utc()
);

CREATE TABLE company_embeddings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  embedding RUVECTOR(384) NOT NULL,
  source_text TEXT,
  model TEXT NOT NULL DEFAULT 'all-MiniLM-L6-v2',
  created_at TIMESTAMPTZ DEFAULT now_utc(),
  updated_at TIMESTAMPTZ DEFAULT now_utc(),
  UNIQUE(company_id)
);

-- HNSW indexes for vector similarity search
CREATE INDEX idx_profile_embeddings_hnsw ON profile_embeddings
  USING hnsw (embedding ruvector_cosine_ops)
  WITH (m = 16, ef_construction = 200);

CREATE INDEX idx_content_embeddings_hnsw ON content_embeddings
  USING hnsw (embedding ruvector_cosine_ops)
  WITH (m = 16, ef_construction = 200);

CREATE INDEX idx_company_embeddings_hnsw ON company_embeddings
  USING hnsw (embedding ruvector_cosine_ops)
  WITH (m = 16, ef_construction = 200);

-- updated_at triggers
CREATE TRIGGER trg_profile_embeddings_updated_at
  BEFORE UPDATE ON profile_embeddings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_company_embeddings_updated_at
  BEFORE UPDATE ON company_embeddings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
