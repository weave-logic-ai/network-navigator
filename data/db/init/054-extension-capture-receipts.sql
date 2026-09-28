-- Durable replay receipts survive page_cache's five-version rotation.
CREATE TABLE extension_capture_receipts (
  extension_id TEXT NOT NULL,
  capture_id UUID NOT NULL,
  request_hash TEXT NOT NULL,
  response JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (extension_id, capture_id)
);
