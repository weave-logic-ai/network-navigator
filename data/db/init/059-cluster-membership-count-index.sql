-- Supports group counts and member lookup by cluster_id on upgraded volumes.
CREATE INDEX IF NOT EXISTS idx_cluster_memberships_cluster_id ON cluster_memberships(cluster_id);
