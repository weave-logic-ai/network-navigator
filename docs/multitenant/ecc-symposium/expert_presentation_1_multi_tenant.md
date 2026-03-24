# Expert Presentation 1: Multi-Tenant SaaS Architecture for Network Navigator

## Overview
This presentation covers the multi-tenant architecture plan for transforming Network Navigator from a single-tenant application to a scalable SaaS platform. The architecture leverages PostgreSQL Row-Level Security (RLS) with a shared schema approach, optimized for Vercel deployment.

## Key Topics

### 1. Current State Analysis
- Existing data model: contacts, companies, edges, clusters, enrichments, scoring, outreach, extension, and graph tables
- Single-tenant limitations: no data isolation, manual tenant separation required

### 2. Multi-Tenant Strategies Compared
| Strategy | Isolation Level | Complexity | Cost | Best For |
|----------|----------------|------------|------|----------|
| Shared Schema + tenant_id | Row-level | Low | $ | Early SaaS, rapid iteration |
| Separate Schemas | Schema-level | Medium | $$ | Compliance requirements, data residency |
| Separate Databases | Full isolation | High | $$$ | Enterprise tenants, strict compliance |

### 3. Recommended Approach: Shared Schema with RLS
- **Fast time-to-market**: minimal schema changes
- **Cost efficiency**: single database on Vercel Postgres or Supabase
- **Scalable**: supports ~1000 tenants before sharding
- **Migration path**: easy evolution to schema-per-tenant

### 4. Implementation Details
#### Schema Changes
- New `tenants` table with UUID primary key, slug, status, plan, settings, limits
- `tenant_users` table for membership and role mapping
- Addition of `tenant_id` UUID foreign key to all tenant-scoped tables

#### Row-Level Security Policies
- Enable RLS on all tables
- Tenant isolation policy: `tenant_id = current_setting('app.current_tenant_id')`
- Admin bypass policy for super administrators

### 5. Authentication & Authorization with Clerk
- Role mapping from Clerk roles to Network Navigator permissions
- Fine-grained permissions per role (owner, admin, member, viewer)
- Organization-based multi-tenant auth

### 6. Application Structure
- Public routes, auth routes, dashboard with tenant context, admin overlay
- API routes structured for tenant-scoped endpoints

### 7. Deployment on Vercel
- Infrastructure stack: Vercel (hosting), Supabase/Vercel Postgres (DB), Clerk (auth), Upstash (cache), Cloudflare R2 (storage)
- Environment variables configuration
- Cost estimates: ~$50/mo base infrastructure before customer revenue

### 8. Migration Path (Phased Approach)
1. Foundation: schema changes and default tenant creation
2. Auth Integration: Clerk setup and role-based access
3. RLS & Security: policy enforcement and audit logging
4. Admin Overlay: tenant management and monitoring
5. Extension Updates: browser extension and agent scripts
6. Launch Prep: billing, usage tracking, limits enforcement

### 9. Security Considerations
- Row-level security prevents cross-tenant data access
- API key hashing, audit logging, rate limiting, input validation
- HTTPS-only, CSP headers for XSS protection

### 10. Conclusion
This architecture provides a solid foundation for launching Network Navigator as a multi-tenant SaaS, balancing simplicity with security while offering a clear path to enterprise-scale deployment.
