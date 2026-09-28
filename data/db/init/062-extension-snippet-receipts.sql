-- One committed receipt and its snippet graph effects per extension request.
CREATE TABLE extension_snippet_receipts (
  extension_id TEXT NOT NULL,
  request_id UUID NOT NULL,
  tenant_id UUID NOT NULL,
  target_kind TEXT NOT NULL,
  target_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (request_id)
);

CREATE INDEX extension_snippet_receipts_tenant_idx ON extension_snippet_receipts (tenant_id, created_at);
