# Enrichment Provider Matrix

## Provider Comparison

| Provider | Cost/Lookup | Email | Phone | Location | Title/Company | Skills | Other | Status |
|----------|------------|-------|-------|----------|---------------|--------|-------|--------|
| LinkedIn (Extension) | Free | - | - | yes | yes | yes | headline, about, connections, education, experience | Active |
| PDL (Starter) | $0.10 | flag | flag | flag | yes | yes | industry, headline, linkedin_url | Active |
| PDL (Person) | $0.10* | yes | yes | yes | yes | yes | all fields | Requires upgrade |
| Apollo.io | $0.08 | yes | yes | - | yes | - | headline, linkedin_url | Implemented |
| Lusha | $0.15 | yes | yes | - | company | - | - | Implemented |
| TheirStack | $0.05 | - | - | - | - | - | technographics, industry, employee count, website | Implemented |
| Crunchbase | $0.20 | - | - | - | company | - | funding, leadership | DB seed only |
| BuiltWith | $0.12 | - | - | - | - | - | technographics, website | DB seed only |

**flag** = PDL Starter tier returns `true`/`false` indicating data exists but value is not included.

*PDL Person tier requires $110/month subscription for 200 lookups. Starter plan includes 5 free/month.

## Waterfall Priority

Providers run in priority order (lowest number first). The waterfall stops early once all requested fields are filled.

| Priority | Provider | Notes |
|----------|----------|-------|
| 5 | LinkedIn (Extension) | Free, async via browser extension |
| 10 | PDL | Best breadth of data on Starter, but email/phone/location gated |
| 20 | Lusha | Real email + phone, higher cost |
| 30 | TheirStack | Company/tech data only |
| 40 | Apollo.io | Cheapest for real email + phone |
| 50 | Crunchbase | Company intel (not implemented) |
| 60 | BuiltWith | Tech stack (not implemented) |

## Best Provider per Field

| Field | Cheapest Provider | Cost | Alternative | Alt Cost |
|-------|------------------|------|-------------|----------|
| Email | Apollo.io | $0.08 | Lusha | $0.15 |
| Phone | Apollo.io | $0.08 | Lusha | $0.15 |
| Location | LinkedIn (Extension) | Free | PDL Person | $0.10* |
| Job Title | LinkedIn (Extension) | Free | Apollo.io | $0.08 |
| Company | LinkedIn (Extension) | Free | TheirStack | $0.05 |
| Skills/Tags | LinkedIn (Extension) | Free | PDL | $0.10 |
| Industry | TheirStack | $0.05 | PDL | $0.10 |
| Headline | LinkedIn (Extension) | Free | PDL | $0.10 |
| Technographics | TheirStack | $0.05 | BuiltWith | $0.12 |

## PDL Tier Details

### Person Starter (current plan)

5 free lookups/month. Returns actual values for:
- name, linkedin_url, job_title, job_company_name, job_company_industry
- skills, interests, experience, education, profiles

Returns `true`/`false` flags (not actual values) for:
- work_email, personal_emails, recommended_personal_email
- mobile_phone, phone_numbers
- location_name, location_locality, location_region
- street_addresses, birth_year, birth_date

### Person (full tier)

$110/month for 200 lookups. Returns actual values for ALL fields.

**When to upgrade**: PDL Person tier becomes high-value once the scoring engine identifies real network hubs, referral hubs, or buying signals. At that point, spending $0.10/lookup on a confirmed high-value contact (with full email, phone, location) is a no-brainer ROI compared to the cost of missing a warm intro or buyer. The upgrade path should be tied to scoring tiers — e.g., auto-enrich via PDL Person for contacts scored as Tier 1 or Tier 2 after the composite scoring identifies them as hubs or prospects.

Reference docs:
- `docs/implementation-logs/pdl-basic-fields.md` — Starter tier fields
- `docs/implementation-logs/pdl-basic-deep.md` — Person (full) tier fields

## Provider Authentication

| Provider | Env Variable | Auth Method |
|----------|-------------|-------------|
| PDL | `PDL_API_KEY` | `X-Api-Key` header |
| Apollo.io | `APOLLO_API_KEY` | `x-api-key` header |
| Lusha | `LUSHA_API_KEY` | `api_key` header |
| TheirStack | `THEIRSTACK_API_KEY` | Bearer token |
| LinkedIn | N/A | Browser extension (no API key) |

## Implementation Files

| File | Purpose |
|------|---------|
| `app/src/lib/enrichment/providers/pdl.ts` | PDL provider |
| `app/src/lib/enrichment/providers/apollo.ts` | Apollo.io provider |
| `app/src/lib/enrichment/providers/lusha.ts` | Lusha provider |
| `app/src/lib/enrichment/providers/theirstack.ts` | TheirStack provider |
| `app/src/lib/enrichment/providers/linkedin.ts` | LinkedIn extension provider |
| `app/src/lib/enrichment/waterfall.ts` | Provider orchestration |
| `app/src/lib/enrichment/budget.ts` | Budget tracking |
| `app/src/lib/enrichment/field-map.ts` | Field name mapping |
| `db/init/012-budget-schema.sql` | Provider/budget DB schema + seed data |
