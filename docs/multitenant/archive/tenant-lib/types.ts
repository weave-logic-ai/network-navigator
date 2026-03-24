/**
 * Tenant Types
 * TypeScript interfaces for tenant-related data
 */

export interface Tenant {
  id: string;
  slug: string;
  name: string;
  status: 'active' | 'suspended' | 'cancelled';
  plan: 'free' | 'starter' | 'pro' | 'enterprise';
  settings: Record<string, unknown>;
  limits: {
    max_contacts: number;
    max_team_members: number;
    max_enrichments_per_month: number;
    max_ai_messages_per_month: number;
  };
  billing_email?: string;
  stripe_customer_id?: string;
  stripe_subscription_id?: string;
  created_at: Date;
  updated_at: Date;
  deleted_at?: Date;
}

export interface TenantUser {
  id: string;
  tenant_id: string;
  user_id: string;
  email: string;
  role: 'owner' | 'admin' | 'member' | 'viewer';
  invited_by?: string;
  invited_at?: Date;
  joined_at?: Date;
  last_accessed_at?: Date;
  created_at: Date;
  updated_at: Date;
}

export interface TenantApiKey {
  id: string;
  tenant_id: string;
  name: string;
  key_prefix: string;
  permissions: string[];
  last_used_at?: Date;
  expires_at?: Date;
  created_by?: string;
  created_at: Date;
  revoked_at?: Date;
}

export interface TenantAuditLog {
  id: string;
  tenant_id: string;
  user_id?: string;
  action: string;
  entity_type: string;
  entity_id?: string;
  metadata: Record<string, unknown>;
  ip_address?: string;
  user_agent?: string;
  created_at: Date;
}

export interface TenantUsage {
  id: string;
  tenant_id: string;
  period_start: Date;
  period_end: Date;
  contacts_count: number;
  enrichments_count: number;
  ai_messages_count: number;
  api_calls_count: number;
  storage_bytes: number;
  created_at: Date;
  updated_at: Date;
}

export interface CreateTenantInput {
  slug: string;
  name: string;
  plan?: 'free' | 'starter' | 'pro' | 'enterprise';
  settings?: Record<string, unknown>;
}

export interface UpdateTenantInput {
  name?: string;
  plan?: 'free' | 'starter' | 'pro' | 'enterprise';
  settings?: Record<string, unknown>;
  billingEmail?: string;
  status?: 'active' | 'suspended' | 'cancelled';
}

export interface TenantWithStats extends Tenant {
  stats: {
    contacts_count: number;
    companies_count: number;
    enriched_count: number;
    team_members: number;
    api_keys_active: number;
    last_activity?: Date;
  };
}

export interface TenantWithUsage extends Tenant {
  usage: {
    contacts_count: number;
    enrichments_count: number;
    ai_messages_count: number;
    api_calls_count: number;
    storage_bytes: number;
  };
  limits: {
    max_contacts: number;
    max_team_members: number;
    max_enrichments_per_month: number;
    max_ai_messages_per_month: number;
  };
}
