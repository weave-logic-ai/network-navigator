/**
 * Auth Middleware for Tenant Routes
 * Validates authentication and sets tenant context
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { tenantService } from '@/lib/tenant';
import { setTenantContextForRequest, clearTenantContext } from '@/lib/tenant/context';

export interface RouteContext {
  tenantId: string;
  userId: string;
  role: string;
  isSuperAdmin: boolean;
}

/**
 * Middleware to validate tenant access and set context
 * Use in API routes with dynamic tenant parameter
 */
export async function withTenantAuth(
  request: NextRequest,
  handler: (req: NextRequest, context: RouteContext) => Promise<NextResponse>,
  params: { tenant: string }
): Promise<NextResponse> {
  try {
    // Verify user is authenticated
    const { userId } = await auth();
    
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get tenant by slug
    const tenant = await tenantService.getTenantBySlug(params.tenant);
    
    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }

    if (tenant.status !== 'active') {
      return NextResponse.json({ error: 'Tenant is not active' }, { status: 403 });
    }

    // Check if user is member of tenant
    const isMember = await tenantService.isTenantMember(tenant.id, userId);
    
    if (!isMember) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    // Get user's role
    const role = await tenantService.getUserRole(tenant.id, userId);
    
    if (!role) {
      return NextResponse.json({ error: 'Role not found' }, { status: 403 });
    }

    // Set tenant context for database queries
    await setTenantContextForRequest(tenant.id, false);

    try {
      // Call handler with context
      const response = await handler(request, {
        tenantId: tenant.id,
        userId,
        role,
        isSuperAdmin: false,
      });

      return response;
    } finally {
      // Clean up tenant context
      await clearTenantContext();
    }
  } catch (error) {
    console.error('Tenant auth middleware error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * Middleware for admin-only routes
 */
export async function withAdminAuth(
  request: NextRequest,
  handler: (req: NextRequest, context: { userId: string }) => Promise<NextResponse>
): Promise<NextResponse> {
  try {
    const { userId } = await auth();
    
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if user is super admin
    const superAdminIds = process.env.SUPER_ADMIN_USER_IDS?.split(',') || [];
    
    if (!superAdminIds.includes(userId)) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    // Set admin context
    await setTenantContextForRequest('00000000-0000-0000-0000-000000000000', true);

    try {
      return await handler(request, { userId });
    } finally {
      await clearTenantContext();
    }
  } catch (error) {
    console.error('Admin auth middleware error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * API Key authentication for extension/agent access
 */
export async function withApiKeyAuth(
  request: NextRequest,
  handler: (req: NextRequest, context: { tenantId: string; permissions: string[] }) => Promise<NextResponse>
): Promise<NextResponse> {
  try {
    // Get API key from header
    const apiKey = request.headers.get('x-api-key') || request.headers.get('authorization')?.replace('Bearer ', '');
    
    if (!apiKey) {
      return NextResponse.json({ error: 'API key required' }, { status: 401 });
    }

    // Validate API key using database function
    const { db } = await import('@/lib/db');
    const result = await db.query(
      'SELECT * FROM validate_api_key($1)',
      [apiKey]
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'Invalid API key' }, { status: 401 });
    }

    const { tenant_id, permissions } = result.rows[0];

    // Set tenant context
    await setTenantContextForRequest(tenant_id, false);

    try {
      return await handler(request, {
        tenantId: tenant_id,
        permissions: permissions || ['read', 'write'],
      });
    } finally {
      await clearTenantContext();
    }
  } catch (error) {
    console.error('API key auth error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
