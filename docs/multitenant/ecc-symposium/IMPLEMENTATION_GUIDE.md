# Multi-Tenant Implementation Guide

This guide walks through implementing the multi-tenant architecture for Network Navigator.

## Prerequisites

1. **Database**: PostgreSQL with extensions (uuid-ossp, pg_trgm, ruvector)
2. **Node.js**: 18+ with Next.js 15
3. **Auth Provider**: Clerk account with Organizations enabled
4. **Hosting**: Vercel account

## Phase 1: Database Migration

### Step 1.1: Run Migration Files

Apply the new migration files in order:

```bash
# Using psql or your database client
psql $DATABASE_URL -f data/db/init/020-tenant-schema.sql
psql $DATABASE_URL -f data/db/init/021-add-tenant-to-core-tables.sql
psql $DATABASE_URL -f data/db/init/022-enable-rls.sql
psql $DATABASE_URL -f data/db/init/023-tenant-functions.sql
```

### Step 1.2: Verify Migration

```sql
-- Check tenant tables exist
SELECT * FROM tenants;

-- Verify tenant_id was added to contacts
SELECT column_name FROM information_schema.columns 
WHERE table_name = 'contacts' AND column_name = 'tenant_id';

-- Check RLS is enabled
SELECT relname, relrowsecurity FROM pg_class WHERE relname = 'contacts';
```

## Phase 2: Application Code

### Step 2.1: Install Dependencies

```bash
cd app
npm install @clerk/nextjs
```

### Step 2.2: Environment Variables

Add to `.env`:

```
# Clerk
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL=/
NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL=/

# Admin
SUPER_ADMIN_USER_IDS=user_xxx,user_yyy
```

### Step 2.3: Clerk Configuration

Create `app/src/app/(auth)/layout.tsx`:

```tsx
import { ClerkProvider } from '@clerk/nextjs';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      {children}
    </ClerkProvider>
  );
}
```

Create `app/src/app/(auth)/sign-in/[[...sign-in]]/page.tsx`:

```tsx
import { SignIn } from '@clerk/nextjs';

export default function SignInPage() {
  return (
    <div className="flex items-center justify-center min-h-screen">
      <SignIn />
    </div>
  );
}
```

### Step 2.4: Tenant-Aware Layout

Create `app/src/app/(dashboard)/layout.tsx`:

```tsx
import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { tenantService } from '@/lib/tenant';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { userId } = await auth();
  
  if (!userId) {
    redirect('/sign-in');
  }

  // Get user's tenants
  const tenants = await tenantService.listUserTenants(userId);
  
  if (tenants.length === 0) {
    redirect('/onboarding');
  }

  return (
    <div className="dashboard-layout">
      <Sidebar tenants={tenants} />
      <main>{children}</main>
    </div>
  );
}
```

### Step 2.5: Tenant Route Handler

Create `app/src/app/(dashboard)/[tenant]/page.tsx`:

```tsx
import { auth } from '@clerk/nextjs/server';
import { notFound, redirect } from 'next/navigation';
import { tenantService } from '@/lib/tenant';
import { withTenantContext } from '@/lib/tenant/context';

interface PageProps {
  params: Promise<{ tenant: string }>;
}

export default async function TenantDashboardPage({ params }: PageProps) {
  const { userId } = await auth();
  const { tenant: tenantSlug } = await params;
  
  if (!userId) {
    redirect('/sign-in');
  }

  const tenant = await tenantService.getTenantBySlug(tenantSlug);
  
  if (!tenant) {
    notFound();
  }

  // Verify membership
  const isMember = await tenantService.isTenantMember(tenant.id, userId);
  
  if (!isMember) {
    redirect('/');
  }

  // Get dashboard data within tenant context
  const stats = await withTenantContext(
    { tenantId: tenant.id, userId, isSuperAdmin: false },
    async () => {
      // All queries here automatically filter by tenant_id
      const contacts = await getContactsCount();
      const recent = await getRecentContacts(5);
      return { contacts, recent };
    }
  );

  return (
    <div>
      <h1>{tenant.name}</h1>
      <DashboardStats stats={stats} />
    </div>
  );
}
```

## Phase 3: API Routes

### Step 3.1: Tenant API Routes

Create `app/src/app/api/v1/[tenant]/contacts/route.ts`:

```tsx
import { NextRequest, NextResponse } from 'next/server';
import { withTenantAuth } from '@/lib/tenant/middleware';
import { db } from '@/lib/db';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenant: string }> }
) {
  const { tenant } = await params;
  
  return withTenantAuth(
    request,
    async (req, context) => {
      // Tenant context is already set, queries are automatically filtered
      const result = await db.query(
        'SELECT * FROM contacts ORDER BY updated_at DESC LIMIT 100'
      );
      
      return NextResponse.json({ contacts: result.rows });
    },
    { tenant }
  );
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenant: string }> }
) {
  const { tenant } = await params;
  
  return withTenantAuth(
    request,
    async (req, context) => {
      const body = await req.json();
      
      // tenant_id is automatically set by RLS or application logic
      const result = await db.query(
        `INSERT INTO contacts (tenant_id, linkedin_url, first_name, last_name, full_name)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [context.tenantId, body.linkedin_url, body.first_name, body.last_name, body.full_name]
      );
      
      return NextResponse.json({ contact: result.rows[0] }, { status: 201 });
    },
    { tenant }
  );
}
```

### Step 3.2: API Key Routes (for Extension)

Create `app/src/app/api/extension/capture/route.ts`:

```tsx
import { NextRequest, NextResponse } from 'next/server';
import { withApiKeyAuth } from '@/lib/tenant/middleware';
import { db } from '@/lib/db';

export async function POST(request: NextRequest) {
  return withApiKeyAuth(
    request,
    async (req, context) => {
      const body = await req.json();
      
      // Tenant context is set from API key
      const result = await db.query(
        `INSERT INTO raw_captures (tenant_id, source_url, raw_data, capture_type)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [context.tenantId, body.source_url, body.raw_data, body.capture_type]
      );
      
      return NextResponse.json({ capture: result.rows[0] }, { status: 201 });
    }
  );
}
```

## Phase 4: Admin Routes

### Step 4.1: Admin Layout

Create `app/src/app/admin/layout.tsx`:

```tsx
import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { userId } = await auth();
  
  const superAdminIds = process.env.SUPER_ADMIN_USER_IDS?.split(',') || [];
  
  if (!userId || !superAdminIds.includes(userId)) {
    redirect('/');
  }

  return (
    <div className="admin-layout">
      <AdminSidebar />
      <main>{children}</main>
    </div>
  );
}
```

### Step 4.2: Admin API Routes

Create `app/src/app/api/admin/tenants/route.ts`:

```tsx
import { NextRequest, NextResponse } from 'next/server';
import { withAdminAuth } from '@/lib/tenant/middleware';
import { tenantService } from '@/lib/tenant';

export async function GET(request: NextRequest) {
  return withAdminAuth(request, async (req) => {
    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status');
    const plan = searchParams.get('plan');
    
    // Admin bypasses RLS and can see all tenants
    const tenants = await tenantService.getAllTenants({ status, plan });
    
    return NextResponse.json({ tenants });
  });
}
```

## Phase 5: Browser Extension Updates

### Step 5.1: Extension API Client

Update `browser/src/shared/api-client.ts`:

```typescript
interface ApiClientConfig {
  apiKey: string;
  baseUrl: string;
}

export class TenantApiClient {
  private apiKey: string;
  private baseUrl: string;

  constructor(config: ApiClientConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl;
  }

  async captureProfile(data: ProfileData) {
    const response = await fetch(`${this.baseUrl}/api/extension/capture`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.apiKey,
      },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    return response.json();
  }
}
```

### Step 5.2: Extension Settings

Add to `browser/src/shared/storage.ts`:

```typescript
export interface ExtensionSettings {
  apiKey: string;
  tenantSlug: string;
  baseUrl: string;
}

export async function getSettings(): Promise<ExtensionSettings> {
  return chrome.storage.sync.get(['apiKey', 'tenantSlug', 'baseUrl']) as Promise<ExtensionSettings>;
}

export async function setSettings(settings: ExtensionSettings): Promise<void> {
  return chrome.storage.sync.set(settings);
}
```

## Phase 6: Testing

### Step 6.1: Unit Tests

```typescript
// __tests__/tenant/service.test.ts
import { tenantService } from '@/lib/tenant/service';
import { withTenantContext } from '@/lib/tenant/context';

describe('TenantService', () => {
  it('should create a tenant', async () => {
    const tenant = await tenantService.createTenant(
      { slug: 'test-co', name: 'Test Co' },
      'user_123',
      'owner@test.com'
    );
    
    expect(tenant.slug).toBe('test-co');
    expect(tenant.plan).toBe('free');
  });

  it('should isolate data between tenants', async () => {
    // Create contact in tenant A
    await withTenantContext(
      { tenantId: 'tenant-a', isSuperAdmin: false },
      async () => {
        await db.query('INSERT INTO contacts ...');
      }
    );

    // Query in tenant B should not see tenant A's data
    await withTenantContext(
      { tenantId: 'tenant-b', isSuperAdmin: false },
      async () => {
        const result = await db.query('SELECT * FROM contacts');
        expect(result.rows).toHaveLength(0);
      }
    );
  });
});
```

### Step 6.2: Integration Tests

```bash
# Run database migrations on test database
npm run db:migrate:test

# Run tests
npm test
```

## Phase 7: Deployment

### Step 7.1: Vercel Configuration

Create `vercel.json`:

```json
{
  "version": 2,
  "buildCommand": "cd app && npm run build",
  "outputDirectory": "app/.next",
  "framework": "nextjs",
  "env": {
    "DATABASE_URL": "@database-url",
    "CLERK_SECRET_KEY": "@clerk-secret-key"
  }
}
```

### Step 7.2: Environment Setup

```bash
# Add secrets to Vercel
vercel secrets add database-url "postgresql://..."
vercel secrets add clerk-secret-key "sk_..."
vercel secrets add super-admin-ids "user_xxx,user_yyy"

# Deploy
vercel --prod
```

## Troubleshooting

### RLS Policies Not Working

1. Check that RLS is enabled:
   ```sql
   SELECT relname, relrowsecurity FROM pg_class WHERE relname = 'contacts';
   ```

2. Verify tenant context is being set:
   ```sql
   SELECT current_setting('app.current_tenant_id', true);
   ```

### Performance Issues

1. Ensure indexes are created on `tenant_id` columns
2. Use composite indexes for common query patterns
3. Consider connection pooling with PgBouncer

### Migration Failures

1. Check for existing data conflicts
2. Ensure default tenant exists before backfill
3. Run migrations in a transaction

## Rollback Plan

If issues occur:

1. Disable RLS temporarily:
   ```sql
   ALTER TABLE contacts DISABLE ROW LEVEL SECURITY;
   ```

2. Remove tenant_id requirements:
   ```sql
   ALTER TABLE contacts ALTER COLUMN tenant_id DROP NOT NULL;
   ```

3. Restore from backup if necessary
