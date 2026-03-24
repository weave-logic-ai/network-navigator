// Local Knowledge Graph Engine
// Extracts entities from contact profiles and builds a co-occurrence graph.
// Uses regex/keyword matching only — no ML models.

import { query } from '../db/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EntityType = 'ROLE' | 'SKILL' | 'INDUSTRY' | 'TECHNOLOGY' | 'COMPANY';

export interface KnowledgeEntity {
  id: string;          // deterministic: `${type}::${normalized label}`
  label: string;
  type: EntityType;
  frequency: number;   // how many contacts have this entity
  contactIds: string[];
}

export interface CoOccurrenceEdge {
  id: string;
  source: string;      // entity id
  target: string;      // entity id
  weight: number;       // number of contacts sharing both entities
}

export interface KnowledgeCluster {
  id: string;
  label: string;
  entityIds: string[];
  type: EntityType;
}

export interface KnowledgeGraph {
  nodes: KnowledgeEntity[];
  edges: CoOccurrenceEdge[];
  clusters: KnowledgeCluster[];
}

// ---------------------------------------------------------------------------
// Role patterns — regex patterns to detect roles from title/headline
// ---------------------------------------------------------------------------

const ROLE_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bCEO\b/i, label: 'CEO' },
  { pattern: /\bCTO\b/i, label: 'CTO' },
  { pattern: /\bCFO\b/i, label: 'CFO' },
  { pattern: /\bCOO\b/i, label: 'COO' },
  { pattern: /\bCMO\b/i, label: 'CMO' },
  { pattern: /\bCIO\b/i, label: 'CIO' },
  { pattern: /\bCPO\b/i, label: 'CPO' },
  { pattern: /\bCSO\b/i, label: 'CSO' },
  { pattern: /\bCRO\b/i, label: 'CRO' },
  { pattern: /\b(?:co[- ]?)?founder\b/i, label: 'Founder' },
  { pattern: /\bpartner\b/i, label: 'Partner' },
  { pattern: /\bpresident\b/i, label: 'President' },
  { pattern: /\bmanaging\s+director\b/i, label: 'Managing Director' },
  { pattern: /\bvice\s+president\b|\bVP\b/i, label: 'VP' },
  { pattern: /\bSVP\b|\bsenior\s+vice\s+president\b/i, label: 'SVP' },
  { pattern: /\bEVP\b|\bexecutive\s+vice\s+president\b/i, label: 'EVP' },
  { pattern: /\bdirector\b/i, label: 'Director' },
  { pattern: /\bhead\s+of\b/i, label: 'Head of' },
  { pattern: /\bsenior\s+manager\b/i, label: 'Senior Manager' },
  { pattern: /\bmanager\b/i, label: 'Manager' },
  { pattern: /\blead\b/i, label: 'Lead' },
  { pattern: /\bsenior\s+engineer\b|\bstaff\s+engineer\b|\bprincipal\s+engineer\b/i, label: 'Senior Engineer' },
  { pattern: /\bengineer(?:ing)?\b/i, label: 'Engineer' },
  { pattern: /\bdeveloper\b/i, label: 'Developer' },
  { pattern: /\barchitect\b/i, label: 'Architect' },
  { pattern: /\bdesigner\b/i, label: 'Designer' },
  { pattern: /\banalyst\b/i, label: 'Analyst' },
  { pattern: /\bconsultant\b/i, label: 'Consultant' },
  { pattern: /\bscientist\b/i, label: 'Scientist' },
  { pattern: /\bresearcher\b/i, label: 'Researcher' },
  { pattern: /\bsales\b/i, label: 'Sales' },
  { pattern: /\baccount\s+(?:executive|manager)\b/i, label: 'Account Executive' },
  { pattern: /\bmarketing\b/i, label: 'Marketing' },
  { pattern: /\bgrowth\b/i, label: 'Growth' },
  { pattern: /\bproduct\s+manager\b|\bPM\b/i, label: 'Product Manager' },
  { pattern: /\bproject\s+manager\b/i, label: 'Project Manager' },
  { pattern: /\binvestor\b/i, label: 'Investor' },
  { pattern: /\badvisor\b|\badviser\b/i, label: 'Advisor' },
  { pattern: /\brecruiter\b|\btalent\b/i, label: 'Recruiter' },
];

// ---------------------------------------------------------------------------
// Technology patterns — recognizable tech from skills/headline/about
// ---------------------------------------------------------------------------

const TECH_KEYWORDS = new Set([
  'javascript', 'typescript', 'python', 'java', 'go', 'golang', 'rust', 'c++',
  'c#', 'ruby', 'php', 'swift', 'kotlin', 'scala', 'r', 'sql', 'nosql',
  'react', 'angular', 'vue', 'svelte', 'next.js', 'nextjs', 'node.js', 'nodejs',
  'express', 'django', 'flask', 'spring', 'rails', 'laravel', '.net', 'dotnet',
  'aws', 'azure', 'gcp', 'google cloud', 'docker', 'kubernetes', 'k8s',
  'terraform', 'ansible', 'jenkins', 'ci/cd', 'github actions',
  'machine learning', 'ml', 'deep learning', 'ai', 'artificial intelligence',
  'nlp', 'computer vision', 'data science', 'big data', 'data engineering',
  'blockchain', 'web3', 'solidity', 'ethereum',
  'postgresql', 'mysql', 'mongodb', 'redis', 'elasticsearch', 'kafka',
  'graphql', 'rest api', 'microservices', 'serverless', 'saas', 'paas',
  'figma', 'sketch', 'adobe', 'photoshop',
  'salesforce', 'hubspot', 'sap', 'oracle', 'snowflake', 'databricks',
  'linux', 'devops', 'sre', 'cybersecurity', 'infosec', 'iot',
  'agile', 'scrum', 'product management',
]);

// ---------------------------------------------------------------------------
// Industry patterns — keywords that suggest an industry
// ---------------------------------------------------------------------------

const INDUSTRY_KEYWORDS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bfintech\b|\bfinancial\s+(?:services|technology)\b/i, label: 'Fintech' },
  { pattern: /\bhealthcare\b|\bhealth\s+tech\b|\bhealthtech\b/i, label: 'Healthcare' },
  { pattern: /\bedtech\b|\beducation\b/i, label: 'Education' },
  { pattern: /\be[- ]?commerce\b|\bretail\b/i, label: 'E-Commerce / Retail' },
  { pattern: /\breal\s+estate\b|\bproptech\b/i, label: 'Real Estate' },
  { pattern: /\bcyber\s*security\b|\binfosec\b/i, label: 'Cybersecurity' },
  { pattern: /\bclean\s*tech\b|\bclimate\b|\bsustainab/i, label: 'CleanTech' },
  { pattern: /\blogistics\b|\bsupply\s+chain\b/i, label: 'Logistics' },
  { pattern: /\bmedia\b|\bentertainment\b/i, label: 'Media & Entertainment' },
  { pattern: /\binsurtech\b|\binsurance\b/i, label: 'Insurance' },
  { pattern: /\blegaltech\b|\blegal\b/i, label: 'LegalTech' },
  { pattern: /\bhrtech\b|\bhuman\s+resources\b/i, label: 'HR Tech' },
  { pattern: /\bmartech\b|\bad\s*tech\b/i, label: 'MarTech / AdTech' },
  { pattern: /\bfood\s*tech\b|\bfood\s*&\s*beverage\b/i, label: 'FoodTech' },
  { pattern: /\btelecom\b|\btelecommunications\b/i, label: 'Telecommunications' },
  { pattern: /\bautomotive\b|\bmobility\b/i, label: 'Automotive' },
  { pattern: /\baerospace\b|\bdefense\b/i, label: 'Aerospace & Defense' },
  { pattern: /\bconsulting\b|\bprofessional\s+services\b/i, label: 'Consulting' },
  { pattern: /\bbanking\b|\bbank\b/i, label: 'Banking' },
  { pattern: /\bpharmaceutical\b|\bpharma\b|\bbiotech\b/i, label: 'Pharma / Biotech' },
  { pattern: /\bmanufacturing\b/i, label: 'Manufacturing' },
  { pattern: /\benergy\b|\boil\s*&?\s*gas\b/i, label: 'Energy' },
  { pattern: /\bsoftware\b|\bSaaS\b/i, label: 'Software / SaaS' },
];

// ---------------------------------------------------------------------------
// Contact row from DB
// ---------------------------------------------------------------------------

interface ContactProfileRow {
  id: string;
  title: string | null;
  headline: string | null;
  about: string | null;
  tags: string[] | null;
  current_company: string | null;
  company_industry: string | null;
}

// ---------------------------------------------------------------------------
// Entity ID helper
// ---------------------------------------------------------------------------

function entityId(type: EntityType, label: string): string {
  return `${type}::${label.toLowerCase().trim()}`;
}

// ---------------------------------------------------------------------------
// Extract entities for a single contact
// ---------------------------------------------------------------------------

function extractEntities(contact: ContactProfileRow): Array<{ type: EntityType; label: string }> {
  const entities: Array<{ type: EntityType; label: string }> = [];
  const seen = new Set<string>();

  const addEntity = (type: EntityType, label: string) => {
    const key = entityId(type, label);
    if (!seen.has(key)) {
      seen.add(key);
      entities.push({ type, label });
    }
  };

  // Combine text sources
  const titleText = contact.title || '';
  const headlineText = contact.headline || '';
  const aboutText = contact.about || '';
  const combinedText = `${titleText} ${headlineText} ${aboutText}`;

  // 1. ROLE entities from title/headline
  for (const { pattern, label } of ROLE_PATTERNS) {
    if (pattern.test(titleText) || pattern.test(headlineText)) {
      addEntity('ROLE', label);
    }
  }

  // 2. SKILL entities from tags array
  if (contact.tags && contact.tags.length > 0) {
    for (const tag of contact.tags) {
      const normalized = tag.trim();
      if (normalized.length > 1) {
        // Determine if this skill is a tech keyword
        const lower = normalized.toLowerCase();
        if (TECH_KEYWORDS.has(lower)) {
          addEntity('TECHNOLOGY', normalized);
        } else {
          addEntity('SKILL', normalized);
        }
      }
    }
  }

  // 3. TECHNOLOGY entities from combined text
  for (const tech of TECH_KEYWORDS) {
    // Escape special regex characters in the tech keyword
    const escaped = tech.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`\\b${escaped}\\b`, 'i');
    if (re.test(combinedText)) {
      addEntity('TECHNOLOGY', tech);
    }
  }

  // 4. INDUSTRY entities from company industry field or headline/about keywords
  if (contact.company_industry) {
    addEntity('INDUSTRY', contact.company_industry);
  }
  for (const { pattern, label } of INDUSTRY_KEYWORDS) {
    if (pattern.test(headlineText) || pattern.test(aboutText)) {
      addEntity('INDUSTRY', label);
    }
  }

  // 5. COMPANY entities from current_company
  if (contact.current_company && contact.current_company.trim().length > 0) {
    addEntity('COMPANY', contact.current_company.trim());
  }

  return entities;
}

// ---------------------------------------------------------------------------
// Build knowledge graph from contacts
// ---------------------------------------------------------------------------

export async function buildKnowledgeGraph(nicheId?: string): Promise<KnowledgeGraph> {
  // Fetch contacts, optionally filtered by niche
  let contactRows: ContactProfileRow[];

  if (nicheId) {
    // Niche contacts: contacts that belong to a niche via niche membership
    // Niche profiles don't have a direct contact membership table,
    // so we match by keywords/industry from the niche profile
    const nicheResult = await query<{
      keywords: string[];
      industry: string | null;
    }>(
      `SELECT keywords, industry FROM niche_profiles WHERE id = $1`,
      [nicheId]
    );

    if (nicheResult.rows.length === 0) {
      return { nodes: [], edges: [], clusters: [] };
    }

    const niche = nicheResult.rows[0];
    const conditions: string[] = ['c.is_archived = FALSE', 'c.degree > 0'];
    const params: unknown[] = [];
    let idx = 1;

    // Match contacts by niche keywords against tags, title, headline
    if (niche.keywords && niche.keywords.length > 0) {
      const keywordConditions: string[] = [];
      for (const keyword of niche.keywords) {
        keywordConditions.push(
          `(c.tags && ARRAY[$${idx}]::text[] OR c.title ILIKE $${idx + 1} OR c.headline ILIKE $${idx + 1})`
        );
        params.push(keyword, `%${keyword}%`);
        idx += 2;
      }
      conditions.push(`(${keywordConditions.join(' OR ')})`);
    }

    if (niche.industry) {
      conditions.push(`co.industry ILIKE $${idx}`);
      params.push(`%${niche.industry}%`);
      idx++;
    }

    const where = conditions.join(' AND ');
    const result = await query<ContactProfileRow>(
      `SELECT c.id, c.title, c.headline, c.about, c.tags,
              c.current_company, co.industry AS company_industry
       FROM contacts c
       LEFT JOIN companies co ON c.current_company_id = co.id
       WHERE ${where}
       LIMIT 2000`,
      params
    );
    contactRows = result.rows;
  } else {
    // All active contacts
    const result = await query<ContactProfileRow>(
      `SELECT c.id, c.title, c.headline, c.about, c.tags,
              c.current_company, co.industry AS company_industry
       FROM contacts c
       LEFT JOIN companies co ON c.current_company_id = co.id
       WHERE c.is_archived = FALSE AND c.degree > 0
       LIMIT 5000`
    );
    contactRows = result.rows;
  }

  if (contactRows.length === 0) {
    return { nodes: [], edges: [], clusters: [] };
  }

  // Step 1: Extract entities per contact
  const entityMap = new Map<string, KnowledgeEntity>();
  const contactEntities = new Map<string, string[]>(); // contactId -> entity ids

  for (const contact of contactRows) {
    const extracted = extractEntities(contact);
    const ids: string[] = [];

    for (const { type, label } of extracted) {
      const eid = entityId(type, label);
      ids.push(eid);

      if (!entityMap.has(eid)) {
        entityMap.set(eid, {
          id: eid,
          label,
          type,
          frequency: 0,
          contactIds: [],
        });
      }
      const entity = entityMap.get(eid)!;
      entity.frequency++;
      entity.contactIds.push(contact.id);
    }

    if (ids.length > 0) {
      contactEntities.set(contact.id, ids);
    }
  }

  // Step 2: Build co-occurrence edges
  const edgeMap = new Map<string, CoOccurrenceEdge>();

  for (const [, entIds] of contactEntities) {
    // For each pair of entities co-occurring in one contact
    for (let i = 0; i < entIds.length; i++) {
      for (let j = i + 1; j < entIds.length; j++) {
        const [a, b] = entIds[i] < entIds[j]
          ? [entIds[i], entIds[j]]
          : [entIds[j], entIds[i]];
        const edgeId = `${a}||${b}`;

        if (!edgeMap.has(edgeId)) {
          edgeMap.set(edgeId, {
            id: edgeId,
            source: a,
            target: b,
            weight: 0,
          });
        }
        edgeMap.get(edgeId)!.weight++;
      }
    }
  }

  // Step 3: Filter low-frequency entities and edges for cleaner graph
  // Keep entities with frequency >= 1 (already done by construction)
  // Keep edges with weight >= 1 (already done by construction)
  const nodes = Array.from(entityMap.values())
    .sort((a, b) => b.frequency - a.frequency);

  const edges = Array.from(edgeMap.values())
    .filter(e => e.weight >= 1)
    .sort((a, b) => b.weight - a.weight);

  // Step 4: Build clusters by entity type
  const clustersByType = new Map<EntityType, string[]>();
  for (const node of nodes) {
    if (!clustersByType.has(node.type)) {
      clustersByType.set(node.type, []);
    }
    clustersByType.get(node.type)!.push(node.id);
  }

  const clusters: KnowledgeCluster[] = [];
  for (const [type, entityIds] of clustersByType) {
    clusters.push({
      id: `cluster::${type}`,
      label: type,
      entityIds,
      type,
    });
  }

  return { nodes, edges, clusters };
}

// ---------------------------------------------------------------------------
// Cache management: store/retrieve snapshots
// ---------------------------------------------------------------------------

export async function getCachedSnapshot(nicheId: string | null): Promise<KnowledgeGraph | null> {
  const result = await query<{
    entities: KnowledgeEntity[];
    edges: CoOccurrenceEdge[];
    clusters: KnowledgeCluster[];
    expires_at: Date;
  }>(
    nicheId
      ? `SELECT entities, edges, clusters, expires_at FROM knowledge_snapshots
         WHERE niche_id = $1 AND source = 'local' AND expires_at > NOW()
         ORDER BY created_at DESC LIMIT 1`
      : `SELECT entities, edges, clusters, expires_at FROM knowledge_snapshots
         WHERE niche_id IS NULL AND source = 'local' AND expires_at > NOW()
         ORDER BY created_at DESC LIMIT 1`,
    nicheId ? [nicheId] : []
  );

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  return {
    nodes: row.entities || [],
    edges: row.edges || [],
    clusters: row.clusters || [],
  };
}

export async function saveSnapshot(
  graph: KnowledgeGraph,
  nicheId: string | null
): Promise<void> {
  await query(
    `INSERT INTO knowledge_snapshots
       (niche_id, source, entities, edges, clusters, entity_count, edge_count, expires_at)
     VALUES ($1, 'local', $2, $3, $4, $5, $6, NOW() + INTERVAL '7 days')`,
    [
      nicheId,
      JSON.stringify(graph.nodes),
      JSON.stringify(graph.edges),
      JSON.stringify(graph.clusters),
      graph.nodes.length,
      graph.edges.length,
    ]
  );
}
