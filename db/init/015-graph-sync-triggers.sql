-- 015-graph-sync-triggers.sql
-- Graph sync triggers for ruvector-postgres native graph (graceful no-op if functions absent)

-- Helper: check if a function exists in pg_proc
CREATE OR REPLACE FUNCTION ruvector_graph_function_exists(func_name TEXT)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = func_name
  );
END;
$$ LANGUAGE plpgsql STABLE;

-- Trigger function: sync contact INSERT to ruvector graph node
CREATE OR REPLACE FUNCTION sync_contact_to_graph_node()
RETURNS TRIGGER AS $$
BEGIN
  IF ruvector_graph_function_exists('ruvector_graph_add_node') THEN
    BEGIN
      PERFORM ruvector_graph_add_node('contacts', NEW.id::text, json_build_object(
        'name', COALESCE(NEW.full_name, ''),
        'type', 'contact'
      )::text);
    EXCEPTION WHEN OTHERS THEN
      -- Graceful no-op: log nothing, do not block the insert
      NULL;
    END;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger function: sync contact DELETE to ruvector graph node removal
CREATE OR REPLACE FUNCTION sync_contact_delete_from_graph()
RETURNS TRIGGER AS $$
BEGIN
  IF ruvector_graph_function_exists('ruvector_graph_remove_node') THEN
    BEGIN
      PERFORM ruvector_graph_remove_node('contacts', OLD.id::text);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

-- Trigger function: sync edge INSERT to ruvector graph edge
CREATE OR REPLACE FUNCTION sync_edge_to_graph()
RETURNS TRIGGER AS $$
DECLARE
  target_id TEXT;
BEGIN
  IF ruvector_graph_function_exists('ruvector_graph_add_edge') THEN
    target_id := COALESCE(NEW.target_contact_id::text, NEW.target_company_id::text);
    BEGIN
      PERFORM ruvector_graph_add_edge(
        'contacts',
        NEW.source_contact_id::text,
        target_id,
        NEW.edge_type,
        NEW.weight
      );
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger function: sync edge DELETE from ruvector graph
CREATE OR REPLACE FUNCTION sync_edge_delete_from_graph()
RETURNS TRIGGER AS $$
DECLARE
  target_id TEXT;
BEGIN
  IF ruvector_graph_function_exists('ruvector_graph_remove_edge') THEN
    target_id := COALESCE(OLD.target_contact_id::text, OLD.target_company_id::text);
    BEGIN
      PERFORM ruvector_graph_remove_edge(
        'contacts',
        OLD.source_contact_id::text,
        target_id,
        OLD.edge_type
      );
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

-- Create triggers
CREATE TRIGGER trg_contact_graph_sync_insert
  AFTER INSERT ON contacts
  FOR EACH ROW EXECUTE FUNCTION sync_contact_to_graph_node();

CREATE TRIGGER trg_contact_graph_sync_delete
  BEFORE DELETE ON contacts
  FOR EACH ROW EXECUTE FUNCTION sync_contact_delete_from_graph();

CREATE TRIGGER trg_edge_graph_sync_insert
  AFTER INSERT ON edges
  FOR EACH ROW EXECUTE FUNCTION sync_edge_to_graph();

CREATE TRIGGER trg_edge_graph_sync_delete
  BEFORE DELETE ON edges
  FOR EACH ROW EXECUTE FUNCTION sync_edge_delete_from_graph();
