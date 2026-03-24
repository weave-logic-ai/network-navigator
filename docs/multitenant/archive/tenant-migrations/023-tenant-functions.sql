-- ============================================
-- 023-tenant-functions.sql
-- Additional helper functions for multi-tenancy
-- ============================================

-- Function to create a new tenant with initial setup
CREATE OR REPLACE FUNCTION create_tenant(
  p_slug TEXT,
  p_name TEXT,
  p_user_id TEXT,
  p_email TEXT,
  p_plan TEXT DEFAULT 'free'
)
RETURNS UUID AS $$
DECLARE
  v_tenant_id UUID;
  v_tenant_user_id UUID;
BEGIN
  -- Create tenant
  INSERT INTO tenants (slug, name, plan)
  VALUES (p_slug, p_name, p_plan)
  RETURNING id INTO v_tenant_id;
  
  -- Create owner membership
  INSERT INTO tenant_users (tenant_id, user_id, email, role)
  VALUES (v_tenant_id, p_user_id, p_email, 'owner')
  RETURNING id INTO v_tenant_user_id;
  
  -- Create default ICP config
  INSERT INTO icp_configs (tenant_id, name, vertical, is_active)
  VALUES (v_tenant_id, 'Default ICP', 'General', true);
  
  -- Create default enrichment budget
  INSERT INTO enrichment_budgets (tenant_id, monthly_budget_cents, current_month_spent_cents)
  VALUES (v_tenant_id, 5000, 0);
  
  -- Create initial usage record
  INSERT INTO tenant_usage (tenant_id, period_start, period_end)
  VALUES (
    v_tenant_id,
    DATE_TRUNC('month', CURRENT_DATE),
    DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month' - INTERVAL '1 day'
  );
  
  RETURN v_tenant_id;
END;
$$ LANGUAGE plpgsql;

-- Function to check if user has permission in tenant
CREATE OR REPLACE FUNCTION check_tenant_permission(
  p_user_id TEXT,
  p_tenant_id UUID,
  p_required_role TEXT
)
RETURNS BOOLEAN AS $$
DECLARE
  v_user_role TEXT;
  v_role_hierarchy TEXT[] := ARRAY['viewer', 'member', 'admin', 'owner'];
  v_user_role_index INTEGER;
  v_required_role_index INTEGER;
BEGIN
  SELECT role INTO v_user_role
  FROM tenant_users
  WHERE tenant_id = p_tenant_id
    AND user_id = p_user_id
    AND joined_at IS NOT NULL;
  
  IF v_user_role IS NULL THEN
    RETURN false;
  END IF;
  
  v_user_role_index := array_position(v_role_hierarchy, v_user_role);
  v_required_role_index := array_position(v_role_hierarchy, p_required_role);
  
  RETURN v_user_role_index >= v_required_role_index;
END;
$$ LANGUAGE plpgsql;

-- Function to get tenant limits
CREATE OR REPLACE FUNCTION get_tenant_limits(p_tenant_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_limits JSONB;
BEGIN
  SELECT limits INTO v_limits
  FROM tenants
  WHERE id = p_tenant_id;
  
  RETURN COALESCE(v_limits, '{}'::JSONB);
END;
$$ LANGUAGE plpgsql;

-- Function to check if tenant has reached contact limit
CREATE OR REPLACE FUNCTION check_contact_limit(p_tenant_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  v_limit INTEGER;
  v_current INTEGER;
BEGIN
  SELECT (limits->>'max_contacts')::INTEGER INTO v_limit
  FROM tenants
  WHERE id = p_tenant_id;
  
  SELECT COUNT(*) INTO v_current
  FROM contacts
  WHERE tenant_id = p_tenant_id
    AND is_archived = false;
  
  RETURN v_current >= COALESCE(v_limit, 1000);
END;
$$ LANGUAGE plpgsql;

-- Function to log tenant action
CREATE OR REPLACE FUNCTION log_tenant_action(
  p_tenant_id UUID,
  p_user_id TEXT,
  p_action TEXT,
  p_entity_type TEXT,
  p_entity_id UUID,
  p_metadata JSONB DEFAULT '{}'
)
RETURNS UUID AS $$
DECLARE
  v_log_id UUID;
BEGIN
  INSERT INTO tenant_audit_logs (
    tenant_id,
    user_id,
    action,
    entity_type,
    entity_id,
    metadata
  ) VALUES (
    p_tenant_id,
    p_user_id,
    p_action,
    p_entity_type,
    p_entity_id,
    p_metadata
  )
  RETURNING id INTO v_log_id;
  
  RETURN v_log_id;
END;
$$ LANGUAGE plpgsql;

-- Function to generate API key
CREATE OR REPLACE FUNCTION generate_api_key(p_tenant_id UUID, p_name TEXT)
RETURNS TEXT AS $$
DECLARE
  v_key TEXT;
  v_key_hash TEXT;
  v_key_prefix TEXT;
  v_full_key TEXT;
BEGIN
  -- Generate random key
  v_key := encode(gen_random_bytes(32), 'hex');
  v_key_prefix := 'nn_live_' || substring(v_key from 1 for 8);
  v_full_key := v_key_prefix || substring(v_key from 9);
  
  -- Hash the key for storage
  v_key_hash := encode(digest(v_full_key, 'sha256'), 'hex');
  
  -- Store the key (created_by will be set by application)
  INSERT INTO tenant_api_keys (tenant_id, name, key_hash, key_prefix)
  VALUES (p_tenant_id, p_name, v_key_hash, v_key_prefix);
  
  RETURN v_full_key;
END;
$$ LANGUAGE plpgsql;

-- Function to validate API key
CREATE OR REPLACE FUNCTION validate_api_key(p_key TEXT)
RETURNS TABLE (
  key_id UUID,
  tenant_id UUID,
  permissions JSONB
) AS $$
DECLARE
  v_key_hash TEXT;
  v_key_prefix TEXT;
BEGIN
  v_key_prefix := substring(p_key from 1 for 16);
  v_key_hash := encode(digest(p_key, 'sha256'), 'hex');
  
  RETURN QUERY
  SELECT 
    tenant_api_keys.id,
    tenant_api_keys.tenant_id,
    tenant_api_keys.permissions
  FROM tenant_api_keys
  WHERE key_prefix = v_key_prefix
    AND key_hash = v_key_hash
    AND revoked_at IS NULL
    AND (expires_at IS NULL OR expires_at > now());
END;
$$ LANGUAGE plpgsql;

-- Function to update tenant usage
CREATE OR REPLACE FUNCTION update_tenant_usage(
  p_tenant_id UUID,
  p_contacts_increment INTEGER DEFAULT 0,
  p_enrichments_increment INTEGER DEFAULT 0,
  p_ai_messages_increment INTEGER DEFAULT 0,
  p_api_calls_increment INTEGER DEFAULT 0
)
RETURNS void AS $$
DECLARE
  v_period_start DATE;
BEGIN
  v_period_start := DATE_TRUNC('month', CURRENT_DATE);
  
  INSERT INTO tenant_usage (
    tenant_id,
    period_start,
    period_end,
    contacts_count,
    enrichments_count,
    ai_messages_count,
    api_calls_count
  ) VALUES (
    p_tenant_id,
    v_period_start,
    v_period_start + INTERVAL '1 month' - INTERVAL '1 day',
    GREATEST(p_contacts_increment, 0),
    GREATEST(p_enrichments_increment, 0),
    GREATEST(p_ai_messages_increment, 0),
    GREATEST(p_api_calls_increment, 0)
  )
  ON CONFLICT (tenant_id, period_start)
  DO UPDATE SET
    contacts_count = tenant_usage.contacts_count + EXCLUDED.contacts_count,
    enrichments_count = tenant_usage.enrichments_count + EXCLUDED.enrichments_count,
    ai_messages_count = tenant_usage.ai_messages_count + EXCLUDED.ai_messages_count,
    api_calls_count = tenant_usage.api_calls_count + EXCLUDED.api_calls_count,
    updated_at = now_utc();
END;
$$ LANGUAGE plpgsql;

-- Function to get current usage for tenant
CREATE OR REPLACE FUNCTION get_tenant_current_usage(p_tenant_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_usage JSONB;
BEGIN
  SELECT jsonb_build_object(
    'contacts_count', contacts_count,
    'enrichments_count', enrichments_count,
    'ai_messages_count', ai_messages_count,
    'api_calls_count', api_calls_count,
    'storage_bytes', storage_bytes
  ) INTO v_usage
  FROM tenant_usage
  WHERE tenant_id = p_tenant_id
    AND period_start = DATE_TRUNC('month', CURRENT_DATE);
  
  RETURN COALESCE(v_usage, '{}'::JSONB);
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update usage on contact insert
CREATE OR REPLACE FUNCTION trigger_update_contacts_usage()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM update_tenant_usage(NEW.tenant_id, 1, 0, 0, 0);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_contacts_usage ON contacts;
CREATE TRIGGER trg_update_contacts_usage
  AFTER INSERT ON contacts
  FOR EACH ROW
  EXECUTE FUNCTION trigger_update_contacts_usage();

-- Function to soft delete tenant
CREATE OR REPLACE FUNCTION soft_delete_tenant(p_tenant_id UUID)
RETURNS void AS $$
BEGIN
  UPDATE tenants
  SET 
    status = 'cancelled',
    deleted_at = now_utc(),
    updated_at = now_utc()
  WHERE id = p_tenant_id;
  
  -- Revoke all API keys
  UPDATE tenant_api_keys
  SET revoked_at = now_utc()
  WHERE tenant_id = p_tenant_id
    AND revoked_at IS NULL;
END;
$$ LANGUAGE plpgsql;

-- Function to get tenant statistics (for admin dashboard)
CREATE OR REPLACE FUNCTION get_tenant_stats(p_tenant_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_stats JSONB;
BEGIN
  SELECT jsonb_build_object(
    'contacts_count', (SELECT COUNT(*) FROM contacts WHERE tenant_id = p_tenant_id AND is_archived = false),
    'companies_count', (SELECT COUNT(*) FROM companies WHERE tenant_id = p_tenant_id),
    'enriched_count', (SELECT COUNT(*) FROM person_enrichments WHERE tenant_id = p_tenant_id),
    'team_members', (SELECT COUNT(*) FROM tenant_users WHERE tenant_id = p_tenant_id AND joined_at IS NOT NULL),
    'api_keys_active', (SELECT COUNT(*) FROM tenant_api_keys WHERE tenant_id = p_tenant_id AND revoked_at IS NULL),
    'last_activity', (SELECT MAX(last_accessed_at) FROM tenant_users WHERE tenant_id = p_tenant_id)
  ) INTO v_stats;
  
  RETURN v_stats;
END;
$$ LANGUAGE plpgsql;
