# ICP Alignment Engine — Natural vs Desired ICP Gap Analysis

**Status**: Design Document
**Date**: 2026-03-24

---

## Core Concept

Two ICP profiles that together drive strategy:

| ICP | Source | Purpose |
|-----|--------|---------|
| **Natural ICP** | Auto-computed from owner profile + network composition | "Who your network already looks like" — your current position |
| **Desired ICP** | User-selected niche/ICP/offering combination saved on profile page | "Who you want to attract" — your target position |

The **gap** between them drives:
- Profile optimization suggestions ("Add 'HIPAA' to your headline to attract healthcare buyers")
- Content strategy ("Post about these 3 topics to signal expertise in [Desired Niche]")
- Network growth tasks ("Connect with 15 more [Desired ICP] contacts to shift your network composition")
- Signal alignment ("Your skills section doesn't mention [key term] — add it")

---

## Data Model

### Natural ICP Computation

Derived from two weighted sources:

**Owner Profile (60% weight)** — what you present to the world:
```
Inputs:
  - headline keywords → target industries, signals
  - positions history → role expertise, company size experience
  - skills array → technical/domain signals
  - summary/about → positioning language
  - certifications → credibility signals
  - endorsements received → what others see in you
  - recommendations received → social proof themes

Output:
  - industries you signal expertise in
  - roles you appear to serve (based on headline language like "Helping [X]")
  - company size affinity (from your work history)
  - skill-derived signals
```

**Network Composition (40% weight)** — who already surrounds you:
```
Inputs:
  - title distribution of 1st-degree connections (top roles)
  - industry distribution of connections' companies
  - most common company size range
  - niche membership distribution

Output:
  - industries your network clusters in
  - role patterns your network has
  - company size your network gravitates toward
  - niche affinities
```

**Combined Natural ICP**:
```typescript
interface NaturalICP {
  id: string;  // stored in icp_profiles with source='natural'

  // Weighted merge of owner profile + network signals
  roles: string[];           // e.g., ["CEO", "Founder", "VP Engineering"]
  industries: string[];      // e.g., ["e-commerce", "SaaS", "consulting"]
  signals: string[];         // e.g., ["scaling", "automation", "modernization"]
  companySizeRanges: string[];

  // Source breakdown (for transparency)
  profileSignals: {
    headlineKeywords: string[];
    skillSignals: string[];
    positionIndustries: string[];
    aboutThemes: string[];
  };
  networkSignals: {
    topRoles: Array<{ role: string; count: number }>;
    topIndustries: Array<{ industry: string; count: number }>;
    topNiches: Array<{ niche: string; count: number }>;
  };

  computedAt: string;
}
```

### Desired ICP

User-configured on the Profile page using the same niche/ICP/offering selectors from Discover:

```typescript
interface DesiredICP {
  id: string;  // stored in icp_profiles with source='desired'

  // User-selected combination
  nicheId: string;            // Which niche they want to serve
  icpId: string;              // Which ICP they want to attract
  offeringIds: string[];      // Which offerings they want to sell

  // Derived criteria (from the selected ICP + niche keywords)
  roles: string[];
  industries: string[];
  signals: string[];
  nicheKeywords: string[];

  // User overrides (can customize after selection)
  customRoles?: string[];
  customSignals?: string[];

  savedAt: string;
  isDefault: boolean;  // If true, this is the default ICP on Discover page
}
```

### Gap Analysis

```typescript
interface ICPGapAnalysis {
  naturalIcp: NaturalICP;
  desiredIcp: DesiredICP;

  // Alignment score: 0-1, how close your profile/network is to the desired ICP
  alignmentScore: number;

  // Per-dimension gaps
  gaps: {
    // Industries you want to target but don't signal
    missingIndustries: string[];
    // Roles you want to attract but your network lacks
    missingRoles: string[];
    // Signals/keywords missing from your profile
    missingSignals: string[];
    // Niche keywords not in your headline/about/skills
    missingNicheKeywords: string[];
    // Company size mismatch
    companySizeMismatch: boolean;
  };

  // Strength areas (already aligned)
  strengths: {
    sharedIndustries: string[];
    sharedRoles: string[];
    sharedSignals: string[];
    nicheContactCount: number;  // How many contacts already match desired niche
  };

  // Actionable suggestions
  suggestions: Suggestion[];
}

interface Suggestion {
  type: 'profile_update' | 'content' | 'network_growth' | 'skill_add' | 'engagement';
  title: string;
  description: string;
  impact: 'high' | 'medium' | 'low';
  effort: 'quick' | 'moderate' | 'significant';

  // When clicked, creates a task
  taskTemplate: {
    title: string;
    description: string;
    taskType: string;
    url?: string;
  };
}
```

---

## Suggestion Types

### Profile Update Suggestions

Based on gaps between what your profile says and what the desired ICP looks for:

| Gap Detected | Suggestion | Example |
|-------------|-----------|---------|
| Missing industry keyword in headline | "Add [keyword] to your headline" | "Add 'healthcare' to attract Health Tech Founders" |
| Missing signal in about section | "Mention [signal] in your About" | "Reference 'HIPAA compliance' in your summary" |
| Missing skill | "Add [skill] to your Skills section" | "Add 'Shopify Plus' to signal e-commerce expertise" |
| No offerings mentioned | "Reference your [offering] in headline" | "Add 'Fractional CTO' to your headline pipe" |
| Headline doesn't target desired niche | "Rewrite headline to speak to [niche]" | "Change headline to address D2C brand operators" |

### Content Strategy Suggestions

Based on what the desired ICP's niche talks about vs what you post about:

| Gap Detected | Suggestion | Example |
|-------------|-----------|---------|
| Niche keywords not in your content | "Post about [topic]" | "Write about headless commerce migration" |
| ICP pain points not addressed | "Create content addressing [pain]" | "Share a case study about scaling Shopify stores" |
| Low visibility in niche | "Engage with [niche] content" | "Comment on 3 e-commerce posts this week" |
| No thought leadership | "Publish article on [topic]" | "Write about composable commerce architecture" |

### Network Growth Suggestions

Based on the gap between current niche contacts and target:

| Gap Detected | Suggestion | Example |
|-------------|-----------|---------|
| Low niche coverage | "Connect with [N] more [niche] contacts" | "Find 15 more D2C brand operators" |
| Missing hub connections | "Connect with [hub] in [niche]" | "Connect with top e-commerce influencers" |
| No 2nd degree paths | "Explore [contact]'s network" | "Browse connections of your e-commerce hubs" |

---

## Profile Page Integration

### New "ICP Alignment" Section on /profile

```
┌─────────────────────────────────────────────────────────┐
│ Your ICP Alignment                                      │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ ┌─ Natural ICP (computed) ──┐  ┌─ Desired ICP ────────┐ │
│ │ Industries: e-commerce,   │  │ [Niche: ▼ D2C Brands]│ │
│ │   SaaS, consulting        │  │ [ICP: ▼ Brand Ops   ]│ │
│ │ Roles: CEO, VP Eng, CTO   │  │ [Offerings: ▼ ...]   │ │
│ │ Signals: scaling,          │  │                      │ │
│ │   automation, modernize    │  │ [Save as Default]    │ │
│ │ Network: 242 ecomm,        │  │ [✓ Show on Discover] │ │
│ │   478 engineering           │  │                      │ │
│ └────────────────────────────┘  └──────────────────────┘ │
│                                                         │
│ Alignment Score: ████████░░ 72%                          │
│                                                         │
│ Gaps:                                                   │
│ ⚠ Missing "Shopify Plus" from skills                    │
│ ⚠ Headline doesn't mention e-commerce                   │
│ ⚠ Only 6 contacts in D2C niche (target: 25)             │
│                                                         │
│ Suggestions:                                            │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ 🔴 HIGH: Add "e-commerce" to headline              │ │
│ │ Your headline signals SaaS/consulting but not       │ │
│ │ e-commerce. D2C operators search for this keyword.  │ │
│ │ [Create Task →]                                     │ │
│ ├─────────────────────────────────────────────────────┤ │
│ │ 🟡 MED: Post about headless commerce               │ │
│ │ 0 posts about this topic. D2C niche keywords        │ │
│ │ include "headless", "composable commerce".          │ │
│ │ [Create Content Task →]                             │ │
│ ├─────────────────────────────────────────────────────┤ │
│ │ 🟢 LOW: Connect with 15 more D2C brand operators   │ │
│ │ Only 6/25 target contacts. Search LinkedIn for      │ │
│ │ "Head of E-Commerce" + "Shopify".                   │ │
│ │ [Create Search Task →]                              │ │
│ └─────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

### Discover Page Integration

When a Desired ICP is saved with `isDefault = true`:
- Discover page pre-selects that niche/ICP in the dropdowns
- Wedge chart highlights the desired niche's wedge
- People panel pre-filters to the desired ICP
- Goal engine uses the desired ICP for context-aware suggestions

---

## Implementation

### Schema Additions

```sql
-- Add source and is_default to icp_profiles
ALTER TABLE icp_profiles ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'user';
-- source values: 'user', 'system', 'natural', 'desired'

-- Store desired ICP config on owner profile
-- owner_profiles.metadata will include:
-- {
--   "activeIcpId": "uuid",
--   "desiredIcpConfig": {
--     "nicheId": "uuid",
--     "icpId": "uuid",
--     "offeringIds": ["uuid"],
--     "isDefault": true
--   },
--   "naturalIcpId": "uuid"
-- }
```

### Files to Create

| File | Purpose |
|------|---------|
| `lib/scoring/natural-icp.ts` | Compute Natural ICP from owner profile + network |
| `lib/scoring/icp-gap-analysis.ts` | Compare Natural vs Desired, produce gaps + suggestions |
| `components/profile/icp-alignment.tsx` | Profile page ICP alignment section |
| `components/profile/gap-suggestions.tsx` | Suggestion cards with "Create Task" buttons |
| `components/profile/desired-icp-selector.tsx` | Niche/ICP/Offering selector (reuses Discover components) |
| `app/api/profile/natural-icp/route.ts` | GET: compute and return natural ICP |
| `app/api/profile/desired-icp/route.ts` | GET/POST: manage desired ICP config |
| `app/api/profile/gap-analysis/route.ts` | GET: run gap analysis between natural and desired |

### Computation Flow

```
1. Import / Profile Update
   → computeNaturalICP(ownerProfile, networkStats)
   → store as icp_profiles with source='natural'

2. User saves Desired ICP on Profile page
   → store config in owner_profiles.metadata
   → create/update icp_profiles with source='desired'
   → if isDefault, update Discover page defaults

3. Gap Analysis (on-demand or on profile view)
   → load Natural ICP + Desired ICP
   → compare criteria arrays
   → check owner profile fields against desired signals
   → generate suggestions ranked by impact
   → return ICPGapAnalysis

4. Suggestion → Task
   → User clicks "Create Task" on a suggestion
   → Task created with appropriate type, URL, and description
   → Task appears on Goals & Tasks page
   → Goal engine can also generate these suggestions as goals
```

### Integration with Goal Engine

The goal engine gets a new check:

```typescript
// In checks/icp-checks.ts
async function profileAlignmentGap(ctx: TickContext): Promise<GoalCandidate[]> {
  // Only fire on profile or discover page
  if (ctx.page !== 'discover' && ctx.page !== 'dashboard') return [];

  // Load desired ICP config
  // If alignment score < 0.5, suggest top gap fix
  // "Your profile doesn't signal [desired niche] — update your headline"
}
```

---

## Priority

| Phase | What | When |
|-------|------|------|
| 1 | Natural ICP computation (runs on import) | With import pipeline update |
| 2 | Profile page: desired ICP selector with save | After profile components exist |
| 3 | Gap analysis engine | After both ICPs computable |
| 4 | Suggestion generation + task creation | After gap analysis |
| 5 | Discover page defaults from desired ICP | After desired ICP saves |
| 6 | Goal engine integration | After suggestion system works |
