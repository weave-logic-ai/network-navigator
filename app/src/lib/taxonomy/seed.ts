// Seed default taxonomy data (industries, niches, offerings, ICPs)
// Called after initial import if tables are empty

import { query } from '../db/client';
import type { PoolClient } from 'pg';

/**
 * Seeds taxonomy tables if they are empty.
 * Safe to call multiple times — skips if data already exists.
 */
export async function seedTaxonomyIfEmpty(client?: PoolClient): Promise<{ seeded: boolean; counts: { industries: number; niches: number; offerings: number; icps: number } }> {
  const exec = client
    ? (sql: string, params?: unknown[]) => client.query(sql, params)
    : (sql: string, params?: unknown[]) => query(sql, params);

  // Check if niches already exist (industries will have at least "General")
  const nicheCheck = await exec('SELECT count(*)::int AS c FROM niche_profiles');
  if (nicheCheck.rows[0].c > 0) {
    return { seeded: false, counts: { industries: 0, niches: 0, offerings: 0, icps: 0 } };
  }

  // Industries
  await exec(`
    INSERT INTO industries (name, slug, description) VALUES
      ('Healthcare & Life Sciences', 'healthcare', 'Digital health, clinical research, healthcare SaaS'),
      ('Financial Services & Fintech', 'fintech', 'Payments, wealthtech, insurtech, crypto infrastructure'),
      ('B2B SaaS & Enterprise Software', 'saas', 'Vertical SaaS, dev tools, HR tech, enterprise platforms'),
      ('E-Commerce & Retail Tech', 'ecommerce', 'D2C brands, marketplace platforms, retail analytics'),
      ('Real Estate & PropTech', 'proptech', 'Property management, investment platforms, construction tech'),
      ('Education & EdTech', 'edtech', 'K-12/higher ed platforms, corporate training, EdTech startups'),
      ('Media & Creator Economy', 'media', 'Streaming, creator platforms, gaming & interactive'),
      ('Professional Services & Agencies', 'professional-services', 'Digital agencies, consulting firms, law/accounting firms'),
      ('Manufacturing & Industrial Tech', 'manufacturing', 'Smart manufacturing, IIoT, supply chain & logistics'),
      ('Nonprofit & Social Impact', 'nonprofit', 'Nonprofit tech modernization, govtech, civic tech')
    ON CONFLICT (name) DO NOTHING
  `);

  // Niches — helper to insert per industry
  const nicheData: Array<{ slug: string; niches: Array<{ name: string; desc: string; keywords: string[] }> }> = [
    { slug: 'healthcare', niches: [
      { name: 'Digital Health Startups', desc: 'Telehealth, remote patient monitoring, health apps', keywords: ['HIPAA','EHR integration','telehealth','FDA SaMD','remote monitoring'] },
      { name: 'Healthcare SaaS', desc: 'Practice management, revenue cycle, patient engagement', keywords: ['interoperability','PHI','value-based care','practice management','patient engagement'] },
      { name: 'Clinical Research & Biotech', desc: 'Lab informatics, clinical trials, genomics pipelines', keywords: ['LIMS','HL7','FHIR','clinical trials','regulatory compliance'] },
    ]},
    { slug: 'fintech', niches: [
      { name: 'Embedded Finance & Payments', desc: 'Payment processing, lending-as-a-service, banking APIs', keywords: ['PCI-DSS','SOC 2','open banking','payment processing','lending'] },
      { name: 'Wealthtech & Insurtech', desc: 'Robo-advisors, insurance platforms, portfolio management', keywords: ['SEC compliance','underwriting','robo-advisor','portfolio management'] },
      { name: 'Crypto & DeFi Infrastructure', desc: 'Exchanges, custody, blockchain protocols', keywords: ['smart contracts','wallet infrastructure','custody','blockchain','DeFi'] },
    ]},
    { slug: 'saas', niches: [
      { name: 'Vertical SaaS', desc: 'Industry-specific platforms (construction, legal, logistics)', keywords: ['domain workflows','multi-tenant','PLG','vertical SaaS','product-led growth'] },
      { name: 'Developer Tools & Infrastructure', desc: 'APIs, SDKs, observability, CI/CD platforms', keywords: ['developer experience','platform engineering','usage-based pricing','API','observability'] },
      { name: 'HR Tech & Workforce Management', desc: 'Recruiting, payroll, employee engagement platforms', keywords: ['ATS integration','workforce analytics','compliance','payroll','recruiting'] },
    ]},
    { slug: 'ecommerce', niches: [
      { name: 'D2C Brands Scaling Tech', desc: 'Shopify Plus migrations, headless commerce, subscriptions', keywords: ['composable commerce','Shopify','BigCommerce','headless','subscription'] },
      { name: 'Marketplace Platforms', desc: 'Two-sided marketplaces, fulfillment tech, inventory', keywords: ['matching algorithms','logistics','trust and safety','marketplace','fulfillment'] },
      { name: 'Retail Analytics & Personalization', desc: 'Recommendation engines, pricing optimization, CDP', keywords: ['CDP','A/B testing','demand forecasting','personalization','recommendation'] },
    ]},
    { slug: 'proptech', niches: [
      { name: 'Property Management Software', desc: 'Tenant portals, maintenance automation, lease management', keywords: ['IoT','smart buildings','MLS integration','tenant portal','lease management'] },
      { name: 'Construction Tech', desc: 'Project management, BIM integration, estimating tools', keywords: ['BIM','field mobility','subcontractor management','preconstruction','estimating'] },
    ]},
    { slug: 'edtech', niches: [
      { name: 'K-12 & Higher Ed Platforms', desc: 'LMS, student information systems, assessment tools', keywords: ['FERPA','LTI integration','accessibility','WCAG','LMS'] },
      { name: 'Corporate Training & Upskilling', desc: 'Learning experience platforms, cohort courses, skills tracking', keywords: ['SCORM','xAPI','competency mapping','learning experience','upskilling'] },
      { name: 'EdTech Startups', desc: 'AI tutoring, credentialing, content marketplaces', keywords: ['adaptive learning','creator tools','engagement metrics','AI tutoring','credentialing'] },
    ]},
    { slug: 'media', niches: [
      { name: 'Streaming & Content Platforms', desc: 'OTT video, podcast infra, digital publishing', keywords: ['CDN','DRM','content recommendation','transcoding','OTT'] },
      { name: 'Creator & Influencer Platforms', desc: 'Monetization tools, community platforms, social commerce', keywords: ['creator analytics','payouts','social commerce','monetization','community'] },
    ]},
    { slug: 'professional-services', niches: [
      { name: 'Digital Agencies Scaling', desc: 'Web dev shops, marketing agencies adding product capabilities', keywords: ['white-label','project profitability','retainer-to-product','agency','scaling'] },
      { name: 'Consulting Firms Building IP', desc: 'Management consultancies building SaaS or data products', keywords: ['productization','recurring revenue','knowledge management','consulting','SaaS'] },
    ]},
    { slug: 'manufacturing', niches: [
      { name: 'Smart Manufacturing & IIoT', desc: 'Factory floor digitization, predictive maintenance, MES', keywords: ['OPC-UA','SCADA','edge computing','digital twin','predictive maintenance'] },
      { name: 'Supply Chain & Logistics Tech', desc: 'Fleet management, warehouse automation, visibility', keywords: ['TMS','WMS','track-and-trace','demand planning','logistics'] },
    ]},
    { slug: 'nonprofit', niches: [
      { name: 'Nonprofit Tech Modernization', desc: 'Donor management, program delivery, impact measurement', keywords: ['Salesforce NPSP','grant management','CRM migration','donor management','impact'] },
      { name: 'GovTech & Civic Tech', desc: 'Government service delivery, open data, permitting', keywords: ['FedRAMP','ATO','Section 508','accessibility','civic tech'] },
    ]},
  ];

  let nicheCount = 0;
  for (const group of nicheData) {
    for (const n of group.niches) {
      await exec(
        `INSERT INTO niche_profiles (name, description, industry_id, keywords)
         VALUES ($1, $2, (SELECT id FROM industries WHERE slug = $3), $4)
         ON CONFLICT (industry_id, name) DO NOTHING`,
        [n.name, n.desc, group.slug, n.keywords]
      );
      nicheCount++;
    }
  }

  // Offerings
  await exec(`
    INSERT INTO offerings (name, description, sort_order) VALUES
      ('Technical Strategy & Roadmap', 'Architecture review, technology selection, build-vs-buy analysis, and 90-day technical roadmap', 1),
      ('Engineering Team Build-Out', 'Hiring plan, candidate vetting, team structure design, engineering culture, CTO/VP Eng onboarding', 2),
      ('Due Diligence & Technical Assessment', 'Code audits, architecture reviews, security posture for investors, acquirers, or boards', 3),
      ('Cloud & DevOps Modernization', 'Cloud migration, CI/CD pipeline design, cost optimization, observability, disaster recovery', 4),
      ('Product & Platform Architecture', 'System design for scale, API strategy, data architecture, microservices, tech debt remediation', 5),
      ('Security & Compliance Program', 'SOC 2 readiness, HIPAA/PCI compliance, security architecture, incident response, vendor risk', 6)
    ON CONFLICT DO NOTHING
  `);

  // ICPs — one per key niche
  const icpData: Array<{ niche: string; name: string; desc: string; criteria: Record<string, unknown> }> = [
    { niche: 'Digital Health Startups', name: 'Health Tech Founders', desc: 'Non-technical founders building digital health products',
      criteria: { roles: ['CEO','Founder','COO','Managing Director'], industries: ['healthcare','digital health','telehealth'], companySizeRanges: ['10-50','51-200'], signals: ['HIPAA','hiring engineers','fundraising','product launch'], minConnections: 100 }},
    { niche: 'Embedded Finance & Payments', name: 'Fintech Founders', desc: 'Founders building payment, lending, or banking products',
      criteria: { roles: ['CEO','Founder','COO','CPO'], industries: ['fintech','payments','banking'], companySizeRanges: ['10-50','51-200'], signals: ['PCI compliance','SOC 2','Series A','open banking'], minConnections: 100 }},
    { niche: 'Vertical SaaS', name: 'Vertical SaaS Founders', desc: 'Founders of industry-specific SaaS platforms',
      criteria: { roles: ['CEO','Founder','COO','VP Engineering'], industries: ['SaaS','software','construction tech','legal tech'], companySizeRanges: ['10-50','51-200'], signals: ['product-led growth','multi-tenant','scaling','hiring engineers'], minConnections: 100 }},
    { niche: 'D2C Brands Scaling Tech', name: 'E-Commerce Brand Operators', desc: 'D2C brand operators scaling their tech stack',
      criteria: { roles: ['CEO','Founder','COO','VP Operations','Head of E-Commerce'], industries: ['e-commerce','DTC','retail','Shopify'], companySizeRanges: ['10-50','51-200'], signals: ['Shopify Plus','headless commerce','migration','scaling'], minConnections: 50 }},
    { niche: 'Property Management Software', name: 'PropTech Founders', desc: 'Founders building property management or construction tech',
      criteria: { roles: ['CEO','Founder','COO','VP Technology'], industries: ['real estate','property management','proptech'], companySizeRanges: ['10-50','51-200'], signals: ['IoT','smart building','tenant portal','automation'], minConnections: 50 }},
    { niche: 'EdTech Startups', name: 'EdTech Founders', desc: 'Non-technical founders building education technology',
      criteria: { roles: ['CEO','Founder','COO','Head of Product'], industries: ['education','edtech','e-learning'], companySizeRanges: ['10-50','51-200'], signals: ['adaptive learning','AI tutoring','fundraising','FERPA'], minConnections: 50 }},
    { niche: 'Digital Agencies Scaling', name: 'Agency Owners Scaling', desc: 'Agency owners transitioning from services to product',
      criteria: { roles: ['CEO','Founder','Managing Director','Partner','Owner'], industries: ['digital agency','marketing agency','web development'], companySizeRanges: ['10-50','51-200'], signals: ['productization','white-label','scaling','recurring revenue'], minConnections: 50 }},
    { niche: 'Smart Manufacturing & IIoT', name: 'Manufacturing Tech Leaders', desc: 'Leaders digitizing manufacturing and supply chain',
      criteria: { roles: ['CEO','COO','VP Operations','Director of IT','Plant Manager'], industries: ['manufacturing','industrial','supply chain'], companySizeRanges: ['51-200','201-500'], signals: ['digital twin','predictive maintenance','IIoT','edge computing'], minConnections: 50 }},
    { niche: 'Nonprofit Tech Modernization', name: 'Nonprofit Tech Leaders', desc: 'Executive directors modernizing nonprofit technology',
      criteria: { roles: ['Executive Director','CEO','COO','Director of Technology'], industries: ['nonprofit','social impact','philanthropy'], companySizeRanges: ['10-50','51-200'], signals: ['CRM migration','Salesforce','digital transformation','grant management'], minConnections: 30 }},
  ];

  let icpCount = 0;
  for (const icp of icpData) {
    await exec(
      `INSERT INTO icp_profiles (name, description, niche_id, criteria)
       VALUES ($1, $2, (SELECT id FROM niche_profiles WHERE name = $3), $4)`,
      [icp.name, icp.desc, icp.niche, JSON.stringify(icp.criteria)]
    );
    icpCount++;
  }

  const indResult = await exec('SELECT count(*)::int AS c FROM industries WHERE slug != $1', ['general']);

  return {
    seeded: true,
    counts: {
      industries: indResult.rows[0].c,
      niches: nicheCount,
      offerings: 6,
      icps: icpCount,
    },
  };
}
