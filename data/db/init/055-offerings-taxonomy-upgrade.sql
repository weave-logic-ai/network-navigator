-- Upgrade existing volumes with psql -X -v ON_ERROR_STOP=1 -f data/db/init/055-offerings-taxonomy-upgrade.sql
-- Use -f (not stdin): \ir resolves the sibling taxonomy scripts relative to this file.
-- Docker only runs init scripts when it creates a new database volume.
\set ON_ERROR_STOP on
BEGIN;

-- Do not guess which same-named offering owns its existing associations.
-- Block concurrent writes while checking names and adding the unique index.
LOCK TABLE offerings IN SHARE ROW EXCLUSIVE MODE;
DO $$
DECLARE
  duplicate_report TEXT;
BEGIN
  SELECT string_agg(
    format('%L: IDs [%s]; niche links=%s; ICP links=%s',
      d.name, array_to_string(d.ids, ', '),
      (SELECT count(*) FROM niche_offerings no WHERE no.offering_id = ANY(d.ids)),
      (SELECT count(*) FROM icp_offerings io WHERE io.offering_id = ANY(d.ids))
    ), E'\n' ORDER BY d.name
  ) INTO duplicate_report
  FROM (
    SELECT name, array_agg(id ORDER BY id) AS ids
    FROM offerings
    GROUP BY name HAVING count(*) > 1
  ) d;

  IF duplicate_report IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot add offerings.name uniqueness: duplicate names exist'
      USING DETAIL = duplicate_report,
            HINT = 'Review each listed offering and its associations; rename distinct records or merge them deliberately, then rerun 055. No rows were changed.';
  END IF;
END $$;

-- Fresh installs already have offerings_name_key from 018. Only older
-- volumes need a new index; detect any valid full unique index on name.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_index i
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attname = 'name'
    WHERE i.indrelid = 'offerings'::regclass
      AND i.indisunique AND i.indisvalid AND i.indisready
      AND i.indnkeyatts = 1 AND i.indkey[0] = a.attnum
      AND i.indpred IS NULL AND i.indexprs IS NULL
  ) THEN
    CREATE UNIQUE INDEX uq_offerings_name ON offerings(name);
  END IF;
END $$;

-- Existing volumes do not discover renamed/new init files automatically.
-- Both scripts are safe to rerun and their inserts retain existing row IDs.
\ir 024-taxonomy-hierarchy.sql
\ir 024z-seed-taxonomy.sql

COMMIT;
