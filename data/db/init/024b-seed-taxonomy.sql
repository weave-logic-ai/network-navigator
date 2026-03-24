-- 024b-seed-taxonomy.sql
-- Seed data: Fractional CTO taxonomy (industries, niches, offerings, ICPs)
-- Safe to re-run (uses ON CONFLICT DO NOTHING)

-- ============================================================
-- Industries
-- ============================================================
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
ON CONFLICT (name) DO NOTHING;

-- ============================================================
-- Niches
-- ============================================================

-- Healthcare
INSERT INTO niche_profiles (name, description, industry_id, keywords) VALUES
  ('Digital Health Startups', 'Telehealth, remote patient monitoring, health apps',
    (SELECT id FROM industries WHERE slug='healthcare'),
    ARRAY['HIPAA','EHR integration','telehealth','FDA SaMD','remote monitoring']),
  ('Healthcare SaaS', 'Practice management, revenue cycle, patient engagement',
    (SELECT id FROM industries WHERE slug='healthcare'),
    ARRAY['interoperability','PHI','value-based care','practice management','patient engagement']),
  ('Clinical Research & Biotech', 'Lab informatics, clinical trials, genomics pipelines',
    (SELECT id FROM industries WHERE slug='healthcare'),
    ARRAY['LIMS','HL7','FHIR','clinical trials','regulatory compliance'])
ON CONFLICT (industry_id, name) DO NOTHING;

-- Fintech
INSERT INTO niche_profiles (name, description, industry_id, keywords) VALUES
  ('Embedded Finance & Payments', 'Payment processing, lending-as-a-service, banking APIs',
    (SELECT id FROM industries WHERE slug='fintech'),
    ARRAY['PCI-DSS','SOC 2','open banking','payment processing','lending']),
  ('Wealthtech & Insurtech', 'Robo-advisors, insurance platforms, portfolio management',
    (SELECT id FROM industries WHERE slug='fintech'),
    ARRAY['SEC compliance','underwriting','robo-advisor','portfolio management']),
  ('Crypto & DeFi Infrastructure', 'Exchanges, custody, blockchain protocols',
    (SELECT id FROM industries WHERE slug='fintech'),
    ARRAY['smart contracts','wallet infrastructure','custody','blockchain','DeFi'])
ON CONFLICT (industry_id, name) DO NOTHING;

-- B2B SaaS
INSERT INTO niche_profiles (name, description, industry_id, keywords) VALUES
  ('Vertical SaaS', 'Industry-specific platforms (construction, legal, logistics)',
    (SELECT id FROM industries WHERE slug='saas'),
    ARRAY['domain workflows','multi-tenant','PLG','vertical SaaS','product-led growth']),
  ('Developer Tools & Infrastructure', 'APIs, SDKs, observability, CI/CD platforms',
    (SELECT id FROM industries WHERE slug='saas'),
    ARRAY['developer experience','platform engineering','usage-based pricing','API','observability']),
  ('HR Tech & Workforce Management', 'Recruiting, payroll, employee engagement platforms',
    (SELECT id FROM industries WHERE slug='saas'),
    ARRAY['ATS integration','workforce analytics','compliance','payroll','recruiting'])
ON CONFLICT (industry_id, name) DO NOTHING;

-- E-Commerce
INSERT INTO niche_profiles (name, description, industry_id, keywords) VALUES
  ('D2C Brands Scaling Tech', 'Shopify Plus migrations, headless commerce, subscriptions',
    (SELECT id FROM industries WHERE slug='ecommerce'),
    ARRAY['composable commerce','Shopify','BigCommerce','headless','subscription']),
  ('Marketplace Platforms', 'Two-sided marketplaces, fulfillment tech, inventory',
    (SELECT id FROM industries WHERE slug='ecommerce'),
    ARRAY['matching algorithms','logistics','trust and safety','marketplace','fulfillment']),
  ('Retail Analytics & Personalization', 'Recommendation engines, pricing optimization, CDP',
    (SELECT id FROM industries WHERE slug='ecommerce'),
    ARRAY['CDP','A/B testing','demand forecasting','personalization','recommendation'])
ON CONFLICT (industry_id, name) DO NOTHING;

-- PropTech
INSERT INTO niche_profiles (name, description, industry_id, keywords) VALUES
  ('Property Management Software', 'Tenant portals, maintenance automation, lease management',
    (SELECT id FROM industries WHERE slug='proptech'),
    ARRAY['IoT','smart buildings','MLS integration','tenant portal','lease management']),
  ('Construction Tech', 'Project management, BIM integration, estimating tools',
    (SELECT id FROM industries WHERE slug='proptech'),
    ARRAY['BIM','field mobility','subcontractor management','preconstruction','estimating'])
ON CONFLICT (industry_id, name) DO NOTHING;

-- EdTech
INSERT INTO niche_profiles (name, description, industry_id, keywords) VALUES
  ('K-12 & Higher Ed Platforms', 'LMS, student information systems, assessment tools',
    (SELECT id FROM industries WHERE slug='edtech'),
    ARRAY['FERPA','LTI integration','accessibility','WCAG','LMS']),
  ('Corporate Training & Upskilling', 'Learning experience platforms, cohort courses, skills tracking',
    (SELECT id FROM industries WHERE slug='edtech'),
    ARRAY['SCORM','xAPI','competency mapping','learning experience','upskilling']),
  ('EdTech Startups', 'AI tutoring, credentialing, content marketplaces',
    (SELECT id FROM industries WHERE slug='edtech'),
    ARRAY['adaptive learning','creator tools','engagement metrics','AI tutoring','credentialing'])
ON CONFLICT (industry_id, name) DO NOTHING;

-- Media
INSERT INTO niche_profiles (name, description, industry_id, keywords) VALUES
  ('Streaming & Content Platforms', 'OTT video, podcast infra, digital publishing',
    (SELECT id FROM industries WHERE slug='media'),
    ARRAY['CDN','DRM','content recommendation','transcoding','OTT']),
  ('Creator & Influencer Platforms', 'Monetization tools, community platforms, social commerce',
    (SELECT id FROM industries WHERE slug='media'),
    ARRAY['creator analytics','payouts','social commerce','monetization','community'])
ON CONFLICT (industry_id, name) DO NOTHING;

-- Professional Services
INSERT INTO niche_profiles (name, description, industry_id, keywords) VALUES
  ('Digital Agencies Scaling', 'Web dev shops, marketing agencies adding product capabilities',
    (SELECT id FROM industries WHERE slug='professional-services'),
    ARRAY['white-label','project profitability','retainer-to-product','agency','scaling']),
  ('Consulting Firms Building IP', 'Management consultancies building SaaS or data products',
    (SELECT id FROM industries WHERE slug='professional-services'),
    ARRAY['productization','recurring revenue','knowledge management','consulting','SaaS'])
ON CONFLICT (industry_id, name) DO NOTHING;

-- Manufacturing
INSERT INTO niche_profiles (name, description, industry_id, keywords) VALUES
  ('Smart Manufacturing & IIoT', 'Factory floor digitization, predictive maintenance, MES',
    (SELECT id FROM industries WHERE slug='manufacturing'),
    ARRAY['OPC-UA','SCADA','edge computing','digital twin','predictive maintenance']),
  ('Supply Chain & Logistics Tech', 'Fleet management, warehouse automation, visibility',
    (SELECT id FROM industries WHERE slug='manufacturing'),
    ARRAY['TMS','WMS','track-and-trace','demand planning','logistics'])
ON CONFLICT (industry_id, name) DO NOTHING;

-- Nonprofit
INSERT INTO niche_profiles (name, description, industry_id, keywords) VALUES
  ('Nonprofit Tech Modernization', 'Donor management, program delivery, impact measurement',
    (SELECT id FROM industries WHERE slug='nonprofit'),
    ARRAY['Salesforce NPSP','grant management','CRM migration','donor management','impact']),
  ('GovTech & Civic Tech', 'Government service delivery, open data, permitting',
    (SELECT id FROM industries WHERE slug='nonprofit'),
    ARRAY['FedRAMP','ATO','Section 508','accessibility','civic tech'])
ON CONFLICT (industry_id, name) DO NOTHING;

-- ============================================================
-- Offerings
-- ============================================================
INSERT INTO offerings (name, description, sort_order) VALUES
  ('Technical Strategy & Roadmap', 'Architecture review, technology selection, build-vs-buy analysis, and 90-day technical roadmap', 1),
  ('Engineering Team Build-Out', 'Hiring plan, candidate vetting, team structure design, engineering culture, CTO/VP Eng onboarding', 2),
  ('Due Diligence & Technical Assessment', 'Code audits, architecture reviews, security posture for investors, acquirers, or boards', 3),
  ('Cloud & DevOps Modernization', 'Cloud migration, CI/CD pipeline design, cost optimization, observability, disaster recovery', 4),
  ('Product & Platform Architecture', 'System design for scale, API strategy, data architecture, microservices, tech debt remediation', 5),
  ('Security & Compliance Program', 'SOC 2 readiness, HIPAA/PCI compliance, security architecture, incident response, vendor risk', 6);

-- ============================================================
-- ICPs (one per niche — generic fractional CTO buyer persona)
-- ============================================================
INSERT INTO icp_profiles (name, description, niche_id, criteria) VALUES
  ('Health Tech Founders', 'Non-technical founders building digital health products',
    (SELECT id FROM niche_profiles WHERE name='Digital Health Startups'),
    '{"roles":["CEO","Founder","COO","Managing Director"],"industries":["healthcare","digital health","telehealth"],"companySizeRanges":["10-50","51-200"],"signals":["HIPAA","hiring engineers","fundraising","product launch"],"minConnections":100}'),
  ('Healthcare SaaS Leaders', 'Leaders at healthcare SaaS needing tech strategy',
    (SELECT id FROM niche_profiles WHERE name='Healthcare SaaS'),
    '{"roles":["CEO","COO","VP Product","Director of Engineering"],"industries":["healthcare IT","health tech","medical software"],"companySizeRanges":["11-50","51-200"],"signals":["scaling","compliance","interoperability","EHR integration"],"minConnections":50}'),
  ('Fintech Founders', 'Founders building payment, lending, or banking products',
    (SELECT id FROM niche_profiles WHERE name='Embedded Finance & Payments'),
    '{"roles":["CEO","Founder","COO","CPO"],"industries":["fintech","payments","banking","financial services"],"companySizeRanges":["10-50","51-200"],"signals":["PCI compliance","SOC 2","Series A","open banking","API"],"minConnections":100}'),
  ('Wealthtech Decision Makers', 'Leaders at wealth management and insurance tech companies',
    (SELECT id FROM niche_profiles WHERE name='Wealthtech & Insurtech'),
    '{"roles":["CEO","Founder","COO","Head of Technology"],"industries":["wealthtech","insurtech","financial advisory"],"companySizeRanges":["11-50","51-200"],"signals":["regulatory","automation","portfolio management","robo-advisor"],"minConnections":50}'),
  ('Vertical SaaS Founders', 'Founders of industry-specific SaaS platforms',
    (SELECT id FROM niche_profiles WHERE name='Vertical SaaS'),
    '{"roles":["CEO","Founder","COO","VP Engineering"],"industries":["SaaS","software","construction tech","legal tech","logistics"],"companySizeRanges":["10-50","51-200"],"signals":["product-led growth","multi-tenant","scaling","hiring engineers"],"minConnections":100}'),
  ('DevTools Leaders', 'Leaders at developer tools and infrastructure companies',
    (SELECT id FROM niche_profiles WHERE name='Developer Tools & Infrastructure'),
    '{"roles":["CEO","Founder","CTO","VP Engineering"],"industries":["developer tools","API","infrastructure","observability"],"companySizeRanges":["10-50","51-200"],"signals":["platform engineering","developer experience","usage-based","open source"],"minConnections":100}'),
  ('E-Commerce Brand Operators', 'D2C brand operators scaling their tech stack',
    (SELECT id FROM niche_profiles WHERE name='D2C Brands Scaling Tech'),
    '{"roles":["CEO","Founder","COO","VP Operations","Head of E-Commerce"],"industries":["e-commerce","DTC","retail","Shopify"],"companySizeRanges":["10-50","51-200"],"signals":["Shopify Plus","headless commerce","migration","scaling","replatforming"],"minConnections":50}'),
  ('Marketplace Founders', 'Founders building two-sided marketplace platforms',
    (SELECT id FROM niche_profiles WHERE name='Marketplace Platforms'),
    '{"roles":["CEO","Founder","COO","CPO"],"industries":["marketplace","e-commerce","logistics"],"companySizeRanges":["10-50","51-200"],"signals":["matching","fulfillment","trust and safety","Series A","growth"],"minConnections":100}'),
  ('PropTech Founders', 'Founders building property management or construction tech',
    (SELECT id FROM niche_profiles WHERE name='Property Management Software'),
    '{"roles":["CEO","Founder","COO","VP Technology"],"industries":["real estate","property management","proptech"],"companySizeRanges":["10-50","51-200"],"signals":["IoT","smart building","tenant portal","automation"],"minConnections":50}'),
  ('EdTech Founders', 'Non-technical founders building education technology',
    (SELECT id FROM niche_profiles WHERE name='EdTech Startups'),
    '{"roles":["CEO","Founder","COO","Head of Product"],"industries":["education","edtech","e-learning"],"companySizeRanges":["10-50","51-200"],"signals":["adaptive learning","AI tutoring","fundraising","FERPA","accessibility"],"minConnections":50}'),
  ('Content Platform Leaders', 'Leaders at streaming and content platforms',
    (SELECT id FROM niche_profiles WHERE name='Streaming & Content Platforms'),
    '{"roles":["CEO","Founder","COO","VP Engineering","CTO"],"industries":["media","streaming","content","publishing"],"companySizeRanges":["10-50","51-200"],"signals":["CDN","DRM","transcoding","recommendation","scaling"],"minConnections":50}'),
  ('Agency Owners Scaling', 'Agency owners transitioning from services to product',
    (SELECT id FROM niche_profiles WHERE name='Digital Agencies Scaling'),
    '{"roles":["CEO","Founder","Managing Director","Partner","Owner"],"industries":["digital agency","marketing agency","web development","creative agency"],"companySizeRanges":["10-50","51-200"],"signals":["productization","white-label","scaling","recurring revenue","SaaS"],"minConnections":50}'),
  ('Manufacturing Tech Leaders', 'Leaders digitizing manufacturing and supply chain',
    (SELECT id FROM niche_profiles WHERE name='Smart Manufacturing & IIoT'),
    '{"roles":["CEO","COO","VP Operations","Director of IT","Plant Manager"],"industries":["manufacturing","industrial","supply chain"],"companySizeRanges":["51-200","201-500"],"signals":["digital twin","predictive maintenance","IIoT","edge computing","automation"],"minConnections":50}'),
  ('Nonprofit Tech Leaders', 'Executive directors modernizing nonprofit technology',
    (SELECT id FROM niche_profiles WHERE name='Nonprofit Tech Modernization'),
    '{"roles":["Executive Director","CEO","COO","Director of Technology","CTO"],"industries":["nonprofit","social impact","philanthropy"],"companySizeRanges":["10-50","51-200"],"signals":["CRM migration","Salesforce","digital transformation","grant management"],"minConnections":30}');
