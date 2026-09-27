-- RuVector named graphs are not transactional in the installed extension.
-- Publish a private graph by switching this pointer with metrics and groups.
CREATE TABLE IF NOT EXISTS graph_compute_state (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  active_graph_name TEXT,
  published_edges JSONB NOT NULL DEFAULT '[]'::jsonb,
  published_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE graph_compute_state ALTER COLUMN active_graph_name DROP NOT NULL;
ALTER TABLE graph_compute_state ADD COLUMN IF NOT EXISTS published_edges JSONB;

-- The old contacts graph was built with a broader edge policy. It cannot be
-- certified as a publication, even when it happens to exist on this host.
UPDATE graph_compute_state SET active_graph_name = NULL, published_edges = '[]'::jsonb
WHERE active_graph_name = 'contacts' OR published_edges IS NULL;
ALTER TABLE graph_compute_state ALTER COLUMN published_edges SET DEFAULT '[]'::jsonb;
ALTER TABLE graph_compute_state ALTER COLUMN published_edges SET NOT NULL;

INSERT INTO graph_compute_state(id, active_graph_name)
VALUES (TRUE, NULL)
ON CONFLICT (id) DO NOTHING;
