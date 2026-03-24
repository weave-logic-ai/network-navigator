/**
 * Tenant Context Management
 * Handles setting and retrieving tenant context for database queries
 */

import { PoolClient } from 'pg';
import { db } from '@/lib/db';

export interface TenantContext {
  tenantId: string;
  userId?: string;
  isSuperAdmin: boolean;
}

// AsyncLocalStorage to maintain tenant context across async operations
import { AsyncLocalStorage } from 'async_hooks';

const tenantStorage = new AsyncLocalStorage<TenantContext>();

/**
 * Get the current tenant context from AsyncLocalStorage
 */
export function getTenantContext(): TenantContext | undefined {
  return tenantStorage.getStore();
}

/**
 * Get the current tenant ID from context
 */
export function getCurrentTenantId(): string | undefined {
  return tenantStorage.getStore()?.tenantId;
}

/**
 * Check if current context is super admin
 */
export function isSuperAdmin(): boolean {
  return tenantStorage.getStore()?.isSuperAdmin ?? false;
}

/**
 * Execute a function within a tenant context
 * Automatically sets and cleans up the database RLS context
 */
export async function withTenantContext<T>(
  context: TenantContext,
  operation: () => Promise<T>
): Promise<T> {
  return tenantStorage.run(context, async () => {
    // Set the PostgreSQL RLS context
    await db.query('SELECT set_tenant_context($1)', [context.tenantId]);
    
    if (context.isSuperAdmin) {
      await db.query('SELECT set_admin_context(true)');
    }
    
    try {
      return await operation();
    } finally {
      // Clean up context
      await db.query('SELECT set_tenant_context(NULL)');
      await db.query('SELECT set_admin_context(false)');
    }
  });
}

/**
 * Set tenant context on a specific database client
 * Useful for transactions
 */
export async function setClientTenantContext(
  client: PoolClient,
  context: TenantContext
): Promise<void> {
  await client.query('SELECT set_tenant_context($1)', [context.tenantId]);
  
  if (context.isSuperAdmin) {
    await client.query('SELECT set_admin_context(true)');
  }
}

/**
 * Clear tenant context from a database client
 */
export async function clearClientTenantContext(client: PoolClient): Promise<void> {
  await client.query('SELECT set_tenant_context(NULL)');
  await client.query('SELECT set_admin_context(false)');
}

/**
 * Middleware-compatible context setter
 * For use in Next.js middleware or API routes
 */
export async function setTenantContextForRequest(
  tenantId: string,
  isSuperAdmin: boolean = false
): Promise<void> {
  await db.query('SELECT set_tenant_context($1)', [tenantId]);
  
  if (isSuperAdmin) {
    await db.query('SELECT set_admin_context(true)');
  }
}

/**
 * Clear tenant context after request
 */
export async function clearTenantContext(): Promise<void> {
  await db.query('SELECT set_tenant_context(NULL)');
  await db.query('SELECT set_admin_context(false)');
}
