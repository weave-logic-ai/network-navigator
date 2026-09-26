-- Existing databases retain the 1 MB check from migration 034 because
-- Docker init scripts only run when the database is first created. Widen it
-- to the 5 MB limit already enforced by the snippet upload path.
-- Apply this file to an existing database with psql; it is safe to re-run.

BEGIN;

ALTER TABLE snippet_blobs
  DROP CONSTRAINT IF EXISTS snippet_blobs_byte_length_check;

ALTER TABLE snippet_blobs
  ADD CONSTRAINT snippet_blobs_byte_length_check
  CHECK (byte_length > 0 AND byte_length <= 5242880);

COMMIT;
