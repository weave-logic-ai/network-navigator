-- Tenant schema — required by ECC scripts (025-030)
-- Single-tenant default: one row auto-inserted for local use

CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived')),
  plan TEXT NOT NULL DEFAULT 'free',
  owner_user_id TEXT NOT NULL DEFAULT 'local',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_tenants_updated_at
  BEFORE UPDATE ON tenants FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Seed a default tenant for single-user / local mode
INSERT INTO tenants (slug, name, owner_user_id)
VALUES ('default', 'Default Tenant', 'local')
ON CONFLICT (slug) DO NOTHING;

-- Helper functions used by RLS policies (030-ecc-rls.sql)
CREATE OR REPLACE FUNCTION get_current_tenant_id()
RETURNS UUID AS $$
BEGIN
  RETURN current_setting('app.current_tenant_id', true)::UUID;
EXCEPTION WHEN OTHERS THEN
  -- Fallback: return the default tenant so local/single-user mode works
  RETURN (SELECT id FROM tenants WHERE slug = 'default' LIMIT 1);
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION is_super_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN COALESCE(current_setting('app.is_super_admin', true)::BOOLEAN, FALSE);
EXCEPTION WHEN OTHERS THEN
  RETURN FALSE;
END;
$$ LANGUAGE plpgsql STABLE;
