/**
 * Permission and Role Management
 * Role-based access control for multi-tenant setup
 */

export type UserRole = 'owner' | 'admin' | 'member' | 'viewer';

export type Permission =
  // Tenant management
  | 'tenant:manage'
  | 'tenant:delete'
  | 'tenant:view'
  // Billing
  | 'billing:manage'
  | 'billing:view'
  // Members
  | 'members:manage'
  | 'members:invite'
  | 'members:remove'
  | 'members:read'
  // Contacts
  | 'contacts:read'
  | 'contacts:write'
  | 'contacts:delete'
  | 'contacts:import'
  | 'contacts:export'
  // Enrichment
  | 'enrichment:trigger'
  | 'enrichment:configure'
  // Scoring
  | 'scoring:configure'
  | 'scoring:view'
  // Outreach
  | 'outreach:send'
  | 'outreach:configure'
  // API Keys
  | 'api_keys:manage'
  | 'api_keys:read'
  // Settings
  | 'settings:manage'
  | 'settings:read';

export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  owner: [
    'tenant:manage',
    'tenant:delete',
    'tenant:view',
    'billing:manage',
    'billing:view',
    'members:manage',
    'members:invite',
    'members:remove',
    'members:read',
    'contacts:read',
    'contacts:write',
    'contacts:delete',
    'contacts:import',
    'contacts:export',
    'enrichment:trigger',
    'enrichment:configure',
    'scoring:configure',
    'scoring:view',
    'outreach:send',
    'outreach:configure',
    'api_keys:manage',
    'api_keys:read',
    'settings:manage',
    'settings:read',
  ],
  admin: [
    'tenant:view',
    'billing:view',
    'members:manage',
    'members:invite',
    'members:remove',
    'members:read',
    'contacts:read',
    'contacts:write',
    'contacts:delete',
    'contacts:import',
    'contacts:export',
    'enrichment:trigger',
    'enrichment:configure',
    'scoring:configure',
    'scoring:view',
    'outreach:send',
    'outreach:configure',
    'api_keys:manage',
    'api_keys:read',
    'settings:read',
  ],
  member: [
    'tenant:view',
    'members:read',
    'contacts:read',
    'contacts:write',
    'enrichment:trigger',
    'scoring:view',
    'outreach:send',
    'settings:read',
  ],
  viewer: [
    'tenant:view',
    'members:read',
    'contacts:read',
    'scoring:view',
    'settings:read',
  ],
};

/**
 * Check if a role has a specific permission
 */
export function roleHasPermission(role: UserRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

/**
 * Get all permissions for a role
 */
export function getRolePermissions(role: UserRole): Permission[] {
  return ROLE_PERMISSIONS[role];
}

/**
 * Check if a role can invite another role
 */
export function canInviteRole(inviterRole: UserRole, inviteeRole: UserRole): boolean {
  const roleHierarchy: UserRole[] = ['viewer', 'member', 'admin', 'owner'];
  const inviterIndex = roleHierarchy.indexOf(inviterRole);
  const inviteeIndex = roleHierarchy.indexOf(inviteeRole);
  
  // Can only invite roles at or below your level
  return inviterIndex >= inviteeIndex && inviterRole !== 'viewer';
}

/**
 * Check if a role can manage another role
 */
export function canManageRole(managerRole: UserRole, targetRole: UserRole): boolean {
  const roleHierarchy: UserRole[] = ['viewer', 'member', 'admin', 'owner'];
  const managerIndex = roleHierarchy.indexOf(managerRole);
  const targetIndex = roleHierarchy.indexOf(targetRole);
  
  // Can only manage roles strictly below your level
  return managerIndex > targetIndex;
}

export class PermissionError extends Error {
  constructor(
    message: string = 'Insufficient permissions',
    public readonly requiredPermission?: Permission
  ) {
    super(message);
    this.name = 'PermissionError';
  }
}
