# Multi-Tenant Architecture Diagram

## High-Level System Architecture

```
                                    ┌─────────────────────────────────────┐
                                    │         Client Layer               │
                                    ├─────────────────────────────────────┤
                                    │                                     │
│  ┌──────────────┐      ┌──────────────┐      ┌──────────────────────┐ │
│  │   Browser    │      │   Next.js    │      │      Agent CLI       │ │
│  │  Extension   │      │   Web App    │      │    (Claude Skill)    │ │
│  │              │      │              │      │                      │ │
│  │ Manifest V3  │      │  Dashboard   │      │  node prospect.mjs   │ │
│  │ React + TS   │      │  Admin Panel │      │                      │ │
│  └──────┬───────┘      └──────┬───────┘      └──────────┬───────────┘ │
│         │                     │                         │             │
│         │  X-API-Key          │  Cookie/Session         │  X-API-Key  │
│         │                     │                         │             │
└─────────┼─────────────────────┼─────────────────────────┼─────────────┘
          │                     │                         │
          └─────────────────────┼─────────────────────────┘
                                │
                    ┌───────────▼────────────┐
                    │    Vercel Edge         │
                    │   (Global CDN)         │
                    └───────────┬────────────┘
                                │
          ┌─────────────────────┼─────────────────────┐
          │                     │                     │
┌─────────▼─────────┐  ┌────────▼────────┐  ┌────────▼────────┐
│   Public Routes   │  │  Tenant Routes  │  │   Admin Routes  │
│   /, /pricing     │  │  /[tenant]/*    │  │    /admin/*     │
│                   │  │                 │  │                 │
│  No auth required │  │ Clerk + RLS     │  │ Super admin     │
│                   │  │ Tenant context  │  │ Bypass RLS      │
└─────────┬─────────┘  └────────┬────────┘  └────────┬────────┘
          │                     │                     │
          └─────────────────────┼─────────────────────┘
                                │
                    ┌───────────▼────────────┐
                    │    Auth Layer          │
                    │   (Clerk)              │
                    │                        │
                    │  • JWT validation      │
                    │  • Org membership      │
                    │  • Role claims         │
                    └───────────┬────────────┘
                                │
          ┌─────────────────────┼─────────────────────┐
          │                     │                     │
┌─────────▼─────────┐  ┌────────▼────────┐  ┌────────▼────────┐
│   API Routes      │  │  Middleware     │  │   API Keys      │
│  /api/v1/*        │  │  Tenant context │  │  /api/extension │
│                   │  │  RLS setup      │  │                 │
│  REST endpoints   │  │  Auth check     │  │  Hash validate  │
└─────────┬─────────┘  └────────┬────────┘  └────────┬────────┘
          │                     │                     │
          └─────────────────────┼─────────────────────┘
                                │
                    ┌───────────▼────────────┐
                    │    Data Layer          │
                    │  (PostgreSQL + RLS)    │
                    └───────────┬────────────┘
                                │
        ┌───────────────────────┼───────────────────────┐
        │                       │                       │
┌───────▼────────┐     ┌────────▼────────┐     ┌───────▼────────┐
│   Tenants      │     │  Tenant Data    │     │    Shared      │
│   (metadata)   │     │  (isolated)     │     │    Data        │
│                │     │                 │     │                │
│ • tenants      │     │ • contacts      │     │ • selector_    │
│ • tenant_users │     │ • companies     │     │   configs      │
│ • tenant_api_  │     │ • edges         │     │ • page_cache   │
│   keys         │     │ • scores        │     │   (structured) │
│ • audit_logs   │     │ • outreach      │     │                │
│ • usage        │     │ • * (25 tables) │     │                │
└────────────────┘     └─────────────────┘     └────────────────┘
        │                       │                       │
        │              ┌────────▼────────┐             │
        │              │   RLS Policies  │             │
        │              │                 │             │
        │              │ tenant_id =     │             │
        │              │ current_setting │             │
        │              │ ('app.current_  │             │
        │              │   tenant_id')   │             │
        │              └─────────────────┘             │
        │                       │                       │
        └───────────────────────┼───────────────────────┘
                                │
                    ┌───────────▼────────────┐
                    │   External Services    │
                    └────────────────────────┘
                                │
        ┌───────────────────────┼───────────────────────┐
        │                       │                       │
┌───────▼────────┐     ┌────────▼────────┐     ┌───────▼────────┐
│   Anthropic    │     │  Enrichment     │     │   Stripe       │
│   Claude API   │     │  APIs           │     │   Billing      │
│                │     │                 │     │                │
│ AI messaging   │     │ • PeopleDataLab │     │ Subscriptions  │
│ Outreach gen   │     │ • Apollo        │     │ Usage tracking │
│ Scoring        │     │ • Lusha         │     │ Invoicing      │
│                │     │ • TheirStack    │     │                │
└────────────────┘     └─────────────────┘     └────────────────┘
```

## Tenant Data Flow

```
User Request
     │
     ▼
┌─────────────────┐
│  Vercel Edge    │
│  (CDN/Cache)    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Next.js App    │
│  Router         │
└────────┬────────┘
         │
         ▼
┌─────────────────┐     No          ┌─────────────────┐
│  Authenticated? │───────────────▶  │  Return 401     │
└────────┬────────┘                  └─────────────────┘
         │ Yes
         ▼
┌─────────────────┐
│  Resolve Tenant │
│  from URL/Org   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐     No          ┌─────────────────┐
│  User Member    │───────────────▶  │  Return 403     │
│  of Tenant?     │                  └─────────────────┘
└────────┬────────┘
         │ Yes
         ▼
┌─────────────────┐
│  Set RLS        │
│  Context        │
│  (tenant_id)    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Execute Query  │◀────────────────┐
│                 │                 │
│  SELECT * FROM  │                 │
│  contacts       │                 │
│                 │                 │
│  (automatically │                 │
│   filtered by   │                 │
│   RLS policy)   │                 │
└────────┬────────┘                 │
         │                         │
         ▼                         │
┌─────────────────┐                │
│  PostgreSQL     │────────────────┘
│                 │
│  • Apply RLS    │
│  • Filter rows  │
│  • Return data  │
└─────────────────┘
         │
         ▼
┌─────────────────┐
│  Clear Context  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Return JSON    │
│  Response       │
└─────────────────┘
```

## Admin Data Flow (Bypass RLS)

```
Admin Request
     │
     ▼
┌─────────────────┐
│  Check Super    │     No          ┌─────────────────┐
│  Admin List     │───────────────▶  │  Return 403     │
└────────┬────────┘                  └─────────────────┘
         │ Yes
         ▼
┌─────────────────┐
│  Set Admin      │
│  Context        │
│  (is_super_     │
│   admin=true)   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Execute Query  │
│                 │
│  SELECT * FROM  │
│  contacts       │
│  (all tenants)  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  PostgreSQL     │
│                 │
│  • Admin bypass │
│  • Return all   │
│    rows         │
└─────────────────┘
         │
         ▼
┌─────────────────┐
│  Clear Context  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Return JSON    │
│  (all tenants)  │
└─────────────────┘
```

## Database Schema (Simplified)

```
┌─────────────────────────────────────────────────────────────┐
│                        tenants                               │
├─────────────────────────────────────────────────────────────┤
│ id (PK)     │ slug    │ name      │ plan  │ status │ limits │
├─────────────┼─────────┼───────────┼───────┼────────┼────────┤
│ uuid-1      │ acme    │ Acme Corp │ pro   │ active │ {...}  │
│ uuid-2      │ startup │ StartupX  │ free  │ active │ {...}  │
└─────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              │               │               │
              ▼               ▼               ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│  tenant_users   │ │ tenant_api_keys │ │  tenant_usage   │
├─────────────────┤ ├─────────────────┤ ├─────────────────┤
│ tenant_id (FK)  │ │ tenant_id (FK)  │ │ tenant_id (FK)  │
│ user_id         │ │ key_hash        │ │ period_start    │
│ email           │ │ key_prefix      │ │ contacts_count  │
│ role            │ │ permissions     │ │ enrich_count    │
└─────────────────┘ └─────────────────┘ └─────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  contacts (and 24 other tenant-scoped tables)                │
├─────────────────────────────────────────────────────────────┤
│ id (PK)     │ tenant_id (FK) │ linkedin_url │ full_name    │
├─────────────┼────────────────┼──────────────┼──────────────┤
│ contact-1   │ uuid-1         │ linkedin.com │ John Doe     │
│ contact-2   │ uuid-1         │ linkedin.com │ Jane Smith   │
│ contact-3   │ uuid-2         │ linkedin.com │ Bob Wilson   │
└─────────────────────────────────────────────────────────────┘
         │
         │ RLS Policy: tenant_id = current_setting('app.current_tenant_id')
         │
         ▼
    ┌────────────┐
    │   User     │
    │  can only  │
    │  see rows  │
    │ where      │
    │ tenant_id  │
    │ matches    │
    └────────────┘
```

## Extension Authentication Flow

```
Browser Extension
       │
       │ 1. Read API key from storage
       │
       ▼
┌─────────────────┐
│  X-API-Key:     │
│  nn_live_xxx    │
└────────┬────────┘
         │
         │ 2. POST /api/extension/capture
         │
         ▼
┌─────────────────┐
│  Validate Key   │
│  • Check hash   │
│  • Check expiry │
│  • Check revoke │
└────────┬────────┘
         │
         │ 3. Extract tenant_id
         ▼
┌─────────────────┐
│  Set RLS        │
│  Context        │
└────────┬────────┘
         │
         │ 4. Insert data
         ▼
┌─────────────────┐
│  raw_captures   │
│  (tenant scoped)│
└─────────────────┘
```

## Scaling Considerations

### Current (Single DB)
```
┌─────────────────────────────────────┐
│         PostgreSQL (Primary)        │
│  ┌─────────┬─────────┬─────────┐   │
│  │ Tenant1 │ Tenant2 │ TenantN │   │
│  │  (RLS)  │  (RLS)  │  (RLS)  │   │
│  └─────────┴─────────┴─────────┘   │
│                                     │
│  ~1000 tenants max                  │
└─────────────────────────────────────┘
```

### Future (Read Replicas)
```
┌─────────────────────────────────────┐
│         PostgreSQL (Primary)        │
│          Write operations           │
└──────────────┬──────────────────────┘
               │
       ┌───────┴───────┐
       ▼               ▼
┌─────────────┐ ┌─────────────┐
│  Replica 1  │ │  Replica 2  │
│  (Read)     │ │  (Read)     │
└─────────────┘ └─────────────┘
```

### Future (Sharding by Tenant)
```
┌─────────────────────────────────────┐
│         Router Layer                │
│    (tenant_id → database)           │
└──────────┬────────────┬─────────────┘
           │            │
     ┌─────┴─────┐ ┌────┴────┐
     ▼           ▼ ▼         ▼
┌─────────┐ ┌─────────┐ ┌─────────┐
│  DB A   │ │  DB B   │ │  DB C   │
│(tenants │ │(tenants │ │(tenants │
│ A-M)    │ │ N-Z)    │ │enterprise
└─────────┘ └─────────┘ └─────────┘
```
