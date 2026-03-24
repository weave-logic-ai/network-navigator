/**
 * Tenant Service
 * Business logic for tenant operations
 */

import { db } from '@/lib/db';
import { Tenant, TenantUser, TenantApiKey, CreateTenantInput, UpdateTenantInput } from './types';
import { UserRole } from './permissions';
import { randomBytes, createHash } from 'crypto';

export class TenantService {
  /**
   * Get tenant by ID
   */
  async getTenantById(id: string): Promise<Tenant | null> {
    const result = await db.query(
      'SELECT * FROM tenants WHERE id = $1 AND deleted_at IS NULL',
      [id]
    );
    return result.rows[0] || null;
  }

  /**
   * Get tenant by slug
   */
  async getTenantBySlug(slug: string): Promise<Tenant | null> {
    const result = await db.query(
      'SELECT * FROM tenants WHERE slug = $1 AND deleted_at IS NULL',
      [slug]
    );
    return result.rows[0] || null;
  }

  /**
   * Create a new tenant
   */
  async createTenant(input: CreateTenantInput, ownerId: string, ownerEmail: string): Promise<Tenant> {
    // Check if slug is available
    const existing = await this.getTenantBySlug(input.slug);
    if (existing) {
      throw new Error(`Tenant slug "${input.slug}" is already taken`);
    }

    const result = await db.query(
      `INSERT INTO tenants (slug, name, plan, settings, billing_email)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [input.slug, input.name, input.plan || 'free', JSON.stringify(input.settings || {}), ownerEmail]
    );

    const tenant = result.rows[0];

    // Add owner as first member
    await this.addTenantMember(tenant.id, ownerId, ownerEmail, 'owner');

    // Create default settings
    await this.initializeTenantDefaults(tenant.id);

    return tenant;
  }

  /**
   * Update tenant
   */
  async updateTenant(id: string, input: UpdateTenantInput): Promise<Tenant> {
    const updates: string[] = [];
    const values: (string | object)[] = [];
    let paramIndex = 1;

    if (input.name !== undefined) {
      updates.push(`name = $${paramIndex++}`);
      values.push(input.name);
    }

    if (input.plan !== undefined) {
      updates.push(`plan = $${paramIndex++}`);
      values.push(input.plan);
    }

    if (input.settings !== undefined) {
      updates.push(`settings = $${paramIndex++}`);
      values.push(JSON.stringify(input.settings));
    }

    if (input.billingEmail !== undefined) {
      updates.push(`billing_email = $${paramIndex++}`);
      values.push(input.billingEmail);
    }

    if (input.status !== undefined) {
      updates.push(`status = $${paramIndex++}`);
      values.push(input.status);
    }

    if (updates.length === 0) {
      throw new Error('No fields to update');
    }

    updates.push(`updated_at = now_utc()`);
    values.push(id);

    const result = await db.query(
      `UPDATE tenants SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      values
    );

    return result.rows[0];
  }

  /**
   * Soft delete tenant
   */
  async deleteTenant(id: string): Promise<void> {
    await db.query('SELECT soft_delete_tenant($1)', [id]);
  }

  /**
   * Add member to tenant
   */
  async addTenantMember(
    tenantId: string,
    userId: string,
    email: string,
    role: UserRole,
    invitedBy?: string
  ): Promise<TenantUser> {
    const result = await db.query(
      `INSERT INTO tenant_users (tenant_id, user_id, email, role, invited_by, invited_at)
       VALUES ($1, $2, $3, $4, $5, now_utc())
       ON CONFLICT (tenant_id, user_id) DO UPDATE
       SET role = EXCLUDED.role, updated_at = now_utc()
       RETURNING *`,
      [tenantId, userId, email, role, invitedBy]
    );

    return result.rows[0];
  }

  /**
   * Remove member from tenant
   */
  async removeTenantMember(tenantId: string, userId: string): Promise<void> {
    // Prevent removing the last owner
    const owners = await db.query(
      'SELECT COUNT(*) FROM tenant_users WHERE tenant_id = $1 AND role = \'owner\' AND joined_at IS NOT NULL',
      [tenantId]
    );

    const targetUser = await db.query(
      'SELECT role FROM tenant_users WHERE tenant_id = $1 AND user_id = $2',
      [tenantId, userId]
    );

    if (targetUser.rows[0]?.role === 'owner' && parseInt(owners.rows[0].count) <= 1) {
      throw new Error('Cannot remove the last owner from tenant');
    }

    await db.query(
      'DELETE FROM tenant_users WHERE tenant_id = $1 AND user_id = $2',
      [tenantId, userId]
    );
  }

  /**
   * Get tenant members
   */
  async getTenantMembers(tenantId: string): Promise<TenantUser[]> {
    const result = await db.query(
      `SELECT * FROM tenant_users 
       WHERE tenant_id = $1 
       ORDER BY 
         CASE role 
           WHEN 'owner' THEN 1 
           WHEN 'admin' THEN 2 
           WHEN 'member' THEN 3 
           ELSE 4 
         END,
         joined_at DESC`,
      [tenantId]
    );
    return result.rows;
  }

  /**
   * Get user's role in tenant
   */
  async getUserRole(tenantId: string, userId: string): Promise<UserRole | null> {
    const result = await db.query(
      'SELECT role FROM tenant_users WHERE tenant_id = $1 AND user_id = $2 AND joined_at IS NOT NULL',
      [tenantId, userId]
    );
    return result.rows[0]?.role || null;
  }

  /**
   * Create API key for tenant
   */
  async createApiKey(
    tenantId: string,
    name: string,
    createdBy: string,
    permissions: string[] = ['read', 'write'],
    expiresAt?: Date
  ): Promise<{ apiKey: string; record: TenantApiKey }> {
    // Generate key
    const randomPart = randomBytes(24).toString('hex');
    const prefix = 'nn_live_';
    const fullKey = prefix + randomPart;
    const keyHash = createHash('sha256').update(fullKey).digest('hex');

    const result = await db.query(
      `INSERT INTO tenant_api_keys (tenant_id, name, key_hash, key_prefix, permissions, expires_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [tenantId, name, keyHash, prefix + randomPart.substring(0, 8), JSON.stringify(permissions), expiresAt, createdBy]
    );

    return { apiKey: fullKey, record: result.rows[0] };
  }

  /**
   * Revoke API key
   */
  async revokeApiKey(keyId: string, tenantId: string): Promise<void> {
    await db.query(
      'UPDATE tenant_api_keys SET revoked_at = now_utc() WHERE id = $1 AND tenant_id = $2',
      [keyId, tenantId]
    );
  }

  /**
   * Get tenant API keys
   */
  async getApiKeys(tenantId: string): Promise<TenantApiKey[]> {
    const result = await db.query(
      `SELECT id, tenant_id, name, key_prefix, permissions, last_used_at, expires_at, created_at, revoked_at
       FROM tenant_api_keys
       WHERE tenant_id = $1
       ORDER BY created_at DESC`,
      [tenantId]
    );
    return result.rows;
  }

  /**
   * Get tenant stats
   */
  async getTenantStats(tenantId: string): Promise<Record<string, number>> {
    const result = await db.query(
      'SELECT * FROM get_tenant_stats($1)',
      [tenantId]
    );
    return result.rows[0];
  }

  /**
   * Get tenant current usage
   */
  async getCurrentUsage(tenantId: string): Promise<Record<string, number>> {
    const result = await db.query(
      'SELECT * FROM get_tenant_current_usage($1)',
      [tenantId]
    );
    return result.rows[0];
  }

  /**
   * Check if user is member of tenant
   */
  async isTenantMember(tenantId: string, userId: string): Promise<boolean> {
    const result = await db.query(
      'SELECT 1 FROM tenant_users WHERE tenant_id = $1 AND user_id = $2 AND joined_at IS NOT NULL',
      [tenantId, userId]
    );
    return result.rows.length > 0;
  }

  /**
   * List tenants for user
   */
  async listUserTenants(userId: string): Promise<Tenant[]> {
    const result = await db.query(
      `SELECT t.* FROM tenants t
       INNER JOIN tenant_users tu ON t.id = tu.tenant_id
       WHERE tu.user_id = $1 
         AND tu.joined_at IS NOT NULL
         AND t.deleted_at IS NULL
         AND t.status = 'active'
       ORDER BY tu.last_accessed_at DESC NULLS LAST`,
      [userId]
    );
    return result.rows;
  }

  /**
   * Initialize default settings for new tenant
   */
  private async initializeTenantDefaults(tenantId: string): Promise<void> {
    // Create default ICP config
    await db.query(
      `INSERT INTO icp_configs (tenant_id, name, vertical, is_active)
       VALUES ($1, 'Default ICP', 'General', true)`,
      [tenantId]
    );

    // Create default enrichment budget
    await db.query(
      `INSERT INTO enrichment_budgets (tenant_id, monthly_budget_cents, current_month_spent_cents)
       VALUES ($1, 5000, 0)`,
      [tenantId]
    );

    // Create initial usage record
    await db.query(
      `INSERT INTO tenant_usage (tenant_id, period_start, period_end)
       VALUES ($1, DATE_TRUNC('month', CURRENT_DATE), DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month' - INTERVAL '1 day')`,
      [tenantId]
    );
  }
}

// Export singleton instance
export const tenantService = new TenantService();
