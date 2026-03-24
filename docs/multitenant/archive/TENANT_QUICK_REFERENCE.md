# Multi-Tenant Quick Reference

## Common Tasks

### Set Tenant Context

```typescript
import { withTenantContext } from '@/lib/tenant';

await withTenantContext(
  { tenantId: 'uuid', userId: 'user_123', isSuperAdmin: false },
  async () => {
    // All DB queries automatically filter by tenant
    const contacts = await db.query('SELECT * FROM contacts');
  }
);
```

### Check Permissions

```typescript
import { roleHasPermission, PermissionError } from '@/lib/tenant';

if (!roleHasPermission(role, 'contacts:write')) {
  throw new PermissionError('contacts:write');
}
```

### API Route with Tenant Auth

```typescript
import { withTenantAuth } from '@/lib/tenant/middleware';

export async function GET(request: NextRequest, { params }) {
  return withTenantAuth(
    request,
    async (req, context) => {
      // context.tenantId, context.userId, context.role available
      return NextResponse.json({ data });
    },
    params
  );
}
```

### Admin Route

```typescript
import { withAdminAuth } from '@/lib/tenant/middleware';

export async function GET(request: NextRequest) {
  return withAdminAuth(request, async (req, context) => {
    // Super admin access - bypasses RLS
    return NextResponse.json({ data });
  });
}
```

### API Key Route (for Extension)

```typescript
import { withApiKeyAuth } from '@/lib/tenant/middleware';

export async function POST(request: NextRequest) {
  return withApiKeyAuth(request, async (req, context) => {
    // context.tenantId from API key
    return NextResponse.json({ data });
  });
}
```

## Database Queries

### Insert with tenant_id

```typescript
await db.query(
  `INSERT INTO contacts (tenant_id, linkedin_url, full_name)
   VALUES ($1, $2, $3)`,
  [tenantId, linkedinUrl, fullName]
);
```

### Query within tenant context (RLS handles filtering)

```typescript
// After setting tenant context
const result = await db.query('SELECT * FROM contacts');
// Automatically filtered to current tenant
```

### Raw query with explicit tenant (bypass RLS context)

```typescript
const result = await db.query(
  'SELECT * FROM contacts WHERE tenant_id = $1',
  [tenantId]
);
```

## Tenant Service Operations

```typescript
import { tenantService } from '@/lib/tenant';

// Create tenant
const tenant = await tenantService.createTenant(
  { slug: 'acme-corp', name: 'Acme Corp', plan: 'pro' },
  'user_123',      // owner user id
  'owner@acme.com' // owner email
);

// Add member
await tenantService.addTenantMember(
  tenantId,
  'user_456',
  'member@acme.com',
  'member'
);

// Create API key
const { apiKey } = await tenantService.createApiKey(
  tenantId,
  'Extension Key',
  'user_123',
  ['read', 'write']
);

// Get tenant stats
const stats = await tenantService.getTenantStats(tenantId);
```

## Environment Variables

```bash
# Required
DATABASE_URL=postgresql://...
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_...
CLERK_SECRET_KEY=sk_...

# Optional
SUPER_ADMIN_USER_IDS=user_xxx,user_yyy
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
```

## File Locations

```
app/src/
├── lib/
│   └── tenant/
│       ├── index.ts          # Exports
│       ├── types.ts          # TypeScript interfaces
│       ├── permissions.ts    # Role/permission definitions
│       ├── context.ts        # Tenant context management
│       ├── service.ts        # Business logic
│       └── middleware.ts     # Route middleware
└── app/
    ├── (dashboard)/
    │   └── [tenant]/         # Tenant-scoped routes
    ├── admin/                # Admin overlay routes
    └── api/
        ├── admin/            # Admin API routes
        └── v1/[tenant]/      # Tenant API routes

data/db/init/
├── 020-tenant-schema.sql     # Core tenant tables
├── 021-add-tenant-to-core-tables.sql
├── 022-enable-rls.sql        # RLS policies
└── 023-tenant-functions.sql  # Helper functions
```

## Troubleshooting

### Error: "tenant_id violates not-null constraint"

**Cause**: Inserting without tenant_id
**Fix**: Include tenant_id in INSERT or set tenant context

```typescript
// Option 1: Include tenant_id
await db.query('INSERT INTO contacts (tenant_id, ...) VALUES ($1, ...)', [tenantId]);

// Option 2: Set context
await withTenantContext({ tenantId, isSuperAdmin: false }, async () => {
  await db.query('INSERT INTO contacts (...) VALUES (...)');
});
```

### Error: "permission denied for table contacts"

**Cause**: RLS enabled but tenant context not set
**Fix**: Ensure context is set before query

```typescript
await db.query('SELECT set_tenant_context($1)', [tenantId]);
// ... queries ...
await db.query('SELECT set_tenant_context(NULL)'); // cleanup
```

### Error: "Tenant not found"

**Cause**: Invalid tenant slug or tenant deleted
**Fix**: Check tenant exists and is active

```typescript
const tenant = await tenantService.getTenantBySlug(slug);
if (!tenant || tenant.status !== 'active') {
  return notFound();
}
```

## Testing RLS

```sql
-- Set tenant context
SELECT set_tenant_context('tenant-uuid');

-- Query (filtered automatically)
SELECT * FROM contacts;

-- Set admin context (bypass RLS)
SELECT set_admin_context(true);

-- Query all data
SELECT * FROM contacts;

-- Reset
SELECT set_tenant_context(NULL);
SELECT set_admin_context(false);
```

## Migration Checklist

- [ ] Run `020-tenant-schema.sql`
- [ ] Run `021-add-tenant-to-core-tables.sql`
- [ ] Run `022-enable-rls.sql`
- [ ] Run `023-tenant-functions.sql`
- [ ] Create default tenant for existing data
- [ ] Verify all tables have tenant_id
- [ ] Test RLS policies
- [ ] Install @clerk/nextjs
- [ ] Set environment variables
- [ ] Implement tenant context
- [ ] Update API routes
- [ ] Test end-to-end
