-- 013-cache-graph-schema.sql
-- page_cache (with 5-version rotation trigger), graph_metrics, selector_configs

CREATE TABLE page_cache (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  url TEXT NOT NULL,
  page_type TEXT NOT NULL,
  html_content TEXT NOT NULL,
  compressed BOOLEAN DEFAULT FALSE,
  content_hash TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  captured_by TEXT DEFAULT 'extension',
  parsed BOOLEAN DEFAULT FALSE,
  parsed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now_utc()
);

-- 5-version rotation trigger: keeps only the 5 most recent versions per URL
CREATE OR REPLACE FUNCTION rotate_page_cache()
RETURNS TRIGGER AS $$
BEGIN
  DELETE FROM page_cache
  WHERE url = NEW.url
    AND id NOT IN (
      SELECT id FROM page_cache
      WHERE url = NEW.url
      ORDER BY created_at DESC
      LIMIT 4
    );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_rotate_page_cache
  AFTER INSERT ON page_cache
  FOR EACH ROW EXECUTE FUNCTION rotate_page_cache();

CREATE TABLE graph_metrics (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  pagerank REAL,
  betweenness_centrality REAL,
  closeness_centrality REAL,
  degree_centrality INTEGER,
  eigenvector_centrality REAL,
  clustering_coefficient REAL,
  computed_at TIMESTAMPTZ DEFAULT now_utc(),
  UNIQUE(contact_id)
);

CREATE TABLE selector_configs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  page_type TEXT NOT NULL,
  selector_name TEXT NOT NULL,
  css_selector TEXT NOT NULL,
  fallback_selectors TEXT[] DEFAULT '{}',
  extraction_method TEXT DEFAULT 'text',
  attribute_name TEXT,
  regex_pattern TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  version INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT now_utc(),
  updated_at TIMESTAMPTZ DEFAULT now_utc(),
  UNIQUE(page_type, selector_name, version)
);

-- Indexes
CREATE INDEX idx_page_cache_url ON page_cache(url);
CREATE INDEX idx_page_cache_page_type ON page_cache(page_type);
CREATE INDEX idx_graph_metrics_contact_id ON graph_metrics(contact_id);

-- updated_at trigger
CREATE TRIGGER trg_selector_configs_updated_at
  BEFORE UPDATE ON selector_configs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
