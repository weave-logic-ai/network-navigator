# People Data Labs (PDL) Enrichment

## Overview

PDL is the primary paid enrichment provider. It resolves person data from LinkedIn URLs, emails, or name+company pairs via the [Person Enrich API](https://docs.peopledatalabs.com/docs/person-enrichment-api).

**Cost**: $0.10 per lookup (10 cents). PDL charges per API call, not per field — one call returns all available fields.

## API Tiers

PDL has two data tiers. The tier determines which fields return actual values vs boolean flags.

### Person Starter (current plan)
- **Price**: 5 free lookups/month
- **Returns actual values for**: name, linkedin_url, job_title, job_company_name, job_company_industry, skills, interests, experience, education, profiles
- **Returns `true`/`false` flags for**: work_email, personal_emails, recommended_personal_email, mobile_phone, phone_numbers, location_name, location_locality, location_region, street_addresses, birth_year, birth_date

The boolean flags indicate "PDL has this data" but the actual value is not included at this tier. The code filters these out via `isRealValue()` and reports them as "gated fields" in the UI.

### Person (full tier)
- **Price**: $110/month for 200 lookups
- **Returns actual values for**: ALL fields including email, phone, location
- **Upgrade path**: Required to get actual email addresses, phone numbers, and location details
- **When it makes sense**: Once the scoring engine identifies network hubs, referral hubs, or buying signals. Spending $0.10 on a confirmed Tier 1/Tier 2 contact for full email+phone is high-ROI. The ideal flow: composite scoring identifies high-value contacts → auto-enrich those via PDL Person tier → outreach with real contact details. Don't burn lookups on unscored bulk contacts.

### Field reference
- `docs/implementation-logs/pdl-basic-fields.md` — Person Starter field list (with True/False markers)
- `docs/implementation-logs/pdl-basic-deep.md` — Person (full) field list

## Architecture

```
Contact Detail Page  →  POST /api/enrichment/enrich  →  Waterfall Engine  →  PDL Provider
     (UI)                     (route.ts)                (waterfall.ts)       (pdl.ts)
                                  ↓
                         Write fields back to
                         contacts table via
                         updateContact()
```

### Key Files

| File | Purpose |
|------|---------|
| `app/src/lib/enrichment/providers/pdl.ts` | PDL API client and response mapping |
| `app/src/lib/enrichment/waterfall.ts` | Provider orchestration with budget/field-aware routing |
| `app/src/lib/enrichment/budget.ts` | Budget tracking and spend limits |
| `app/src/lib/enrichment/types.ts` | Shared type definitions |
| `app/src/app/api/enrichment/enrich/route.ts` | HTTP endpoint — enriches and writes back to DB |
| `app/src/app/api/enrichment/estimate/route.ts` | Cost estimation endpoint |
| `app/src/lib/db/queries/enrichment.ts` | DB queries for providers, budgets, transactions |
| `db/init/012-budget-schema.sql` | Schema: enrichment_providers, budget_periods, enrichment_transactions |

## How a Lookup Works

1. **UI triggers** `POST /api/enrichment/enrich` with `{ contactId, targetFields? }`
2. **Route** loads the contact from DB, builds an `EnrichmentContact` object
3. **Waterfall engine** (`enrichContact()`) iterates active providers by priority:
   - Checks if provider capabilities match requested target fields
   - Checks budget limits
   - Calls `provider.enrich(contact)`
   - Records transaction in `enrichment_transactions`
   - Updates budget spend
   - Stops early if all target fields are filled
4. **Route** writes returned fields back to the `contacts` table (only fills nulls)
5. **UI** reloads the contact to display new data

## PDL API Call

```
GET https://api.peopledatalabs.com/v5/person/enrich?profile=<linkedin_url>&email=<email>&name=<name>&company=<company>
Headers: X-Api-Key: <PDL_API_KEY>
```

Query parameters are set from whatever contact data is available. At minimum, a LinkedIn URL or email is needed for a match.

## Response Field Mapping

PDL returns a nested `{ status, data: { ... } }` structure. The `mapResponse()` method in `pdl.ts` extracts:

| PDL Field | Mapped To | Confidence | Notes |
|-----------|-----------|------------|-------|
| `work_email` | `email` | 0.9 | Preferred email source |
| `recommended_personal_email` | `email` | 0.8 | Fallback |
| `personal_emails[0]` | `email` | 0.7 | Last resort |
| `mobile_phone` | `phone` | 0.8 | Best phone source |
| `phone_numbers[0]` | `phone` | 0.7 | Array of E.164 strings |
| `job_title` | `title` | 0.9 | |
| `job_company_name` | `current_company` | 0.9 | |
| `location_name` | `location` | 0.8 | Full location string |
| `location_locality` + region + country | `location` | 0.7 | Assembled fallback |
| `industry` | `industry` | 0.8 | Person-level industry |
| `job_company_industry` | `industry` | 0.7 | Company-level fallback |
| `headline` | `headline` | 0.9 | |
| `summary` | `about` | 0.8 | |
| `linkedin_url` | `linkedin_url` | 0.95 | Canonical URL |
| `skills[].name` | `tags` | 0.7 | Comma-joined, merged with existing |
| `linkedin_connections` | `connections_count` | 0.9 | |

## Write-Back Rules

The enrich route only updates fields that are currently `null` or empty on the contact. This prevents overwriting manually-entered or extension-captured data.

Tags are merged (union of existing + new) rather than overwritten.

## Budget System

- Budgets are tracked per period (daily/weekly/monthly/yearly) in `budget_periods`
- Each enrichment call records a transaction in `enrichment_transactions`
- The waterfall engine checks remaining budget before calling each provider
- Default monthly budget: $100 (10,000 cents)

## Provider Priority (from DB seed)

| Priority | Provider | Cost | Capabilities |
|----------|----------|------|-------------|
| 5 | LinkedIn (Extension) | Free | profile, employment, education, skills, connections, activity |
| 10 | PDL | $0.10 | email, phone, social, employment, education |
| 20 | Lusha | $0.15 | email, phone, company |
| 30 | TheirStack | $0.05 | technographics, company |

The waterfall tries providers in priority order (lowest first), so the free LinkedIn extension runs before PDL.

## Field-Level Enrichment

Users can request specific fields via `targetFields`. The waterfall engine:
1. Checks if the field is already filled on the contact (skip if so)
2. Checks if a provider's capabilities match the requested field
3. Only calls providers that can fill at least one missing target field

Since PDL charges per lookup (not per field), requesting a single field still costs the full $0.10 but only writes back the requested field changes.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PDL_API_KEY` | Yes | API key from peopledatalabs.com |

The API key can also be stored in the provider's `config` JSONB column in `enrichment_providers`.

## Common Issues

### Phone not returned
PDL phone data availability depends on the person's public footprint. `mobile_phone` is the highest-quality source but is often `null`. `phone_numbers` (E.164 format array) is the fallback. If neither exists in PDL's database, no phone is returned.

### 404 responses
PDL returns HTTP 404 when it cannot match the person. This is not billed (costCents = 0).

### Rate limiting
PDL has rate limits per API key tier. The provider config supports `rate_limit_per_minute` but rate limiting is not currently enforced client-side.
