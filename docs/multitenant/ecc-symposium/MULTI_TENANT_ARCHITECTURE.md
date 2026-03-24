# Network Navigator Multi-Tenant Architecture Plan

## Executive Summary

This document outlines the architecture for transforming Network Navigator from a single-tenant application into a multi-tenant SaaS platform with an admin overlay. The target deployment is lightweight on Vercel with PostgreSQL as the primary datastore.

## Current Architecture Overview

### Current Data Model
- **Core Tables**: contacts, companies, edges, clusters, cluster_memberships
- **Enrichment**: person_enrichments, company_enrichments
- **Scoring**: contact_scores, icp_configs, niche_configs, offering_configs
- **Outreach**: outreach_states, message_templates, conversations
- **Extension**: extension_tokens, page_cache, selector_configs, raw_captures
- **Graph**: community_mappings, referral_scores

## Multi-Tenant Strategy Comparison

| Strategy | Isolation Level | Complexity | Cost | Best For |
|----------|----------------|------------|------|----------|
| **Shared Schema + tenant_id** | Row-level | Low | $ | Early SaaS, rapid iteration |
| **Separate Schemas** | Schema-level | Medium | $$ | Compliance requirements, data residency |
| **Separate Databases** | Full isolation | High | $$$ | Enterprise tenants, strict compliance |

## Recommended Approach: Shared Schema with Row-Level Security

For Network Navigator's SaaS launch, we recommend **Shared Schema with tenant_id** combined with PostgreSQL Row-Level Security (RLS). This provides:

- **Fast time-to-market** — minimal schema changes
- **Cost efficiency** — single database on Vercel Postgres or Supabase
- **Scalable to ~1000 tenants** before requiring sharding
- **Easy migration path** to schema-per-tenant later if needed

## Database Schema Changes

### New Migration Files

1. **020-tenant-schema.sql** — New tenant tables
2. **021-add-tenant-to-core-tables.sql** — Add tenant_id to existing tables  
3. **022-enable-rls.sql** — Row-level security policies
4. **023-tenant-functions.sql** — Helper functions

### Key Schema Additions

```sql
-- Tenants table
CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'cancelled')),
  plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'starter', 'pro', 'enterprise')),
  settings JSONB DEFAULT '{}',
  limits JSONB DEFAULT '{
    "max_contacts": 1000,
    "max_team_members": 3,
    "max_enrichments_per_month": 100,
    "max_ai_messages_per_month": 50
  }',
  billing_email TEXT,
  created_at TIMESTAMPTZ DEFAULT now_utc(),
  updated_at TIMESTAMPTZ DEFAULT now_utc(),
  deleted_at TIMESTAMPTZ
);

-- Tenant users (membership mapping)
CREATE TABLE tenant_users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  invited_by UUID REFERENCES tenant_users(id),
  invited_at TIMESTAMPTZ,
  joined_at TIMESTAMPTZ DEFAULT now_utc(),
  last_accessed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now_utc(),
  updated_at TIMESTAMPTZ DEFAULT now_utc(),
  UNIQUE(tenant_id, user_id)
);
```

### Tables Requiring tenant_id

All tenant-scoped tables need `tenant_id UUID REFERENCES tenants(id)`:

- `contacts`, `companies`, `edges`, `clusters`, `cluster_memberships`
- `person_enrichments`, `company_enrichments`
- `contact_scores`, `icp_configs`, `niche_configs`, `offering_configs`, `referral_scores`
- `outreach_states`, `message_templates`, `conversations`, `conversation_messages`
- `extension_tokens`, `page_cache`, `raw_captures`, `extension_settings`, `selector_configs`
- `engagement_scores`, `response_predictions`, `communication_patterns`, `behavioral_profiles`
- `tasks`, `goals`, `goal_contacts`
- `community_mappings`, `graph_sync_state`
- `enrichment_budgets`, `enrichment_spends`, `import_batches`, `import_records`, `enrichment_queue`
- `score_cache`, `vector_metadata_cache`, `owner_profiles`

### Row-Level Security Policies

```sql
-- Enable RLS on all tenant-scoped tables
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only access their tenant's data
CREATE POLICY tenant_isolation_contacts ON contacts
  FOR ALL USING (tenant_id = current_setting('app.current_tenant_id', true)::UUID);

-- Admin bypass policy
CREATE POLICY admin_bypass_contacts ON contacts
  FOR ALL USING (current_setting('app.is_super_admin', true)::BOOLEAN = true);
```

## Authentication & Authorization

### Clerk Integration

Clerk provides out-of-the-box multi-tenant auth with organizations support.

**Role Mapping:**
| Clerk Role | Network Navigator Role | Permissions |
|------------|----------------------|-------------|
| org:admin | owner | Full access |
| org:admin | admin | Most access, no billing |
| org:member | member | Read/write contacts |
| - | viewer | Read-only |

**Permissions by Role:**
- **owner**: tenant:manage, billing:manage, members:manage, all data access
- **admin**: members:invite, all data access, no billing
- **member**: contacts:read/write, enrichment:trigger, outreach:send
- **viewer**: contacts:read only

## Application Structure

### Route Organization

```
app/src/app/
├── (public)/                    # Public marketing pages
│   ├── page.tsx
│   ├── pricing/page.tsx
│   └── about/page.tsx
├── (auth)/                      # Auth pages (Clerk)
│   ├── sign-in/[[...sign-in]]/
│   └── sign-up/[[...sign-up]]/
├── (dashboard)/                 # Dashboard with tenant context
│   ├── layout.tsx
│   └── [tenant]/
│       ├── layout.tsx
│       ├── page.tsx
│       ├── contacts/
│       ├── companies/
│       ├── scoring/
│       ├── outreach/
│       ├── network/
│       ├── enrichment/
│       ├── settings/
│       └── team/
├── admin/                       # Super admin overlay
│   ├── layout.tsx
│   ├── page.tsx
│   ├── tenants/
│   ├── users/
│   ├── billing/
│   └── system/
└── api/
    ├── webhooks/clerk/
    ├── admin/
    └── v1/[tenant]/
```

## Deployment on Vercel

### Infrastructure Stack

| Service | Provider | Purpose |
|---------|----------|---------|
| App Hosting | Vercel | Next.js app, auto-scaling |
| Database | Supabase / Vercel Postgres | PostgreSQL with RLS |
| Auth | Clerk | Multi-tenant auth, organizations |
| Cache | Upstash | Redis for sessions, rate limiting |
| Storage | Cloudflare R2 | File exports, backups |
| Queue | Vercel Cron / Inngest | Background jobs |
| Monitoring | Vercel Analytics / Logtail | Logs, metrics |

### Environment Variables

```
# Database
DATABASE_URL=postgresql://...

# Auth (Clerk)
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_...
CLERK_SECRET_KEY=sk_...
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up

# External APIs
ANTHROPIC_API_KEY=
PDL_API_KEY=
APOLLO_API_KEY=
LUSHA_API_KEY=
THEIRSTACK_API_KEY=

# Optional: Redis for caching
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=

# Optional: Admin bypass
SUPER_ADMIN_USER_IDS=user_xxx,user_yyy
```

## Migration Path

### Phase 1: Foundation (Week 1-2)
1. Add tenant tables (020-tenant-schema.sql)
2. Add tenant_id to all tables (021-add-tenant-to-core-tables.sql)
3. Create default tenant for existing data
4. Update queries to include tenant_id

### Phase 2: Auth Integration (Week 2-3)
1. Set up Clerk with organizations
2. Implement tenant context middleware
3. Add role-based access control
4. Create tenant onboarding flow

### Phase 3: RLS & Security (Week 3-4)
1. Enable RLS on all tables
2. Create RLS policies
3. Implement tenant context setting
4. Add audit logging

### Phase 4: Admin Overlay (Week 4-5)
1. Create admin routes
2. Build tenant management UI
3. Add system monitoring
4. Implement impersonation

### Phase 5: Extension & Agent Updates (Week 5-6)
1. Update browser extension for tenant API keys
2. Update agent scripts with tenant context
3. Add API key management UI
4. Test end-to-end flow

### Phase 6: Launch Preparation (Week 6-7)
1. Add billing integration (Stripe)
2. Set up usage tracking
3. Configure limits enforcement
4. Production deployment

## Cost Estimates (Vercel + Supabase)

| Tier | Monthly Cost | Includes |
|------|-------------|----------|
| **Free** | $0 | 1 tenant, 500 contacts, community support |
| **Starter** | $29/mo | 3 team members, 5k contacts, 500 enrichments |
| **Pro** | $99/mo | 10 team members, 25k contacts, 2k enrichments |
| **Enterprise** | Custom | Unlimited, SSO, dedicated support |

**Infrastructure Costs:**
- Vercel Pro: $20/mo
- Supabase Pro: $25/mo
- Clerk: Free tier (10k MAU)
- Upstash: Free tier (10k commands/day)
- R2: ~$5/mo for exports

**Total Base:** ~$50/mo before customer revenue

## Security Considerations

1. **Row-Level Security** prevents cross-tenant data access
2. **API Key Hashing** protects tenant credentials
3. **Audit Logging** tracks all tenant actions
4. **Rate Limiting** per tenant prevents abuse
5. **Input Validation** on all tenant-scoped queries
6. **HTTPS Only** for all communications
7. **CSP Headers** for XSS protection

## Conclusion

This architecture provides a solid foundation for launching Network Navigator as a multi-tenant SaaS on Vercel. The shared schema with RLS approach balances simplicity with security, while the admin overlay gives you full operational control. The phased migration path minimizes risk and allows incremental delivery.
