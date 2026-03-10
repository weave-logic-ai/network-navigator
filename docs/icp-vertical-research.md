# ICP Vertical Research: LinkedIn Prospector Multi-Industry Configurations

**Date:** 2026-03-10
**Purpose:** Comprehensive ICP configurations, LinkedIn prospecting signals, and buyer persona mappings across 15+ industry verticals for the LinkedIn Prospector tool.

---

## Table of Contents

1. [How to Use This Document](#how-to-use-this-document)
2. [Cross-Vertical Patterns and Best Practices](#cross-vertical-patterns-and-best-practices)
3. [Vertical 1: SaaS Sales Rep (Outbound Prospecting)](#vertical-1-saas-sales-rep-outbound-prospecting)
4. [Vertical 2: Executive Recruiter / Headhunter](#vertical-2-executive-recruiter--headhunter)
5. [Vertical 3: Management Consultant (Big 4 / Boutique)](#vertical-3-management-consultant-big-4--boutique)
6. [Vertical 4: Cybersecurity Sales / vCISO](#vertical-4-cybersecurity-sales--vciso)
7. [Vertical 5: Financial Advisor / Wealth Manager](#vertical-5-financial-advisor--wealth-manager)
8. [Vertical 6: Commercial Real Estate Broker](#vertical-6-commercial-real-estate-broker)
9. [Vertical 7: Healthcare IT Consultant](#vertical-7-healthcare-it-consultant)
10. [Vertical 8: Marketing Agency Owner (Mid-Market)](#vertical-8-marketing-agency-owner-mid-market)
11. [Vertical 9: Manufacturing / Supply Chain Consultant](#vertical-9-manufacturing--supply-chain-consultant)
12. [Vertical 10: Senior Java Developer (Contract/Consulting)](#vertical-10-senior-java-developer-contractconsulting)
13. [Vertical 11: EdTech Sales / University Partnerships](#vertical-11-edtech-sales--university-partnerships)
14. [Vertical 12: Legal Tech / Law Firm Business Development](#vertical-12-legal-tech--law-firm-business-development)
15. [Vertical 13: Startup Founder (Investor Prospecting)](#vertical-13-startup-founder-investor-prospecting)
16. [Vertical 14: Recruiting / HR Manager (Talent Sourcing)](#vertical-14-recruiting--hr-manager-talent-sourcing)
17. [Vertical 15: Regional VP of Marketing (Large Brand/Retailer)](#vertical-15-regional-vp-of-marketing-large-brandretailer)
18. [Scoring Weight Recommendations by Vertical](#scoring-weight-recommendations-by-vertical)
19. [Role Hierarchy Patterns by Industry](#role-hierarchy-patterns-by-industry)
20. [LinkedIn Profile Signal Taxonomy](#linkedin-profile-signal-taxonomy)

---

## How to Use This Document

Each vertical section provides a complete, copy-pasteable ICP configuration that can be fed to the LinkedIn Prospector's `configure.mjs generate --json` command. The structure matches the existing `icp-config.json` schema:

```json
{
  "profiles": { ... },
  "scoring": { "roleWeight": 0.35, "industryWeight": 0.25, "signalWeight": 0.25, "companySizeWeight": 0.15 },
  "goldScore": { "icpWeight": 0.35, "networkHubWeight": 0.30, "relationshipWeight": 0.25, "signalBoostWeight": 0.10 },
  "tiers": { "gold": 0.55, "silver": 0.40, "bronze": 0.28 },
  "niches": { ... }
}
```

**Key conventions:**
- `rolePatterns` use **partial-match keywords** (e.g., "VP" matches "VP Engineering", "VP Sales", etc.)
- `industries` are **lowercase** keywords/phrases that appear in LinkedIn profiles and company descriptions
- `signals` are **buying intent** keywords found in headlines, about sections, and experience descriptions
- `companySizeSweet` defines the ideal employee-count range for target companies

---

## Cross-Vertical Patterns and Best Practices

### LinkedIn Prospecting Signal Categories

Buying signals on LinkedIn fall into five categories, applicable across all verticals:

| Signal Category | Where Found | Examples |
|----------------|-------------|---------|
| **Pain Signals** | Headline, About | "struggling with", "looking to improve", "need help with" |
| **Initiative Signals** | About, Experience | "launching", "implementing", "migrating to", "evaluating" |
| **Growth Signals** | Headline, About | "scaling", "expanding", "growing team", "series A/B/C" |
| **Role-Change Signals** | Experience dates | New role in last 90 days = budget cycle reset, open to new vendors |
| **Technology Signals** | Skills, About | Specific platforms, tools, or methodologies mentioned |

### Universal High-Value Behavioral Indicators

These LinkedIn profile patterns indicate high engagement and openness to outreach regardless of industry:

- **Pipe-separated headlines** (e.g., "CEO | Speaker | Advisor") -- socially savvy, personal-brand aware
- **"Helping" language** in headline ("Helping [persona] achieve [outcome]") -- sales-minded, open to conversations
- **500+ connections** -- networkers who accept outreach
- **Creator mode enabled** -- active on platform, responsive to DMs
- **Recent content activity** -- commenting/posting weekly = engaged
- **Multiple group memberships** -- industry-involved, community-oriented
- **Recommendations given** (not just received) -- relationship builders

### Role Hierarchy: Buyer vs. Influencer vs. Implementer

Understanding the decision-making chain is critical for scoring. The pattern varies by deal size:

| Deal Size | Buyer (Budget Authority) | Influencer (Recommends) | Implementer (Uses) |
|-----------|-------------------------|------------------------|-------------------|
| < $10K | Director, VP | Manager, Lead | IC, Analyst |
| $10K-$100K | VP, SVP, C-suite | Director, Sr. Manager | Manager, Lead |
| $100K-$500K | C-suite, President | VP, SVP | Director, Manager |
| > $500K | CEO, Board, CFO | C-suite, SVP | VP, Director |

---

## Vertical 1: SaaS Sales Rep (Outbound Prospecting)

### Persona Description
An Account Executive or SDR at a B2B SaaS company selling a horizontal product (e.g., CRM, analytics, project management, communication tool) to mid-market and enterprise companies. They need to find and prioritize decision-makers who have budget authority and active need for their solution category.

### ICP Profiles

```json
{
  "profiles": {
    "saas-enterprise-buyer": {
      "label": "Enterprise Software Buyer",
      "description": "Senior leaders with budget authority for SaaS purchasing decisions",
      "rolePatterns": {
        "high": ["CIO", "CTO", "Chief Information", "Chief Technology", "Chief Digital", "Chief Revenue", "VP IT", "VP Information Technology"],
        "medium": ["VP Engineering", "VP Operations", "VP Sales", "Director IT", "Director Engineering", "Head of IT", "Head of Engineering", "Head of Revenue Operations"],
        "low": ["IT Manager", "Engineering Manager", "Systems Administrator", "Solutions Architect", "RevOps Manager"]
      },
      "industries": ["financial services", "banking", "insurance", "healthcare", "manufacturing", "logistics", "retail", "professional services", "technology", "telecommunications", "media", "energy"],
      "signals": ["digital transformation", "cloud migration", "modernization", "evaluating solutions", "rfp", "vendor selection", "tech stack", "consolidation", "integration", "streamline operations", "roi", "total cost of ownership"],
      "companySizeSweet": { "min": 200, "max": 5000 },
      "weight": 1.0
    },
    "saas-mid-market-champion": {
      "label": "Mid-Market Champion",
      "description": "Hands-on leaders who evaluate and recommend tools internally",
      "rolePatterns": {
        "high": ["Director IT", "Director Engineering", "Director Operations", "Head of IT", "Head of RevOps", "Head of Sales Ops"],
        "medium": ["Senior Manager", "IT Manager", "Engineering Manager", "Operations Manager", "Sales Operations Manager"],
        "low": ["Team Lead", "Project Manager", "Business Analyst", "Solutions Architect"]
      },
      "industries": ["saas", "software", "technology", "fintech", "insurtech", "healthtech", "martech", "adtech", "proptech"],
      "signals": ["implementing", "rolling out", "migrating from", "replacing", "upgrading", "evaluating", "poc", "proof of concept", "pilot program", "tech stack audit"],
      "companySizeSweet": { "min": 50, "max": 500 },
      "weight": 0.85
    }
  },
  "niches": {
    "enterprise-it": ["CIO", "IT director", "enterprise technology", "digital transformation"],
    "revops": ["revenue operations", "sales operations", "RevOps", "GTM operations"],
    "mid-market-tech": ["IT manager", "systems administrator", "technology leader", "software buyer"]
  }
}
```

### Example User Prompts
- "Find IT directors at financial services companies with 200-2000 employees who mention cloud migration"
- "Score my connections for enterprise SaaS buyer fit -- prioritize anyone mentioning vendor evaluation or RFP"
- "Search for RevOps leaders at mid-market SaaS companies"
- "Who in my network is a CIO or VP IT at a healthcare or manufacturing company?"

---

## Vertical 2: Executive Recruiter / Headhunter

### Persona Description
A retained or contingency executive recruiter who places C-suite and VP-level candidates at companies. They use LinkedIn to both source candidates AND develop client relationships with hiring managers and HR leaders. Dual ICP: one for candidate sourcing, one for client development.

### ICP Profiles

```json
{
  "profiles": {
    "hiring-authority": {
      "label": "Hiring Authority (Client)",
      "description": "Executives who authorize and fund executive searches",
      "rolePatterns": {
        "high": ["CEO", "President", "COO", "Chief Operating", "CHRO", "Chief Human Resources", "Chief People", "CPO"],
        "medium": ["VP Human Resources", "VP People", "VP Talent", "SVP HR", "Head of People", "Head of Talent Acquisition", "Head of HR"],
        "low": ["Director HR", "Director Talent Acquisition", "Director People Operations", "Talent Acquisition Manager"]
      },
      "industries": ["technology", "financial services", "healthcare", "life sciences", "pharmaceutical", "manufacturing", "consumer goods", "private equity", "venture capital", "professional services", "energy"],
      "signals": ["hiring", "growing team", "scaling", "executive search", "leadership team", "building out", "new hire", "succession planning", "organizational transformation", "rapid growth", "we are hiring"],
      "companySizeSweet": { "min": 100, "max": 10000 },
      "weight": 1.0
    },
    "passive-candidate": {
      "label": "Passive Executive Candidate",
      "description": "Employed executives who could be placed at client companies",
      "rolePatterns": {
        "high": ["CEO", "CFO", "CTO", "COO", "CMO", "CRO", "Chief Revenue", "Chief Financial", "Chief Marketing", "President", "General Manager"],
        "medium": ["SVP", "Senior Vice President", "EVP", "Executive Vice President", "VP", "Vice President", "Managing Director"],
        "low": ["Director", "Senior Director", "Head of", "Principal"]
      },
      "industries": ["technology", "software", "saas", "fintech", "healthtech", "biotech", "manufacturing", "consumer goods", "retail", "media", "energy", "consulting"],
      "signals": ["open to opportunities", "looking for new", "in transition", "available for", "board member", "advisor", "recently left", "15+ years", "20+ years", "turnaround", "transformation leader", "p&l responsibility"],
      "companySizeSweet": { "min": 50, "max": 50000 },
      "weight": 0.9
    },
    "referral-source": {
      "label": "Referral Source",
      "description": "Well-connected professionals who can refer candidates and clients",
      "rolePatterns": {
        "high": ["Partner", "Managing Partner", "Executive Coach", "Board Member", "Venture Partner", "Operating Partner"],
        "medium": ["Consultant", "Advisor", "Principal", "Managing Director"],
        "low": ["Senior Manager", "Director", "VP"]
      },
      "industries": ["executive search", "recruiting", "staffing", "consulting", "private equity", "venture capital", "coaching", "advisory"],
      "signals": ["connector", "introductions", "network", "advisory board", "board of directors", "portfolio company", "operating partner", "executive coach", "talent advisor"],
      "companySizeSweet": { "min": 1, "max": 5000 },
      "weight": 0.75
    }
  },
  "niches": {
    "hr-leaders": ["CHRO", "VP Human Resources", "Head of People", "Chief People Officer"],
    "c-suite-tech": ["CTO", "CIO", "VP Engineering", "Chief Technology Officer"],
    "c-suite-finance": ["CFO", "Chief Financial Officer", "VP Finance", "Controller"],
    "pe-vc": ["private equity", "venture capital", "portfolio company", "managing partner"],
    "open-to-work": ["open to opportunities", "in transition", "seeking new role"]
  }
}
```

### Example User Prompts
- "Find CHROs and VP People at companies with 500+ employees who mention growing their team or hiring"
- "Score my network for passive C-suite candidates in technology and fintech"
- "Who in my connections is a well-connected executive coach or board member who could refer candidates?"
- "Search for HR leaders at private equity portfolio companies"

---

## Vertical 3: Management Consultant (Big 4 / Boutique)

### Persona Description
A partner or senior manager at a consulting firm (McKinsey, Deloitte, Accenture, BCG, or a boutique) who needs to develop client relationships with C-suite executives facing strategic, operational, or digital transformation challenges. Alternatively, a boutique consultant selling strategy, operations, or M&A advisory services.

### ICP Profiles

```json
{
  "profiles": {
    "transformation-sponsor": {
      "label": "Transformation Sponsor",
      "description": "C-suite executives sponsoring large-scale transformation initiatives",
      "rolePatterns": {
        "high": ["CEO", "President", "COO", "Chief Operating", "Chief Strategy", "Chief Transformation", "Chief Digital", "Managing Director"],
        "medium": ["SVP Strategy", "SVP Operations", "VP Strategy", "VP Corporate Development", "VP Transformation", "Head of Strategy", "Head of Corporate Development"],
        "low": ["Director Strategy", "Director Operations", "Director Corporate Development", "Strategy Manager", "Chief of Staff"]
      },
      "industries": ["financial services", "banking", "insurance", "healthcare", "life sciences", "energy", "utilities", "telecommunications", "aerospace", "defense", "government", "public sector", "transportation", "logistics"],
      "signals": ["transformation", "restructuring", "merger", "acquisition", "post-merger integration", "cost optimization", "operating model", "organizational redesign", "strategic review", "divestiture", "carve-out", "turnaround", "change management"],
      "companySizeSweet": { "min": 500, "max": 50000 },
      "weight": 1.0
    },
    "digital-strategy-buyer": {
      "label": "Digital Strategy Buyer",
      "description": "Leaders driving digital and technology strategy engagements",
      "rolePatterns": {
        "high": ["CIO", "CTO", "CDO", "Chief Digital", "Chief Data", "Chief Analytics"],
        "medium": ["VP Digital", "VP Technology", "VP Data", "VP Analytics", "Head of Digital", "Head of Data", "Head of Innovation"],
        "low": ["Director Digital", "Director Technology", "Director Analytics", "Director Innovation"]
      },
      "industries": ["financial services", "retail", "consumer goods", "media", "entertainment", "telecommunications", "healthcare", "manufacturing", "automotive"],
      "signals": ["digital strategy", "data strategy", "analytics transformation", "cloud strategy", "ai strategy", "technology modernization", "digital roadmap", "enterprise architecture", "innovation lab", "digital operating model"],
      "companySizeSweet": { "min": 1000, "max": 100000 },
      "weight": 0.9
    },
    "pe-portfolio-exec": {
      "label": "PE Portfolio Executive",
      "description": "Private equity operating partners and portfolio company executives needing consulting support",
      "rolePatterns": {
        "high": ["Operating Partner", "Managing Director", "Partner", "Venture Partner", "CEO", "President"],
        "medium": ["VP Operations", "Portfolio Manager", "Principal", "Director", "CFO"],
        "low": ["Associate", "Senior Associate", "Analyst"]
      },
      "industries": ["private equity", "venture capital", "investment", "growth equity", "buyout", "portfolio", "fund", "capital partners"],
      "signals": ["value creation", "portfolio company", "100-day plan", "operational improvement", "ebitda improvement", "margin expansion", "bolt-on acquisition", "platform investment", "carve-out", "exit strategy"],
      "companySizeSweet": { "min": 10, "max": 5000 },
      "weight": 0.85
    }
  },
  "niches": {
    "c-suite-enterprise": ["CEO", "COO", "Chief Strategy Officer", "President", "Managing Director"],
    "digital-leaders": ["CIO", "CDO", "Chief Digital Officer", "VP Digital", "Head of Innovation"],
    "private-equity": ["private equity", "operating partner", "portfolio company", "PE firm"],
    "strategy-ops": ["strategy", "operations", "transformation", "restructuring"]
  }
}
```

### Example User Prompts
- "Find C-suite executives at companies with 1000+ employees in financial services who mention transformation or restructuring"
- "Score my connections for digital strategy engagement potential"
- "Who in my network works at a private equity firm or is an operating partner at a portfolio company?"
- "Search for Chief Strategy Officers and COOs at large healthcare and energy companies"

---

## Vertical 4: Cybersecurity Sales / vCISO

### Persona Description
A cybersecurity vendor sales rep or a virtual CISO (vCISO) consultant who provides fractional security leadership, compliance advisory, or sells managed security services (MSSP), penetration testing, GRC platforms, or endpoint protection to mid-market companies that lack a full-time CISO.

### ICP Profiles

```json
{
  "profiles": {
    "security-budget-holder": {
      "label": "Security Budget Holder",
      "description": "Executives who authorize cybersecurity spending",
      "rolePatterns": {
        "high": ["CISO", "Chief Information Security", "CSO", "Chief Security", "CIO", "CTO", "VP Information Security", "VP Cybersecurity"],
        "medium": ["Director Information Security", "Director Cybersecurity", "Director IT Security", "Head of Security", "Head of Information Security", "IT Director"],
        "low": ["Security Manager", "IT Security Manager", "Information Security Manager", "Security Architect", "Security Engineer"]
      },
      "industries": ["financial services", "banking", "insurance", "healthcare", "government", "defense", "energy", "utilities", "manufacturing", "retail", "technology", "legal", "professional services", "education"],
      "signals": ["cybersecurity", "information security", "compliance", "soc 2", "iso 27001", "nist", "hipaa", "pci dss", "zero trust", "incident response", "threat detection", "vulnerability management", "penetration testing", "risk assessment", "security audit", "gdpr", "ccpa", "data privacy"],
      "companySizeSweet": { "min": 50, "max": 2000 },
      "weight": 1.0
    },
    "compliance-driven-buyer": {
      "label": "Compliance-Driven Buyer",
      "description": "Leaders facing regulatory mandates that require security investments",
      "rolePatterns": {
        "high": ["Chief Compliance", "General Counsel", "VP Compliance", "VP Risk", "Chief Risk Officer", "CRO"],
        "medium": ["Director Compliance", "Director Risk", "Head of Compliance", "Head of Risk", "Compliance Officer", "DPO", "Data Protection Officer"],
        "low": ["Compliance Manager", "Risk Manager", "Audit Manager", "Privacy Manager"]
      },
      "industries": ["financial services", "banking", "insurance", "healthcare", "pharmaceutical", "government", "energy", "critical infrastructure"],
      "signals": ["regulatory compliance", "audit findings", "regulatory exam", "remediation", "consent order", "regulatory risk", "compliance gap", "audit preparation", "sec regulation", "occ", "fdic", "state regulator"],
      "companySizeSweet": { "min": 100, "max": 5000 },
      "weight": 0.85
    },
    "no-ciso-company": {
      "label": "Company Without CISO (vCISO Target)",
      "description": "Growing companies that need security leadership but lack a dedicated CISO",
      "rolePatterns": {
        "high": ["CEO", "Founder", "CTO", "COO", "VP Engineering", "President"],
        "medium": ["IT Director", "Director Engineering", "Head of IT", "VP IT", "CFO"],
        "low": ["IT Manager", "Engineering Manager", "DevOps Manager", "Infrastructure Manager"]
      },
      "industries": ["saas", "software", "fintech", "healthtech", "startup", "technology", "digital", "platform", "marketplace", "ecommerce"],
      "signals": ["soc 2 readiness", "compliance requirements", "security program", "first ciso", "building security", "need security", "cyber insurance", "board reporting security", "investor due diligence", "series a", "series b", "series c"],
      "companySizeSweet": { "min": 20, "max": 500 },
      "weight": 0.9
    }
  },
  "niches": {
    "ciso-community": ["CISO", "Chief Information Security Officer", "VP Security", "security leader"],
    "compliance-leaders": ["compliance officer", "chief compliance", "risk officer", "audit director"],
    "startup-cto": ["CTO startup", "VP Engineering", "head of engineering", "technical co-founder"],
    "infosec": ["information security", "cybersecurity", "pentesting", "incident response"]
  }
}
```

### Example User Prompts
- "Find CTOs and CEOs at SaaS startups with 50-500 employees who mention SOC 2 or compliance readiness"
- "Score my connections for vCISO opportunity fit -- who needs security leadership?"
- "Search for compliance officers at financial services companies who mention regulatory exam or audit"
- "Who in my network is at a company without a CISO that recently raised Series A or B?"

---

## Vertical 5: Financial Advisor / Wealth Manager

### Persona Description
A financial advisor, wealth manager, or RIA (Registered Investment Advisor) who prospects for high-net-worth individuals (HNWIs), business owners approaching liquidity events, and professionals in transition. They also seek COIs (Centers of Influence) -- estate attorneys, CPAs, and business brokers who can refer wealthy clients.

### ICP Profiles

```json
{
  "profiles": {
    "hnw-prospect": {
      "label": "High-Net-Worth Prospect",
      "description": "Business owners, executives, and professionals with significant investable assets",
      "rolePatterns": {
        "high": ["CEO", "Founder", "Co-Founder", "Owner", "President", "Managing Partner", "Chairman"],
        "medium": ["Chief Financial Officer", "CFO", "SVP", "EVP", "Partner", "Managing Director", "Principal"],
        "low": ["VP", "Vice President", "Director", "Physician", "Surgeon", "Attorney"]
      },
      "industries": ["business owner", "entrepreneur", "real estate", "private practice", "medical", "legal", "dental", "technology", "construction", "manufacturing", "franchise", "investment", "family office"],
      "signals": ["exited", "acquired", "sold my company", "liquidity event", "retired", "semi-retired", "serial entrepreneur", "angel investor", "board member", "philanthropist", "family office", "estate planning", "succession planning", "exit planning"],
      "companySizeSweet": { "min": 1, "max": 500 },
      "weight": 1.0
    },
    "center-of-influence": {
      "label": "Center of Influence (COI)",
      "description": "Professionals who serve HNWIs and can refer wealth management clients",
      "rolePatterns": {
        "high": ["Estate Attorney", "Estate Planning", "Tax Attorney", "CPA", "Tax Partner", "Business Broker", "M&A Advisor", "Investment Banker"],
        "medium": ["Partner", "Managing Partner", "Senior Partner", "Of Counsel", "Principal", "Insurance Broker"],
        "low": ["Associate", "Attorney", "Accountant", "Financial Planner", "Insurance Agent"]
      },
      "industries": ["law firm", "legal", "accounting", "cpa firm", "business brokerage", "m&a advisory", "investment banking", "insurance", "estate planning", "trust", "tax advisory"],
      "signals": ["estate planning", "trust administration", "business succession", "tax planning", "mergers and acquisitions", "business valuation", "buy-sell agreement", "key man insurance", "charitable giving", "family wealth", "generational wealth transfer"],
      "companySizeSweet": { "min": 1, "max": 200 },
      "weight": 0.85
    },
    "pre-liquidity-owner": {
      "label": "Pre-Liquidity Business Owner",
      "description": "Business owners approaching a sale, merger, or retirement event",
      "rolePatterns": {
        "high": ["Owner", "Founder", "CEO", "President", "Managing Member"],
        "medium": ["Partner", "Co-Owner", "Chairman", "Principal"],
        "low": ["General Manager", "Chief Operating Officer"]
      },
      "industries": ["manufacturing", "construction", "distribution", "wholesale", "professional services", "medical practice", "dental practice", "franchise", "restaurant group", "real estate development"],
      "signals": ["exit strategy", "succession", "retirement", "selling my business", "looking for buyers", "transition plan", "legacy", "next chapter", "winding down", "30+ years in business", "built over"],
      "companySizeSweet": { "min": 5, "max": 250 },
      "weight": 0.9
    }
  },
  "niches": {
    "business-owners": ["business owner", "founder", "CEO", "entrepreneur", "serial entrepreneur"],
    "medical-professionals": ["physician", "surgeon", "dentist", "medical practice", "healthcare executive"],
    "estate-attorneys": ["estate planning attorney", "estate lawyer", "trust attorney", "probate"],
    "cpa-tax": ["CPA", "certified public accountant", "tax partner", "tax advisor"],
    "pre-exit": ["exit planning", "business succession", "retirement", "selling business"]
  }
}
```

### Example User Prompts
- "Find business owners in manufacturing or construction who mention succession planning or retirement"
- "Score my connections as Centers of Influence -- who are the estate attorneys and CPAs?"
- "Search for founders who recently exited or mention liquidity events"
- "Who in my network is a medical professional with a private practice?"

---

## Vertical 6: Commercial Real Estate Broker

### Persona Description
A commercial real estate (CRE) broker or agent who prospects for property owners looking to sell, tenants seeking office/industrial/retail space, and investors looking for acquisition opportunities. They specialize in a property type (office, industrial, multifamily, retail) within a geographic market.

### ICP Profiles

```json
{
  "profiles": {
    "property-owner-seller": {
      "label": "Property Owner / Seller",
      "description": "CRE property owners who may be considering disposition or repositioning",
      "rolePatterns": {
        "high": ["Owner", "Principal", "Managing Partner", "President", "CEO", "Founder"],
        "medium": ["VP Asset Management", "Director Asset Management", "Head of Real Estate", "Portfolio Manager", "VP Real Estate"],
        "low": ["Asset Manager", "Property Manager", "Director Operations", "Acquisitions Associate"]
      },
      "industries": ["real estate", "commercial real estate", "property management", "real estate development", "real estate investment", "reit", "real estate fund", "family office", "private equity real estate"],
      "signals": ["disposition", "portfolio optimization", "asset repositioning", "capital recycling", "refinancing", "vacancy", "lease expiration", "renovation", "redevelopment", "1031 exchange", "tax deferred", "cap rate compression", "hold period", "value-add"],
      "companySizeSweet": { "min": 1, "max": 500 },
      "weight": 1.0
    },
    "tenant-occupier": {
      "label": "Tenant / Corporate Occupier",
      "description": "Companies looking for commercial space (office, industrial, warehouse, retail)",
      "rolePatterns": {
        "high": ["VP Real Estate", "Head of Real Estate", "Director Facilities", "VP Operations", "CFO", "COO"],
        "medium": ["Facilities Manager", "Director Operations", "Head of Workplace", "VP Supply Chain", "Director Supply Chain"],
        "low": ["Operations Manager", "Office Manager", "Facilities Coordinator", "Workplace Manager"]
      },
      "industries": ["technology", "financial services", "healthcare", "logistics", "manufacturing", "retail", "professional services", "law firm", "consulting", "startup", "life sciences"],
      "signals": ["office relocation", "expansion", "new location", "warehouse space", "industrial space", "lease renewal", "downsizing", "hybrid workplace", "consolidating offices", "new market", "opening office", "sublease", "coworking"],
      "companySizeSweet": { "min": 20, "max": 5000 },
      "weight": 0.9
    },
    "cre-investor": {
      "label": "CRE Investor",
      "description": "Institutional and private investors seeking acquisition opportunities",
      "rolePatterns": {
        "high": ["Managing Director", "Partner", "Principal", "Head of Acquisitions", "CIO", "Chief Investment Officer"],
        "medium": ["VP Acquisitions", "Director Acquisitions", "Director Investments", "Portfolio Manager", "Acquisitions Director"],
        "low": ["Acquisitions Associate", "Analyst", "Associate", "Investment Analyst"]
      },
      "industries": ["private equity", "real estate private equity", "investment management", "reit", "family office", "institutional investor", "pension fund", "insurance company", "endowment", "sovereign wealth"],
      "signals": ["acquiring", "investment thesis", "acquisition criteria", "deal flow", "dry powder", "deploying capital", "core plus", "value add", "opportunistic", "debt fund", "bridge lending", "construction lending", "joint venture"],
      "companySizeSweet": { "min": 5, "max": 1000 },
      "weight": 0.85
    }
  },
  "niches": {
    "cre-owners": ["commercial real estate owner", "property owner", "real estate investor", "REIT"],
    "corporate-real-estate": ["VP real estate", "facilities director", "workplace", "corporate real estate"],
    "industrial-logistics": ["warehouse", "industrial", "logistics", "distribution center", "supply chain"],
    "office-market": ["office space", "coworking", "office relocation", "workplace strategy"],
    "cre-investors": ["real estate acquisitions", "real estate PE", "real estate fund", "real estate investment"]
  }
}
```

### Example User Prompts
- "Find VP of Real Estate or Facilities Directors at tech companies with 200+ employees who mention office relocation or expansion"
- "Score my connections for CRE investor potential -- who manages real estate funds or PE capital?"
- "Search for property owners and asset managers in commercial real estate"
- "Who in my network works in industrial/logistics real estate or mentions warehouse space needs?"

---

## Vertical 7: Healthcare IT Consultant

### Persona Description
A healthcare IT consultant or health tech vendor who sells EHR implementation, interoperability solutions, clinical informatics, telehealth platforms, revenue cycle management, or HIPAA compliance services to hospitals, health systems, physician groups, and payers.

### ICP Profiles

```json
{
  "profiles": {
    "health-system-cio": {
      "label": "Health System CIO/CMIO",
      "description": "Technology and clinical informatics leaders at health systems and hospitals",
      "rolePatterns": {
        "high": ["CIO", "CMIO", "Chief Medical Information", "Chief Information", "Chief Digital", "Chief Technology", "VP Information Technology", "VP Clinical Informatics"],
        "medium": ["Director IT", "Director Clinical Informatics", "Director Health Information", "Head of IT", "VP Digital Health", "Director Applications", "CISO"],
        "low": ["IT Manager", "Clinical Informatics Manager", "Systems Analyst", "EHR Analyst", "Application Manager"]
      },
      "industries": ["hospital", "health system", "healthcare", "academic medical center", "community health", "integrated delivery network", "physician group", "ambulatory care", "behavioral health", "long-term care", "senior living"],
      "signals": ["ehr implementation", "epic", "cerner", "oracle health", "meditech", "interoperability", "hl7 fhir", "telehealth", "clinical workflow", "patient portal", "population health", "clinical decision support", "value-based care", "emr optimization"],
      "companySizeSweet": { "min": 100, "max": 20000 },
      "weight": 1.0
    },
    "revenue-cycle-buyer": {
      "label": "Revenue Cycle Buyer",
      "description": "Leaders responsible for billing, coding, and revenue cycle operations",
      "rolePatterns": {
        "high": ["CFO", "VP Revenue Cycle", "VP Finance", "Chief Revenue Officer", "Chief Financial Officer"],
        "medium": ["Director Revenue Cycle", "Director Billing", "Director Finance", "Head of Revenue Cycle", "Revenue Cycle Director"],
        "low": ["Revenue Cycle Manager", "Billing Manager", "Coding Manager", "HIM Director"]
      },
      "industries": ["hospital", "health system", "physician group", "ambulatory surgery center", "revenue cycle management", "medical billing", "healthcare finance"],
      "signals": ["revenue cycle", "denial management", "claims processing", "coding accuracy", "charge capture", "patient financial experience", "bad debt reduction", "prior authorization", "revenue integrity", "payer contract", "reimbursement"],
      "companySizeSweet": { "min": 50, "max": 10000 },
      "weight": 0.9
    },
    "compliance-security-health": {
      "label": "Healthcare Compliance & Security",
      "description": "Leaders managing HIPAA, regulatory compliance, and data security in healthcare",
      "rolePatterns": {
        "high": ["Chief Compliance Officer", "Chief Privacy Officer", "CISO", "VP Compliance", "Chief Information Security"],
        "medium": ["Director Compliance", "Director Privacy", "Director Information Security", "HIPAA Officer", "Privacy Officer"],
        "low": ["Compliance Manager", "Security Manager", "Privacy Manager", "Risk Manager"]
      },
      "industries": ["hospital", "health system", "health plan", "payer", "pharmacy benefit", "healthcare clearinghouse", "digital health", "healthtech"],
      "signals": ["hipaa compliance", "hipaa audit", "ocr investigation", "breach notification", "phi protection", "cybersecurity in healthcare", "hitech act", "meaningful use", "cms requirements", "joint commission", "patient data security"],
      "companySizeSweet": { "min": 100, "max": 15000 },
      "weight": 0.8
    }
  },
  "niches": {
    "health-it-leaders": ["CIO hospital", "CMIO", "VP information technology healthcare", "health system CIO"],
    "ehr-implementation": ["epic", "cerner", "oracle health", "meditech", "ehr implementation", "emr"],
    "revenue-cycle": ["revenue cycle", "medical billing", "coding", "claims processing", "denial management"],
    "digital-health": ["telehealth", "digital health", "remote patient monitoring", "patient engagement"],
    "health-compliance": ["hipaa compliance", "healthcare security", "patient privacy", "phi protection"]
  }
}
```

### Example User Prompts
- "Find CIOs and CMIOs at health systems with 500+ employees who mention Epic or interoperability"
- "Score my connections for healthcare revenue cycle opportunity fit"
- "Search for HIPAA compliance officers at hospitals and health plans"
- "Who in my network leads clinical informatics or digital health at an academic medical center?"

---

## Vertical 8: Marketing Agency Owner (Mid-Market)

### Persona Description
The owner or managing director of a marketing, branding, or digital agency (50-200 employees) who sells retainer-based services (brand strategy, creative, performance marketing, web development, social media, content) to mid-market brands with $10M-$500M revenue. They target CMOs and VP Marketing at B2C and B2B companies.

### ICP Profiles

```json
{
  "profiles": {
    "cmo-vp-marketing": {
      "label": "CMO / VP Marketing",
      "description": "Senior marketing leaders with agency-hiring authority",
      "rolePatterns": {
        "high": ["CMO", "Chief Marketing", "VP Marketing", "VP Brand", "VP Digital Marketing", "SVP Marketing", "Head of Marketing"],
        "medium": ["Director Marketing", "Director Brand", "Director Digital Marketing", "Director Growth", "Head of Growth", "Head of Brand", "Head of Digital"],
        "low": ["Marketing Manager", "Brand Manager", "Senior Marketing Manager", "Growth Manager", "Digital Marketing Manager"]
      },
      "industries": ["consumer goods", "cpg", "consumer packaged goods", "food and beverage", "beauty", "wellness", "fashion", "apparel", "home goods", "pet", "outdoor", "fitness", "hospitality", "travel", "restaurant", "franchise", "b2b saas", "fintech"],
      "signals": ["agency search", "agency review", "rfp", "rebranding", "brand refresh", "new product launch", "brand awareness", "market expansion", "customer acquisition", "performance marketing", "creative partner", "agency of record", "scaling marketing", "marketing transformation"],
      "companySizeSweet": { "min": 50, "max": 2000 },
      "weight": 1.0
    },
    "ecommerce-marketing-leader": {
      "label": "Ecommerce Marketing Leader",
      "description": "DTC and ecommerce brands needing agency support for growth",
      "rolePatterns": {
        "high": ["CEO", "Founder", "CMO", "VP Marketing", "VP Ecommerce", "Head of Ecommerce"],
        "medium": ["Director Ecommerce", "Director Marketing", "Director Growth", "Head of Growth", "Head of Digital"],
        "low": ["Ecommerce Manager", "Marketing Manager", "Growth Manager", "Retention Manager"]
      },
      "industries": ["dtc", "direct to consumer", "d2c", "ecommerce", "e-commerce", "shopify", "amazon", "retail", "online retail", "subscription", "cpg"],
      "signals": ["scaling dtc", "customer acquisition cost", "cac", "roas", "return on ad spend", "paid social", "meta ads", "google ads", "tiktok shop", "influencer marketing", "email marketing", "retention", "lifecycle marketing", "conversion rate optimization"],
      "companySizeSweet": { "min": 10, "max": 500 },
      "weight": 0.9
    },
    "b2b-marketing-leader": {
      "label": "B2B Marketing Leader",
      "description": "B2B companies needing agency support for demand gen, content, ABM",
      "rolePatterns": {
        "high": ["CMO", "VP Marketing", "VP Demand Generation", "VP Growth", "Head of Marketing"],
        "medium": ["Director Marketing", "Director Demand Generation", "Director Content", "Head of Demand Gen", "Head of Content"],
        "low": ["Marketing Manager", "Demand Gen Manager", "Content Manager", "ABM Manager"]
      },
      "industries": ["saas", "software", "technology", "fintech", "cybersecurity", "devtools", "martech", "hrtech", "legaltech", "healthtech", "b2b"],
      "signals": ["demand generation", "account based marketing", "abm", "content marketing", "thought leadership", "lead generation", "pipeline", "marketing qualified leads", "mql", "sales enablement", "webinar", "conference marketing"],
      "companySizeSweet": { "min": 50, "max": 1000 },
      "weight": 0.85
    }
  },
  "niches": {
    "cmo-brand": ["CMO", "Chief Marketing Officer", "VP Marketing", "VP Brand", "Head of Marketing"],
    "dtc-ecommerce": ["DTC brand", "direct to consumer", "ecommerce", "Shopify brand", "online retail"],
    "b2b-marketing": ["demand generation", "B2B marketing", "ABM", "content marketing", "lead generation"],
    "cpg-brand": ["CPG", "consumer packaged goods", "food and beverage", "beauty brand", "wellness brand"],
    "growth-leaders": ["Head of Growth", "VP Growth", "Director Growth", "growth marketing"]
  }
}
```

### Example User Prompts
- "Find CMOs and VP Marketing at consumer brands with 100-1000 employees who mention rebranding or agency search"
- "Score my connections for DTC/ecommerce agency opportunity fit"
- "Search for B2B marketing leaders at SaaS companies who mention demand generation or ABM"
- "Who in my network is a VP Marketing at a CPG or food and beverage brand?"

---

## Vertical 9: Manufacturing / Supply Chain Consultant

### Persona Description
An operations or supply chain consultant who advises manufacturing companies on lean operations, Industry 4.0 transformation, supply chain optimization, procurement strategy, ERP implementation, or factory automation. Targets VP Operations, plant managers, and supply chain executives at mid-to-large manufacturers.

### ICP Profiles

```json
{
  "profiles": {
    "operations-executive": {
      "label": "Operations Executive",
      "description": "Senior operations leaders at manufacturing companies driving efficiency initiatives",
      "rolePatterns": {
        "high": ["COO", "Chief Operating", "VP Operations", "VP Manufacturing", "SVP Operations", "VP Supply Chain", "Chief Supply Chain"],
        "medium": ["Director Operations", "Director Manufacturing", "Director Supply Chain", "Director Procurement", "Plant Manager", "Head of Operations", "Head of Supply Chain"],
        "low": ["Operations Manager", "Production Manager", "Manufacturing Manager", "Supply Chain Manager", "Procurement Manager", "Materials Manager"]
      },
      "industries": ["manufacturing", "industrial", "automotive", "aerospace", "defense", "chemicals", "plastics", "metals", "food manufacturing", "beverage manufacturing", "pharmaceutical manufacturing", "medical device", "electronics", "semiconductor", "consumer goods manufacturing"],
      "signals": ["lean manufacturing", "six sigma", "continuous improvement", "operational excellence", "industry 4.0", "smart factory", "digital twin", "iot", "predictive maintenance", "supply chain optimization", "inventory optimization", "cost reduction", "throughput improvement", "oee", "overall equipment effectiveness"],
      "companySizeSweet": { "min": 100, "max": 10000 },
      "weight": 1.0
    },
    "supply-chain-transformation": {
      "label": "Supply Chain Transformation",
      "description": "Leaders modernizing supply chain planning, visibility, and resilience",
      "rolePatterns": {
        "high": ["VP Supply Chain", "Chief Supply Chain", "VP Logistics", "VP Procurement", "SVP Supply Chain"],
        "medium": ["Director Supply Chain", "Director Logistics", "Director Procurement", "Head of Supply Chain Planning", "Director S&OP"],
        "low": ["Supply Chain Manager", "Logistics Manager", "Procurement Manager", "Planning Manager", "S&OP Manager"]
      },
      "industries": ["manufacturing", "logistics", "distribution", "wholesale", "retail", "consumer goods", "food and beverage", "pharmaceutical", "automotive", "chemical"],
      "signals": ["supply chain disruption", "supply chain resilience", "nearshoring", "reshoring", "supplier diversification", "demand planning", "s&op", "control tower", "supply chain visibility", "last mile", "warehouse automation", "transportation management"],
      "companySizeSweet": { "min": 200, "max": 20000 },
      "weight": 0.9
    },
    "erp-modernization": {
      "label": "ERP Modernization",
      "description": "Manufacturers looking to implement or upgrade ERP systems",
      "rolePatterns": {
        "high": ["CIO", "CTO", "VP IT", "VP Information Technology", "CFO"],
        "medium": ["Director IT", "Director Applications", "Head of IT", "Director Business Systems", "ERP Program Director"],
        "low": ["IT Manager", "ERP Manager", "Business Systems Manager", "Applications Manager"]
      },
      "industries": ["manufacturing", "discrete manufacturing", "process manufacturing", "industrial", "aerospace", "automotive"],
      "signals": ["erp implementation", "sap", "oracle", "microsoft dynamics", "epicor", "infor", "erp migration", "erp upgrade", "legacy system", "system modernization", "mes", "manufacturing execution system", "mrp", "aps"],
      "companySizeSweet": { "min": 100, "max": 5000 },
      "weight": 0.85
    }
  },
  "niches": {
    "manufacturing-ops": ["VP Operations manufacturing", "plant manager", "operations director", "lean manufacturing"],
    "supply-chain": ["supply chain director", "VP supply chain", "logistics", "procurement director"],
    "industry-4": ["industry 4.0", "smart factory", "digital twin", "manufacturing IoT", "predictive maintenance"],
    "erp-manufacturing": ["ERP implementation", "SAP manufacturing", "Oracle EBS", "Epicor", "Infor CloudSuite"]
  }
}
```

### Example User Prompts
- "Find VP Operations and Plant Managers at manufacturers with 200+ employees who mention lean or continuous improvement"
- "Score my connections for supply chain consulting opportunity fit"
- "Search for CIOs at manufacturing companies who mention ERP migration or SAP implementation"
- "Who in my network leads supply chain at a food, beverage, or pharmaceutical manufacturer?"

---

## Vertical 10: Senior Java Developer (Contract/Consulting)

### Persona Description
A senior or staff-level Java developer seeking contract, freelance, or consulting engagements. They need to find engineering leaders and hiring managers at companies using Java/JVM technologies. Their buyers are VP Engineering, CTOs, and engineering directors who need to augment their teams or fill specialized roles.

### ICP Profiles

```json
{
  "profiles": {
    "engineering-hiring-manager": {
      "label": "Engineering Hiring Manager",
      "description": "Engineering leaders who hire contractors and consultants",
      "rolePatterns": {
        "high": ["VP Engineering", "CTO", "Director Engineering", "Head of Engineering", "SVP Engineering"],
        "medium": ["Engineering Manager", "Senior Engineering Manager", "Principal Engineer", "Staff Engineer", "Technical Director"],
        "low": ["Team Lead", "Tech Lead", "Lead Engineer", "Senior Developer", "Architect"]
      },
      "industries": ["technology", "software", "saas", "fintech", "banking", "insurance", "healthcare", "e-commerce", "ecommerce", "telecommunications", "media", "automotive", "government", "defense"],
      "signals": ["hiring java", "java developer", "jvm", "spring boot", "microservices", "kubernetes", "cloud native", "aws", "azure", "gcp", "backend engineer", "scaling engineering team", "we are hiring", "contractor", "augmentation", "short-term engagement"],
      "companySizeSweet": { "min": 20, "max": 5000 },
      "weight": 1.0
    },
    "java-modernization-project": {
      "label": "Java Modernization Project",
      "description": "Companies modernizing legacy Java applications",
      "rolePatterns": {
        "high": ["CTO", "VP Engineering", "Chief Architect", "VP Technology"],
        "medium": ["Director Engineering", "Director Architecture", "Head of Platform", "Head of Architecture", "Enterprise Architect"],
        "low": ["Software Architect", "Principal Engineer", "Staff Engineer", "Technical Lead"]
      },
      "industries": ["financial services", "banking", "insurance", "government", "telecommunications", "healthcare", "enterprise software", "logistics"],
      "signals": ["legacy modernization", "java migration", "monolith to microservices", "spring framework", "jakarta ee", "java 17", "java 21", "cloud migration", "containerization", "api gateway", "event driven", "kafka", "technical debt", "replatform"],
      "companySizeSweet": { "min": 100, "max": 10000 },
      "weight": 0.9
    },
    "staffing-procurement": {
      "label": "Staffing/Procurement Decision Maker",
      "description": "People who manage vendor/contractor relationships for engineering",
      "rolePatterns": {
        "high": ["VP IT Procurement", "Director Procurement", "Head of IT Vendor Management", "VP Workforce Solutions"],
        "medium": ["Procurement Manager", "Vendor Manager", "IT Sourcing Manager", "Supplier Relationship Manager"],
        "low": ["Recruiter", "Technical Recruiter", "Talent Acquisition", "Sourcing Specialist"]
      },
      "industries": ["technology", "financial services", "consulting", "government", "healthcare", "staffing", "systems integrator"],
      "signals": ["contractor management", "staff augmentation", "outsourcing", "nearshoring", "vendor onboarding", "msp", "managed service provider", "rate card", "sow", "statement of work", "time and materials"],
      "companySizeSweet": { "min": 200, "max": 20000 },
      "weight": 0.7
    }
  },
  "niches": {
    "java-engineering": ["Java developer", "Spring Boot", "JVM", "microservices", "backend engineer"],
    "engineering-leaders": ["VP Engineering", "CTO", "Director Engineering", "Head of Engineering"],
    "fintech-engineering": ["fintech engineer", "banking technology", "financial services engineering"],
    "cloud-native": ["Kubernetes", "Docker", "cloud native", "AWS", "microservices architecture"],
    "technical-recruiters": ["technical recruiter", "engineering recruiter", "IT staffing", "developer hiring"]
  }
}
```

### Example User Prompts
- "Find VP Engineering and CTOs at fintech companies who mention Java, Spring Boot, or microservices"
- "Score my connections for Java consulting opportunity fit -- who is hiring or modernizing legacy systems?"
- "Search for engineering leaders at companies with 100-5000 employees in financial services"
- "Who in my network manages IT procurement or vendor relationships for engineering contractors?"

---

## Vertical 11: EdTech Sales / University Partnerships

### Persona Description
A sales rep or partnership manager at an EdTech company selling LMS platforms, online learning tools, credential verification, student engagement software, or corporate learning solutions. They target both higher education institutions (provosts, deans, CIOs) and corporate L&D (VP Learning, CLO) depending on the product.

### ICP Profiles

```json
{
  "profiles": {
    "higher-ed-decision-maker": {
      "label": "Higher Ed Decision Maker",
      "description": "University administrators who buy educational technology and platforms",
      "rolePatterns": {
        "high": ["Provost", "Vice Provost", "President", "Chancellor", "CIO", "Chief Information", "Vice President Academic Affairs", "VP Academic Affairs"],
        "medium": ["Dean", "Associate Dean", "Director IT", "Director Instructional Technology", "Director Online Learning", "Head of Digital Learning", "VP Student Affairs", "CTO"],
        "low": ["Instructional Designer", "LMS Administrator", "IT Director", "Faculty Technology Coordinator", "Registrar"]
      },
      "industries": ["higher education", "university", "college", "community college", "research university", "liberal arts", "state university", "private university", "academic", "education"],
      "signals": ["online learning", "distance education", "lms", "learning management system", "canvas", "blackboard", "d2l", "moodle", "digital learning", "student success", "retention", "enrollment", "credentialing", "microcredential", "competency-based education", "opm", "online program management"],
      "companySizeSweet": { "min": 200, "max": 50000 },
      "weight": 1.0
    },
    "corporate-learning-buyer": {
      "label": "Corporate Learning Buyer",
      "description": "L&D leaders at large companies buying learning platforms and content",
      "rolePatterns": {
        "high": ["CLO", "Chief Learning", "VP Learning", "VP Talent Development", "VP Training", "Head of Learning", "Head of L&D"],
        "medium": ["Director Learning", "Director Training", "Director L&D", "Director Talent Development", "Head of Training", "Director Organizational Development"],
        "low": ["Learning Manager", "Training Manager", "L&D Manager", "Instructional Designer", "LMS Administrator"]
      },
      "industries": ["financial services", "healthcare", "technology", "manufacturing", "retail", "professional services", "consulting", "pharmaceutical", "energy", "government"],
      "signals": ["upskilling", "reskilling", "learning platform", "learning experience", "lxp", "skills gap", "competency framework", "mandatory training", "compliance training", "onboarding", "leadership development", "succession planning", "talent management"],
      "companySizeSweet": { "min": 500, "max": 50000 },
      "weight": 0.9
    },
    "k12-district-buyer": {
      "label": "K-12 District Buyer",
      "description": "School district administrators who purchase educational technology",
      "rolePatterns": {
        "high": ["Superintendent", "Assistant Superintendent", "Chief Technology Officer", "CTO", "Chief Academic Officer"],
        "medium": ["Director Technology", "Director Curriculum", "Director Instruction", "IT Director", "Director Assessment"],
        "low": ["Technology Coordinator", "Curriculum Coordinator", "Instructional Coach", "Library Media Specialist"]
      },
      "industries": ["k-12", "school district", "public school", "charter school", "private school", "independent school", "education"],
      "signals": ["edtech", "1-to-1", "chromebook", "ipad", "google classroom", "clever", "student information system", "assessment", "adaptive learning", "personalized learning", "stem", "digital citizenship", "esser funds", "title i"],
      "companySizeSweet": { "min": 50, "max": 10000 },
      "weight": 0.8
    }
  },
  "niches": {
    "higher-ed-leaders": ["provost", "university CIO", "VP academic affairs", "dean", "higher education"],
    "corporate-learning": ["CLO", "VP learning", "head of L&D", "director training", "talent development"],
    "k12-technology": ["superintendent", "CTO school district", "director technology education", "edtech"],
    "online-learning": ["online learning", "distance education", "LMS", "Canvas", "Blackboard", "instructional design"],
    "learning-platform": ["learning experience platform", "LXP", "upskilling", "reskilling", "corporate learning"]
  }
}
```

### Example User Prompts
- "Find university provosts and CIOs who mention LMS implementation or online learning expansion"
- "Score my connections for corporate L&D platform sales fit"
- "Search for VP Learning and Chief Learning Officers at companies with 1000+ employees"
- "Who in my network works as a school district superintendent or technology director?"

---

## Vertical 12: Legal Tech / Law Firm Business Development

### Persona Description
A legal tech vendor selling practice management, document automation, e-discovery, contract lifecycle management (CLM), or billing/timekeeping software to law firms. Alternatively, a law firm BD professional looking to develop client relationships with General Counsels and in-house legal teams at corporations.

### ICP Profiles

```json
{
  "profiles": {
    "law-firm-managing-partner": {
      "label": "Law Firm Managing Partner",
      "description": "Law firm leaders who approve technology and operations investments",
      "rolePatterns": {
        "high": ["Managing Partner", "Chairman", "Chief Executive Partner", "Executive Partner", "COO", "Chief Operating Officer"],
        "medium": ["CIO", "Chief Information Officer", "Director IT", "Director Innovation", "Director Legal Operations", "Director Practice Management", "Chief Knowledge Officer"],
        "low": ["IT Director", "Knowledge Manager", "Practice Manager", "Office Administrator"]
      },
      "industries": ["law firm", "legal", "am law 100", "am law 200", "big law", "mid-size law firm", "boutique law firm", "litigation", "corporate law", "ip law", "patent"],
      "signals": ["legal tech", "practice management", "document automation", "matter management", "billing software", "legal analytics", "ai in legal", "knowledge management", "precedent search", "contract management", "legal workflow", "legal operations", "innovation"],
      "companySizeSweet": { "min": 20, "max": 5000 },
      "weight": 1.0
    },
    "general-counsel-in-house": {
      "label": "General Counsel / In-House Legal",
      "description": "Corporate legal leaders who buy legal tech and retain outside counsel",
      "rolePatterns": {
        "high": ["General Counsel", "GC", "Chief Legal Officer", "CLO", "VP Legal", "SVP Legal", "Head of Legal"],
        "medium": ["Deputy General Counsel", "Associate General Counsel", "Director Legal", "Director Compliance", "Corporate Secretary"],
        "low": ["Senior Counsel", "Staff Attorney", "Legal Operations Manager", "Paralegal Manager", "Legal Analyst"]
      },
      "industries": ["technology", "financial services", "healthcare", "pharmaceutical", "energy", "manufacturing", "consumer goods", "retail", "media", "real estate"],
      "signals": ["legal operations", "legal spend management", "outside counsel management", "contract lifecycle", "clm", "e-discovery", "ediscovery", "legal hold", "compliance management", "regulatory affairs", "legal budget", "matter management", "alternative fee arrangement"],
      "companySizeSweet": { "min": 200, "max": 20000 },
      "weight": 0.9
    },
    "legal-ops-leader": {
      "label": "Legal Operations Leader",
      "description": "Legal ops professionals who evaluate and implement legal technology",
      "rolePatterns": {
        "high": ["Director Legal Operations", "Head of Legal Operations", "VP Legal Operations", "Chief of Staff Legal"],
        "medium": ["Legal Operations Manager", "Legal Project Manager", "Legal Technology Manager", "Director Legal Technology"],
        "low": ["Legal Operations Analyst", "Legal Technology Specialist", "Legal Process Improvement", "Paralegal"]
      },
      "industries": ["technology", "financial services", "healthcare", "pharmaceutical", "legal", "professional services", "energy", "insurance"],
      "signals": ["legal ops", "legal operations", "legal technology", "legal tech stack", "legal process improvement", "legal analytics", "spend analytics", "matter budgeting", "vendor management", "legal ai", "contract analytics", "clause library"],
      "companySizeSweet": { "min": 500, "max": 50000 },
      "weight": 0.85
    }
  },
  "niches": {
    "law-firm-leaders": ["managing partner", "law firm COO", "law firm CIO", "legal innovation"],
    "general-counsel": ["general counsel", "chief legal officer", "VP legal", "head of legal", "in-house counsel"],
    "legal-ops": ["legal operations", "legal technology", "legal ops director", "legal process"],
    "clm-contract": ["contract management", "CLM", "contract lifecycle", "contract automation", "clause library"],
    "ediscovery": ["e-discovery", "litigation support", "legal hold", "document review", "forensics"]
  }
}
```

### Example User Prompts
- "Find managing partners at Am Law 200 firms who mention legal tech or innovation"
- "Score my connections for CLM (contract lifecycle management) sales opportunity"
- "Search for General Counsels at technology and healthcare companies with 500+ employees"
- "Who in my network leads legal operations and could evaluate our e-discovery platform?"

---

## Vertical 13: Startup Founder (Investor Prospecting)

### Persona Description
A startup founder (Seed to Series B stage) looking to identify and connect with venture capital investors, angel investors, and strategic investors. They need to find the right partners at the right funds who invest in their sector, stage, and geography.

### ICP Profiles

```json
{
  "profiles": {
    "vc-partner": {
      "label": "VC Partner / GP",
      "description": "Venture capital partners and principals who make investment decisions",
      "rolePatterns": {
        "high": ["General Partner", "Managing Partner", "Partner", "Managing Director", "GP", "Founding Partner"],
        "medium": ["Principal", "Vice President", "Director", "Venture Partner", "Investment Director"],
        "low": ["Senior Associate", "Associate", "Analyst", "Scout", "EIR", "Entrepreneur in Residence"]
      },
      "industries": ["venture capital", "vc", "early stage", "seed fund", "growth equity", "investment", "fund", "capital", "ventures"],
      "signals": ["investing in", "looking for", "thesis", "portfolio", "deal flow", "due diligence", "series a", "series b", "seed round", "pre-seed", "term sheet", "board member", "lead investor", "co-invest"],
      "companySizeSweet": { "min": 1, "max": 100 },
      "weight": 1.0
    },
    "angel-investor": {
      "label": "Angel Investor / Operator-Investor",
      "description": "Individual angels and operator-investors who write checks and provide mentorship",
      "rolePatterns": {
        "high": ["Angel Investor", "Angel", "Investor", "Founding Partner"],
        "medium": ["CEO", "Founder", "Advisor", "Board Member", "Operating Partner"],
        "low": ["VP", "Director", "Entrepreneur", "Mentor"]
      },
      "industries": ["angel investing", "angel group", "angel syndicate", "startup", "technology", "venture"],
      "signals": ["angel investor", "angel investing", "check writer", "pre-seed", "friends and family", "syndicate", "portfolio company", "advisor to startups", "startup mentor", "accelerator", "incubator", "techstars", "y combinator", "500 startups"],
      "companySizeSweet": { "min": 1, "max": 50 },
      "weight": 0.85
    },
    "strategic-corporate-investor": {
      "label": "Strategic / Corporate Investor",
      "description": "Corporate venture arms and strategic investors who invest for strategic alignment",
      "rolePatterns": {
        "high": ["Head of Corporate Development", "VP Corporate Development", "VP Strategy", "Managing Director", "Head of Ventures"],
        "medium": ["Director Corporate Development", "Director Strategy", "Director Ventures", "Investment Director", "Principal"],
        "low": ["Manager Corporate Development", "Strategy Manager", "Associate", "Analyst"]
      },
      "industries": ["corporate venture", "cvc", "corporate development", "m&a", "strategic investments", "corporate ventures"],
      "signals": ["strategic investment", "corporate venture", "cvc", "partnership", "acquisition target", "strategic fit", "ecosystem play", "innovation investment", "build buy partner", "inorganic growth"],
      "companySizeSweet": { "min": 500, "max": 100000 },
      "weight": 0.8
    }
  },
  "niches": {
    "vc-partners": ["venture capital partner", "GP", "general partner", "managing partner VC", "seed investor"],
    "angels": ["angel investor", "angel group", "startup investor", "pre-seed investor"],
    "corporate-vc": ["corporate venture capital", "CVC", "corporate development", "strategic investor"],
    "sector-fintech": ["fintech investor", "fintech VC", "financial services venture"],
    "sector-healthtech": ["healthtech investor", "digital health VC", "health venture"],
    "accelerators": ["accelerator", "incubator", "Y Combinator", "Techstars", "startup program"]
  }
}
```

### Example User Prompts
- "Find VC partners who invest in fintech at the Series A stage"
- "Score my connections for investor fit -- who are the active angel investors and VCs?"
- "Search for corporate venture capital and strategic investors in healthcare technology"
- "Who in my network is a GP or Managing Partner at a venture fund that invests in B2B SaaS?"

---

## Vertical 14: Recruiting / HR Manager (Talent Sourcing)

### Persona Description
An in-house recruiter, recruiting manager, or HR business partner who uses LinkedIn to source passive candidates, particularly for hard-to-fill technical, sales, and executive roles. Their "ICP" is the ideal candidate rather than a customer, but the scoring model works the same way.

### ICP Profiles

```json
{
  "profiles": {
    "senior-engineer-candidate": {
      "label": "Senior Engineering Candidate",
      "description": "Experienced engineers who are passive candidates for senior/staff roles",
      "rolePatterns": {
        "high": ["Staff Engineer", "Principal Engineer", "Distinguished Engineer", "Fellow", "Chief Architect"],
        "medium": ["Senior Software Engineer", "Senior Engineer", "Senior Developer", "Tech Lead", "Lead Engineer", "Software Architect"],
        "low": ["Software Engineer", "Developer", "Backend Engineer", "Frontend Engineer", "Full Stack"]
      },
      "industries": ["technology", "software", "saas", "fintech", "healthtech", "edtech", "ecommerce", "cybersecurity", "cloud", "ai", "machine learning"],
      "signals": ["open to work", "open to opportunities", "exploring", "available", "patents", "speaker", "open source contributor", "published", "aws certified", "gcp certified", "azure certified", "system design", "distributed systems", "architecture"],
      "companySizeSweet": { "min": 10, "max": 50000 },
      "weight": 1.0
    },
    "sales-leader-candidate": {
      "label": "Sales Leader Candidate",
      "description": "Experienced sales professionals for VP/Director sales roles",
      "rolePatterns": {
        "high": ["VP Sales", "CRO", "Chief Revenue", "Head of Sales", "SVP Sales"],
        "medium": ["Director Sales", "Director Business Development", "Regional VP Sales", "Area VP", "Senior Director Sales"],
        "low": ["Senior Account Executive", "Enterprise AE", "Sales Manager", "Team Lead Sales"]
      },
      "industries": ["saas", "software", "technology", "enterprise software", "cybersecurity", "fintech", "martech", "healthtech", "cloud"],
      "signals": ["quota attainment", "president's club", "top performer", "exceeded target", "built team from", "scaled revenue", "enterprise sales", "strategic accounts", "land and expand", "outbound", "pipeline generation"],
      "companySizeSweet": { "min": 50, "max": 10000 },
      "weight": 0.9
    },
    "product-leader-candidate": {
      "label": "Product Leader Candidate",
      "description": "Product managers and leaders for senior product roles",
      "rolePatterns": {
        "high": ["VP Product", "Chief Product", "Head of Product", "SVP Product", "CPO"],
        "medium": ["Director Product Management", "Group Product Manager", "Senior Product Manager", "Principal Product Manager"],
        "low": ["Product Manager", "Associate Product Manager", "Product Owner", "Technical Product Manager"]
      },
      "industries": ["technology", "saas", "software", "fintech", "healthtech", "edtech", "ecommerce", "marketplace", "platform"],
      "signals": ["0 to 1", "product-led growth", "plg", "shipped", "launched", "product market fit", "user research", "a/b testing", "growth product", "monetization", "platform product", "marketplace", "api product"],
      "companySizeSweet": { "min": 20, "max": 10000 },
      "weight": 0.85
    }
  },
  "niches": {
    "senior-engineers": ["staff engineer", "principal engineer", "senior software engineer", "architect"],
    "sales-leaders": ["VP Sales", "CRO", "sales director", "enterprise sales leader"],
    "product-leaders": ["VP Product", "Head of Product", "product director", "group product manager"],
    "open-to-work": ["open to work", "open to opportunities", "in transition", "available"],
    "engineering-managers": ["engineering manager", "director engineering", "head of engineering"]
  }
}
```

### Scoring Weight Adjustments for Recruiting

Recruiters should adjust scoring weights to emphasize skills/signals over traditional ICP dimensions:

```json
{
  "scoring": {
    "roleWeight": 0.40,
    "industryWeight": 0.15,
    "signalWeight": 0.35,
    "companySizeWeight": 0.10
  }
}
```

### Example User Prompts
- "Find staff and principal engineers who are open to work or mention distributed systems"
- "Score my connections for VP Sales candidate fit -- prioritize people who mention quota attainment or president's club"
- "Search for product leaders at SaaS companies who mention product-led growth"
- "Who in my network is a senior engineer at a FAANG company who might be a passive candidate?"

---

## Vertical 15: Regional VP of Marketing (Large Brand/Retailer)

### Persona Description
A Regional VP of Marketing at a large brand or retailer (1000+ employees) who manages marketing strategy and vendor relationships for a geographic region. They need to identify potential agency partners, media vendors, event sponsors, and technology partners -- as well as peer CMOs at non-competing brands for partnership opportunities and knowledge sharing.

### ICP Profiles

```json
{
  "profiles": {
    "agency-partner": {
      "label": "Agency / Vendor Partner",
      "description": "Agency principals and vendor sales leads who could support regional marketing initiatives",
      "rolePatterns": {
        "high": ["CEO", "President", "Managing Director", "Founder", "Partner", "Chief Growth Officer"],
        "medium": ["VP Business Development", "VP Client Services", "Director Business Development", "Director Sales", "SVP Growth"],
        "low": ["Account Director", "Account Manager", "New Business Director", "Sales Manager"]
      },
      "industries": ["advertising agency", "media agency", "digital agency", "marketing agency", "creative agency", "pr firm", "public relations", "event agency", "experiential marketing", "performance marketing agency", "media buying"],
      "signals": ["agency", "full service", "creative services", "media planning", "media buying", "programmatic", "experiential", "event marketing", "field marketing", "regional marketing", "retail marketing", "shopper marketing", "trade marketing", "co-op marketing"],
      "companySizeSweet": { "min": 10, "max": 500 },
      "weight": 1.0
    },
    "martech-vendor": {
      "label": "MarTech Vendor",
      "description": "Marketing technology vendors selling tools for campaign management, analytics, CRM, and loyalty",
      "rolePatterns": {
        "high": ["CEO", "CRO", "Chief Revenue", "VP Sales", "VP Enterprise Sales", "Head of Sales"],
        "medium": ["Director Sales", "Enterprise Account Executive", "Regional VP Sales", "Director Partnerships"],
        "low": ["Account Executive", "Solutions Consultant", "Sales Engineer", "Customer Success Manager"]
      },
      "industries": ["martech", "marketing technology", "adtech", "advertising technology", "crm", "customer data platform", "cdp", "loyalty", "email marketing", "sms marketing", "social media management", "analytics"],
      "signals": ["customer data platform", "cdp", "loyalty program", "personalization", "customer journey", "omnichannel", "attribution", "marketing automation", "campaign management", "audience segmentation", "retail media"],
      "companySizeSweet": { "min": 20, "max": 2000 },
      "weight": 0.85
    },
    "peer-cmo-partnership": {
      "label": "Peer CMO / Brand Partnership",
      "description": "Marketing leaders at non-competing brands for co-marketing and knowledge exchange",
      "rolePatterns": {
        "high": ["CMO", "Chief Marketing", "VP Marketing", "SVP Marketing", "Head of Marketing"],
        "medium": ["VP Brand", "VP Digital", "Director Marketing", "Director Brand", "Head of Brand"],
        "low": ["Senior Marketing Manager", "Brand Manager", "Marketing Director"]
      },
      "industries": ["retail", "consumer goods", "cpg", "food and beverage", "apparel", "beauty", "home", "automotive", "travel", "hospitality", "entertainment", "sports", "fitness"],
      "signals": ["brand partnership", "co-marketing", "cross-promotion", "collaboration", "brand ambassador", "influencer program", "cause marketing", "sustainability initiative", "community engagement", "regional activation", "local marketing"],
      "companySizeSweet": { "min": 500, "max": 50000 },
      "weight": 0.75
    }
  },
  "niches": {
    "agencies": ["marketing agency", "advertising agency", "media agency", "creative agency", "PR firm"],
    "martech-vendors": ["marketing technology", "CDP", "customer data platform", "loyalty platform", "marketing automation"],
    "peer-cmos": ["CMO", "VP Marketing", "Chief Marketing Officer", "head of marketing", "brand marketing"],
    "retail-marketing": ["retail marketing", "shopper marketing", "trade marketing", "field marketing"],
    "experiential": ["experiential marketing", "event marketing", "activation", "brand experience"]
  }
}
```

### Example User Prompts
- "Find agency owners and managing directors at regional marketing or experiential agencies"
- "Score my connections for martech vendor partnership potential"
- "Search for CMOs at consumer goods and retail brands with 1000+ employees"
- "Who in my network leads brand marketing at a non-competing retailer who might partner on a co-marketing campaign?"

---

## Scoring Weight Recommendations by Vertical

Different verticals should adjust the four scoring dimensions based on what matters most for their prospecting:

| Vertical | roleWeight | industryWeight | signalWeight | companySizeWeight | Rationale |
|----------|-----------|----------------|--------------|-------------------|-----------|
| SaaS Sales Rep | 0.30 | 0.25 | 0.30 | 0.15 | Signals (pain/intent) matter as much as role |
| Executive Recruiter | 0.40 | 0.20 | 0.30 | 0.10 | Role match is paramount for candidate fit |
| Management Consultant | 0.30 | 0.25 | 0.25 | 0.20 | Company size strongly correlates with deal size |
| Cybersecurity Sales | 0.25 | 0.30 | 0.30 | 0.15 | Industry (regulated) and signals (compliance) dominate |
| Financial Advisor | 0.35 | 0.20 | 0.35 | 0.10 | Role (owner/exec) + signals (liquidity/exit) are key |
| CRE Broker | 0.30 | 0.35 | 0.25 | 0.10 | Industry (real estate) is the strongest filter |
| Healthcare IT | 0.25 | 0.35 | 0.25 | 0.15 | Healthcare industry is the primary qualifier |
| Marketing Agency | 0.35 | 0.25 | 0.25 | 0.15 | Balanced -- title + industry + signals all matter |
| Manufacturing Consultant | 0.25 | 0.35 | 0.25 | 0.15 | Industry (manufacturing) is critical filter |
| Java Developer | 0.35 | 0.20 | 0.35 | 0.10 | Role (eng leader) + signals (tech stack) dominate |
| EdTech Sales | 0.30 | 0.35 | 0.20 | 0.15 | Industry (education) is the strongest qualifier |
| Legal Tech | 0.30 | 0.30 | 0.25 | 0.15 | Industry (legal) + role (managing partner) both key |
| Startup Founder | 0.40 | 0.25 | 0.25 | 0.10 | Role (GP/Partner) is the most critical signal |
| Recruiter/HR | 0.40 | 0.15 | 0.35 | 0.10 | Role + skills signals dominate; industry flexible |
| Regional VP Marketing | 0.30 | 0.30 | 0.25 | 0.15 | Industry alignment matters for partnerships |

### Gold Score Weight Adjustments

For verticals where network effects matter more (recruiting, VC prospecting, consulting):

```json
{
  "goldScore": {
    "icpWeight": 0.30,
    "networkHubWeight": 0.35,
    "relationshipWeight": 0.25,
    "signalBoostWeight": 0.10
  }
}
```

For transactional/product sales (SaaS, legal tech, edtech) where ICP fit is king:

```json
{
  "goldScore": {
    "icpWeight": 0.45,
    "networkHubWeight": 0.20,
    "relationshipWeight": 0.25,
    "signalBoostWeight": 0.10
  }
}
```

---

## Role Hierarchy Patterns by Industry

### Technology / SaaS
```
Board -> CEO/President -> CTO/CIO/CMO/CRO/CFO -> SVP/VP -> Senior Director -> Director -> Senior Manager -> Manager -> Lead -> IC
```

### Financial Services / Banking
```
Board -> CEO -> President/COO -> EVP -> SVP -> FVP (First VP) -> VP -> AVP -> Manager -> Analyst
Note: "VP" in banking is mid-level (equivalent to Manager in tech)
```

### Healthcare / Hospital Systems
```
Board -> CEO -> President -> CMO/CNO/CFO/CIO/CMIO -> SVP -> VP -> Director -> Manager -> Supervisor -> Coordinator
Additional: Chief Medical Officer, Chief Nursing Officer, Chief Medical Information Officer are clinical C-suite
```

### Law Firms
```
Managing Partner -> Equity Partner -> Non-Equity Partner -> Of Counsel -> Senior Associate -> Associate -> Paralegal
Admin: Managing Partner -> COO/CIO -> Director -> Manager
```

### Manufacturing
```
CEO -> President -> COO/CFO/CTO -> VP Operations/VP Manufacturing -> Plant Manager -> Director -> Manager -> Supervisor -> Lead
Note: "Plant Manager" is equivalent to VP-level authority within their site
```

### Higher Education
```
Board of Trustees -> President/Chancellor -> Provost/EVP -> VP/Dean -> Associate VP/Associate Dean -> Director -> Assistant Director -> Coordinator
Note: Faculty track (Professor -> Associate -> Assistant -> Lecturer) is parallel to admin track
```

### Private Equity / Venture Capital
```
Founding Partner/GP -> Managing Partner -> Partner -> Managing Director -> Principal -> VP -> Senior Associate -> Associate -> Analyst
Note: "VP" in PE is mid-level (equivalent to Manager in operating companies)
```

### Government / Public Sector
```
Secretary/Commissioner -> Deputy Secretary -> Undersecretary -> Assistant Secretary -> Director -> Deputy Director -> Branch Chief -> Division Chief -> Team Lead -> Analyst/Specialist
Note: "GS" pay grades (GS-13 to SES) indicate seniority; SES = Senior Executive Service = C-suite equivalent
```

### Real Estate
```
Principal/Owner -> Managing Director -> Senior VP -> VP -> Director -> Associate Director -> Senior Associate -> Associate -> Analyst
Note: "Broker" title indicates licensing, not hierarchy. "Managing Broker" = office leader.
```

---

## LinkedIn Profile Signal Taxonomy

### Pain Signals (indicate active need)

| Signal Category | Keywords to Match | Found In |
|----------------|-------------------|----------|
| Technical Debt | "legacy system", "technical debt", "outdated", "end of life", "sunsetted" | About, Experience |
| Compliance Pressure | "audit", "compliance gap", "remediation", "regulatory", "consent order" | About, Headline |
| Talent Shortage | "hiring challenges", "scaling team", "hard to find", "talent gap" | About, Posts |
| Growth Pains | "hypergrowth", "scaling", "outgrowing", "growing pains", "rapid growth" | Headline, About |
| Cost Pressure | "cost optimization", "budget constraints", "doing more with less", "efficiency" | About, Experience |
| Process Gaps | "manual process", "spreadsheet", "workaround", "inefficient", "bottleneck" | About, Experience |

### Initiative Signals (indicate active buying process)

| Signal Category | Keywords to Match | Found In |
|----------------|-------------------|----------|
| Active Evaluation | "evaluating", "shortlisting", "rfp", "vendor selection", "proof of concept" | About, Posts |
| Migration/Change | "migrating to", "transitioning from", "replacing", "upgrading", "implementing" | Experience, About |
| New Program | "launching", "building out", "standing up", "new initiative", "greenfield" | About, Experience |
| Hiring for Function | "building a team", "first hire", "new function", "recently created role" | Experience, About |
| Budget Cycle | "planning for next year", "budget approved", "allocated funds" | Posts |
| Strategic Priority | "priority for 2026", "strategic initiative", "board mandate", "CEO priority" | About, Posts |

### Authority Signals (indicate decision-making power)

| Signal Category | Keywords to Match | Found In |
|----------------|-------------------|----------|
| P&L Ownership | "p&l", "profit and loss", "revenue responsibility", "budget owner" | About, Experience |
| Team Size | "team of 50+", "managing 100+", "org of", "direct reports" | About, Experience |
| Board Involvement | "board member", "board advisor", "reporting to board", "board presentation" | Headline, About |
| Multi-Site/Region | "global", "regional", "multi-site", "multi-location", "across markets" | Headline, Experience |
| Vendor Authority | "vendor management", "procurement authority", "buying decision", "selected vendors" | About, Experience |

### Relationship/Network Signals (indicate connective value)

| Signal Category | Keywords to Match | Found In |
|----------------|-------------------|----------|
| Connector Identity | "connector", "introductions", "bridge", "bringing people together" | About, Headline |
| Speaking/Content | "speaker", "keynote", "author", "published", "podcast", "conference" | Headline, About |
| Community Role | "board member", "chapter leader", "association", "advisory board", "mentor" | Headline, About |
| Multi-Company | "portfolio", "advisor to", "board of", "multiple companies" | Headline, Experience |
| Alumni Network | "alumni", "former", "previously at", "ex-Google", "ex-McKinsey" | About, Experience |

### Urgency/Timing Signals (indicate near-term opportunity)

| Signal Category | Keywords to Match | Found In |
|----------------|-------------------|----------|
| New Role | Connected within 90 days + new title | Experience dates |
| Funding Event | "series a", "series b", "raised", "funding round", "just closed" | Headline, About |
| Acquisition | "recently acquired", "post-merger", "integration", "combined entity" | About, Experience |
| Expansion | "opening new", "expanding to", "new market", "new region", "international" | About, Experience |
| Leadership Change | "newly appointed", "just joined", "new chapter", "excited to announce" | Posts, About |

---

## Appendix: Complete ICP Config Templates

### Template A: Service-Based Professional (Consultant, Advisor, Freelancer)

Best for: consultants, fractional executives, freelance developers, coaches

```json
{
  "profiles": {
    "primary-service": {
      "label": "YOUR PRIMARY SERVICE",
      "description": "Decision-makers who buy YOUR_SERVICE",
      "rolePatterns": {
        "high": ["BUDGET_HOLDER_TITLES"],
        "medium": ["INFLUENCER_TITLES"],
        "low": ["IMPLEMENTER_TITLES"]
      },
      "industries": ["TARGET_INDUSTRY_KEYWORDS"],
      "signals": ["PAIN_AND_INITIATIVE_SIGNALS"],
      "companySizeSweet": { "min": 10, "max": 500 },
      "weight": 1.0
    }
  },
  "scoring": { "roleWeight": 0.35, "industryWeight": 0.25, "signalWeight": 0.25, "companySizeWeight": 0.15 },
  "goldScore": { "icpWeight": 0.35, "networkHubWeight": 0.30, "relationshipWeight": 0.25, "signalBoostWeight": 0.10 },
  "tiers": { "gold": 0.55, "silver": 0.40, "bronze": 0.28 },
  "niches": { "primary": ["LINKEDIN_SEARCH_KEYWORDS"] }
}
```

### Template B: Product Sales (SaaS, Hardware, Platform)

Best for: AEs, SDRs, sales engineers selling a product

```json
{
  "profiles": {
    "enterprise-buyer": {
      "label": "Enterprise Buyer",
      "description": "Senior leaders with budget authority for YOUR_PRODUCT_CATEGORY",
      "rolePatterns": {
        "high": ["C_SUITE_TITLES_IN_YOUR_BUYER_FUNCTION"],
        "medium": ["VP_DIRECTOR_TITLES"],
        "low": ["MANAGER_EVALUATOR_TITLES"]
      },
      "industries": ["YOUR_TARGET_VERTICALS"],
      "signals": ["PAIN_SIGNALS_YOUR_PRODUCT_SOLVES"],
      "companySizeSweet": { "min": 200, "max": 5000 },
      "weight": 1.0
    },
    "mid-market-champion": {
      "label": "Mid-Market Champion",
      "description": "Hands-on evaluators who recommend YOUR_PRODUCT internally",
      "rolePatterns": {
        "high": ["DIRECTOR_HEAD_OF_TITLES"],
        "medium": ["MANAGER_TITLES"],
        "low": ["IC_POWER_USER_TITLES"]
      },
      "industries": ["SAME_OR_SUBSET_INDUSTRIES"],
      "signals": ["EVALUATION_AND_IMPLEMENTATION_SIGNALS"],
      "companySizeSweet": { "min": 50, "max": 500 },
      "weight": 0.85
    }
  },
  "scoring": { "roleWeight": 0.30, "industryWeight": 0.25, "signalWeight": 0.30, "companySizeWeight": 0.15 },
  "goldScore": { "icpWeight": 0.45, "networkHubWeight": 0.20, "relationshipWeight": 0.25, "signalBoostWeight": 0.10 },
  "tiers": { "gold": 0.55, "silver": 0.40, "bronze": 0.28 },
  "niches": { "vertical-1": ["KEYWORDS"], "vertical-2": ["KEYWORDS"] }
}
```

### Template C: Recruiting / Talent Sourcing

Best for: recruiters, talent acquisition, HR

```json
{
  "profiles": {
    "target-candidate-role": {
      "label": "ROLE_YOU_ARE_HIRING_FOR",
      "description": "Experienced ROLE_TYPE who are passive candidates",
      "rolePatterns": {
        "high": ["SENIOR_MOST_TITLES_YOU_WANT"],
        "medium": ["MID_LEVEL_TITLES"],
        "low": ["JUNIOR_BUT_GROWING_TITLES"]
      },
      "industries": ["INDUSTRIES_WITH_BEST_TALENT_FOR_THIS_ROLE"],
      "signals": ["SKILLS_CERTIFICATIONS_ACHIEVEMENTS_SIGNALS"],
      "companySizeSweet": { "min": 10, "max": 50000 },
      "weight": 1.0
    }
  },
  "scoring": { "roleWeight": 0.40, "industryWeight": 0.15, "signalWeight": 0.35, "companySizeWeight": 0.10 },
  "goldScore": { "icpWeight": 0.40, "networkHubWeight": 0.20, "relationshipWeight": 0.30, "signalBoostWeight": 0.10 },
  "tiers": { "gold": 0.55, "silver": 0.40, "bronze": 0.28 },
  "niches": { "role-keywords": ["ROLE_SPECIFIC_SEARCH_TERMS"] }
}
```

### Template D: Investor Prospecting

Best for: startup founders, fund managers raising capital

```json
{
  "profiles": {
    "target-investor": {
      "label": "TARGET_INVESTOR_TYPE",
      "description": "INVESTOR_TYPE who invests in YOUR_SECTOR at YOUR_STAGE",
      "rolePatterns": {
        "high": ["GP", "Partner", "Managing Director", "Managing Partner"],
        "medium": ["Principal", "VP", "Investment Director", "Venture Partner"],
        "low": ["Senior Associate", "Associate", "Analyst", "Scout"]
      },
      "industries": ["FUND_TYPE_KEYWORDS"],
      "signals": ["INVESTMENT_THESIS_AND_ACTIVITY_SIGNALS"],
      "companySizeSweet": { "min": 1, "max": 200 },
      "weight": 1.0
    }
  },
  "scoring": { "roleWeight": 0.40, "industryWeight": 0.25, "signalWeight": 0.25, "companySizeWeight": 0.10 },
  "goldScore": { "icpWeight": 0.35, "networkHubWeight": 0.35, "relationshipWeight": 0.20, "signalBoostWeight": 0.10 },
  "tiers": { "gold": 0.55, "silver": 0.40, "bronze": 0.28 },
  "niches": { "investors": ["INVESTOR_SEARCH_TERMS"] }
}
```

---

## Signal Boost Customization by Vertical

The `computeSignalBoost` function in `scorer.mjs` currently hardcodes `['ai', 'automation', 'scaling', 'growth']` as boost terms. Each vertical should override this. Below are recommended signal boost terms per vertical:

| Vertical | Recommended Signal Boost Terms |
|----------|-------------------------------|
| SaaS Sales Rep | `["digital transformation", "evaluating", "rfp", "implementation"]` |
| Executive Recruiter | `["hiring", "growing team", "scaling", "open to opportunities"]` |
| Management Consultant | `["transformation", "restructuring", "merger", "strategy"]` |
| Cybersecurity / vCISO | `["compliance", "breach", "audit", "zero trust", "soc 2"]` |
| Financial Advisor | `["exit", "succession", "retirement", "liquidity", "estate"]` |
| CRE Broker | `["relocation", "expansion", "acquisition", "lease", "development"]` |
| Healthcare IT | `["ehr", "interoperability", "telehealth", "hipaa", "epic"]` |
| Marketing Agency | `["rebranding", "agency search", "rfp", "brand refresh", "launch"]` |
| Manufacturing Consultant | `["lean", "industry 4.0", "automation", "supply chain", "erp"]` |
| Java Developer | `["hiring", "microservices", "modernization", "spring boot", "cloud native"]` |
| EdTech Sales | `["lms", "online learning", "upskilling", "student success", "enrollment"]` |
| Legal Tech | `["legal tech", "contract management", "e-discovery", "legal ops", "ai in legal"]` |
| Startup Founder | `["investing", "portfolio", "series a", "thesis", "deal flow"]` |
| Recruiter/HR | `["open to work", "available", "transition", "certifications", "patents"]` |
| Regional VP Marketing | `["agency", "partnership", "co-marketing", "experiential", "retail media"]` |

**Implementation note:** The signal boost terms should be configurable in `icp-config.json` rather than hardcoded, allowing each vertical to customize without code changes. Suggested config addition:

```json
{
  "signalBoost": {
    "headlineTerms": ["transformation", "evaluating", "implementing"],
    "aboutTerms": ["digital transformation", "modernization", "growth"]
  }
}
```

---

## Industry-Specific LinkedIn Search Patterns

### Best Practices for LinkedIn Search Term Selection

1. **Use role + industry combos** for niche targeting: "CISO healthcare" not just "CISO"
2. **Include company-type keywords**: "startup", "fortune 500", "PE-backed", "family-owned"
3. **Use problem/solution language**: People describe problems in headlines ("scaling ops"), solutions in about sections ("implemented SAP")
4. **Include credential keywords**: "PMP", "CPA", "CISSP", "AWS certified" -- these appear in Skills and Headlines
5. **Search industry jargon**: Every industry has its own abbreviations (RCM, CLM, OEE, S&OP, ABM, PLG)
6. **Target title modifiers**: "interim", "fractional", "acting", "newly appointed" signal transition/opportunity
7. **Use geographic modifiers** when prospecting regionally: "Chicago marketing", "Bay Area CTO"

### Common LinkedIn Boolean Search Patterns

```
# Find budget holders in a specific vertical
("VP" OR "Director" OR "Head of") AND ("marketing" OR "brand") AND ("CPG" OR "consumer goods")

# Find people at companies in transition
("digital transformation" OR "modernization" OR "migration") AND ("CIO" OR "CTO" OR "VP IT")

# Find recently promoted/new hires (via posts)
("excited to announce" OR "new role" OR "thrilled to join") AND ("CISO" OR "security")

# Find passive candidates with specific skills
("staff engineer" OR "principal engineer") AND ("distributed systems" OR "system design") AND ("Java" OR "Kotlin")
```

---

*This document was generated on 2026-03-10 for the LinkedIn Prospector tool. Each vertical configuration is designed to be used directly with `configure.mjs generate --json` or as a reference for the interactive wizard flow.*
