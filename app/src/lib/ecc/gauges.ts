// ECC Intelligence Gauges — compute DCTE, DTSE, RSTE, EMOT, SCEN from existing data

import { query } from "../db/client";

// --- DCTE: Data Completeness & Trust Evaluation ---
export interface DCTEScore {
  overall: number;
  segments: {
    identity: number;
    contact: number;
    context: number;
    enrichment: number;
    scoring: number;
    network: number;
  };
  missingFields: string[];
  suggestion: string;
}

// --- DTSE: Decision & Task Strategy Engine ---
export interface DTSEStatus {
  activeGoals: Array<{ id: string; title: string; progress: number }>;
  pendingTasks: Array<{
    id: string;
    title: string;
    taskType: string;
    priority: number;
  }>;
  completedTasks: number;
  beliefs: {
    likelyBuyer: boolean;
    warmLead: boolean;
    hubConnector: boolean;
    referralSource: boolean;
  };
  nextBestAction: string;
}

// --- RSTE: Relationship Strength & Trust Evaluation ---
export interface RSTEScore {
  overall: number;
  components: {
    connectionAge: number;
    messageFrequency: number;
    messageRecency: number;
    endorsementsMutual: number;
    recommendations: number;
    sharedConnections: number;
    interactionDepth: number;
  };
  status: "strong" | "warm" | "cooling" | "dormant" | "new" | "unknown";
  trend: "improving" | "stable" | "declining";
}

// --- EMOT: Interest Gauge ---
export interface EMOTScore {
  temperature: number;
  signals: {
    profileActivity: number;
    contentEngagement: number;
    responseRate: number;
    connectionAcceptance: number;
    endorsementGiven: number;
    contentAlignment: number;
  };
  label: "hot" | "warm" | "lukewarm" | "cold" | "unknown";
}

// --- SCEN: Scenario Completeness ---
export interface SCENScore {
  confidence: number;
  grade: "A" | "B" | "C" | "D" | "F";
  factors: {
    dataPoints: number;
    scoringDimensions: number;
    enrichmentSources: number;
    edgeCount: number;
    embeddingExists: boolean;
    recentActivity: boolean;
  };
  gaps: string[];
  recommendation: string;
}

export interface AllGauges {
  dcte: DCTEScore;
  dtse: DTSEStatus;
  rste: RSTEScore;
  emot: EMOTScore;
  scen: SCENScore;
}

export interface GaugeResults {
  data: Partial<AllGauges>;
  errors: Array<keyof AllGauges>;
}

export async function computeAllGauges(contactId: string): Promise<GaugeResults> {
  const results = await Promise.allSettled([
    computeDCTE(contactId),
    computeDTSE(contactId),
    computeRSTE(contactId),
    computeEMOT(contactId),
    computeSCEN(contactId),
  ]);
  const keys: Array<keyof AllGauges> = ["dcte", "dtse", "rste", "emot", "scen"];
  const data: Partial<AllGauges> = {};
  const errors: Array<keyof AllGauges> = [];
  results.forEach((result, index) => {
    const key = keys[index];
    if (result.status === "fulfilled") {
      Object.assign(data, { [key]: result.value });
    } else {
      errors.push(key);
    }
  });
  return { data, errors };
}

// ----- DCTE computation -----
async function computeDCTE(contactId: string): Promise<DCTEScore> {
  const res = await query<{
    full_name: string | null;
    headline: string | null;
    title: string | null;
    current_company: string | null;
    email: string | null;
    phone: string | null;
    linkedin_url: string | null;
    about: string | null;
    location: string | null;
    tags: string[] | null;
    composite_score: number | null;
    connections_count: number | null;
  }>(
    `SELECT c.full_name, c.headline, c.title, c.current_company, c.email, c.phone,
            c.linkedin_url, c.about, c.location, c.tags, cs.composite_score, c.connections_count
     FROM contacts c LEFT JOIN contact_scores cs ON cs.contact_id = c.id
     WHERE c.id = $1`,
    [contactId]
  );
  if (res.rows.length === 0) {
    return {
      overall: 0,
      segments: {
        identity: 0,
        contact: 0,
        context: 0,
        enrichment: 0,
        scoring: 0,
        network: 0,
      },
      missingFields: ["Contact not found"],
      suggestion: "Contact not found",
    };
  }
  const c = res.rows[0];

  const missing: string[] = [];
  const has = (v: unknown): boolean => {
    if (v === null || v === undefined) return false;
    if (typeof v === "string" && v.trim() === "") return false;
    if (Array.isArray(v) && v.length === 0) return false;
    return true;
  };

  // Identity segment (weight 0.25)
  const idFields = [
    { key: "full_name", val: c.full_name },
    { key: "headline", val: c.headline },
    { key: "title", val: c.title },
    { key: "current_company", val: c.current_company },
  ];
  const idFilled = idFields.filter((f) => has(f.val)).length;
  idFields.filter((f) => !has(f.val)).forEach((f) => missing.push(f.key));
  const identity = idFilled / idFields.length;

  // Contact segment (weight 0.15)
  const contactFields = [
    { key: "email", val: c.email },
    { key: "phone", val: c.phone },
    { key: "linkedin_url", val: c.linkedin_url },
  ];
  const contactFilled = contactFields.filter((f) => has(f.val)).length;
  contactFields
    .filter((f) => !has(f.val))
    .forEach((f) => missing.push(f.key));
  const contactSeg = contactFilled / contactFields.length;

  // Context segment (weight 0.20)
  const ctxFields = [
    { key: "about", val: c.about },
    { key: "location", val: c.location },
    { key: "tags", val: c.tags },
  ];
  const ctxFilled = ctxFields.filter((f) => has(f.val)).length;
  ctxFields.filter((f) => !has(f.val)).forEach((f) => missing.push(f.key));
  const context = ctxFilled / ctxFields.length;

  // Enrichment segment (weight 0.15) — check company industry + enrichment history count
  const enrichRes = await query<{ cnt: string }>(
    `SELECT COUNT(*)::text as cnt FROM person_enrichments WHERE contact_id = $1`,
    [contactId]
  );
  const enrichCount = parseInt(enrichRes.rows[0]?.cnt || "0", 10);

  const companyRes = await query<{ industry: string | null }>(
    `SELECT co.industry FROM contacts c JOIN companies co ON c.current_company_id = co.id WHERE c.id = $1`,
    [contactId]
  );
  const hasIndustry = has(companyRes.rows[0]?.industry);
  if (!hasIndustry) missing.push("company_industry");
  const enrichment =
    (enrichCount > 0 ? 0.5 : 0) + (hasIndustry ? 0.5 : 0);

  // Scoring segment (weight 0.15)
  const scoring = has(c.composite_score) ? 1.0 : 0.0;
  if (!has(c.composite_score)) missing.push("composite_score");

  // Network segment (weight 0.10)
  const edgeRes = await query<{ cnt: string }>(
    `SELECT COUNT(*)::text as cnt FROM edges WHERE source_contact_id = $1 OR target_contact_id = $1`,
    [contactId]
  );
  const edgeCount = parseInt(edgeRes.rows[0]?.cnt || "0", 10);
  const network = Math.min(edgeCount / 5, 1.0); // 5+ edges = full score

  const overall =
    identity * 0.25 +
    contactSeg * 0.15 +
    context * 0.2 +
    enrichment * 0.15 +
    scoring * 0.15 +
    network * 0.1;

  const suggestions = [];
  if (!has(c.email)) suggestions.push("Enrich to get email address");
  if (!has(c.about)) suggestions.push("Enrich to get bio/about text");
  if (!hasIndustry) suggestions.push("Enrich company data for industry");
  if (!has(c.composite_score)) suggestions.push("Run scoring pipeline");

  return {
    overall,
    segments: {
      identity,
      contact: contactSeg,
      context,
      enrichment,
      scoring,
      network,
    },
    missingFields: missing.slice(0, 5),
    suggestion: suggestions[0] || "Profile data looks good",
  };
}

// ----- DTSE computation -----
async function computeDTSE(contactId: string): Promise<DTSEStatus> {
  // Goals linked through tasks
  const goalsRes = await query<{
    id: string;
    title: string;
    target_value: number;
    current_value: number;
  }>(
    `SELECT DISTINCT g.id, g.title, g.target_value, g.current_value
     FROM goals g
     JOIN tasks t ON t.goal_id = g.id
     WHERE t.contact_id = $1 AND g.status IN ('active','in_progress')
     LIMIT 10`,
    [contactId]
  );

  const pendingRes = await query<{
    id: string;
    title: string;
    task_type: string;
    priority: number;
  }>(
    `SELECT id, title, task_type, priority
     FROM tasks WHERE contact_id = $1 AND status IN ('pending','in_progress')
     ORDER BY priority DESC LIMIT 10`,
    [contactId]
  );

  const completedRes = await query<{ cnt: string }>(
    `SELECT COUNT(*)::text as cnt FROM tasks WHERE contact_id = $1 AND status = 'completed'`,
    [contactId]
  );

  // Persona/beliefs from scoring
  const personaRes = await query<{
    persona: string | null;
    referral_persona: string | null;
  }>(
    `SELECT persona, referral_persona FROM contact_scores WHERE contact_id = $1 ORDER BY scored_at DESC LIMIT 1`,
    [contactId]
  );

  const p = personaRes.rows[0];

  const activeGoals = goalsRes.rows.map((g) => ({
    id: g.id,
    title: g.title,
    progress: g.target_value > 0 ? g.current_value / g.target_value : 0,
  }));

  const pendingTasks = pendingRes.rows.map((t) => ({
    id: t.id,
    title: t.title,
    taskType: t.task_type,
    priority: t.priority,
  }));

  const beliefs = {
    likelyBuyer: p?.persona === "buyer",
    warmLead: p?.persona === "warm-lead",
    hubConnector: p?.persona === "hub",
    referralSource: !!p?.referral_persona,
  };

  let nextBestAction = "No pending actions";
  if (pendingTasks.length > 0) {
    nextBestAction = pendingTasks[0].title;
  } else if (beliefs.warmLead) {
    nextBestAction = "Send an introductory message";
  } else if (beliefs.hubConnector) {
    nextBestAction = "Explore their network connections";
  }

  return {
    activeGoals,
    pendingTasks,
    completedTasks: parseInt(completedRes.rows[0]?.cnt || "0", 10),
    beliefs,
    nextBestAction,
  };
}

// ----- RSTE computation -----
async function computeRSTE(contactId: string): Promise<RSTEScore> {
  // Edge data
  const edgeRes = await query<{
    edge_type: string;
    weight: number;
    properties: Record<string, unknown>;
    created_at: Date;
  }>(
    `SELECT edge_type, weight, properties, created_at
     FROM edges WHERE source_contact_id = $1 OR target_contact_id = $1`,
    [contactId]
  );

  const edges = edgeRes.rows;
  const edgeCount = edges.length;

  // Connection age
  const connectedEdge = edges.find((e) => e.edge_type === "CONNECTED_TO");
  const connectedDaysAgo = connectedEdge
    ? Math.floor(
        (Date.now() - new Date(connectedEdge.created_at).getTime()) /
          (1000 * 60 * 60 * 24)
      )
    : 0;
  const connectionAge = Math.min(connectedDaysAgo / 365, 1.0);

  // Message stats
  const messageEdges = edges.filter((e) => e.edge_type === "MESSAGED");
  const messageCount = messageEdges.length;
  const messageFrequency = Math.min(messageCount / 10, 1.0);

  const lastMessageDate = messageEdges.reduce((latest, e) => {
    const d = new Date(e.created_at);
    return d > latest ? d : latest;
  }, new Date(0));
  const daysSinceMessage =
    messageCount > 0
      ? Math.floor(
          (Date.now() - lastMessageDate.getTime()) / (1000 * 60 * 60 * 24)
        )
      : 999;
  const messageRecency =
    daysSinceMessage < 999 ? Math.max(0, 1.0 - daysSinceMessage / 180) : 0;

  // Endorsements and recommendations
  const endorsementEdges = edges.filter(
    (e) =>
      e.edge_type === "ENDORSED" || e.edge_type === "endorsed"
  );
  const recommendationEdges = edges.filter(
    (e) =>
      e.edge_type === "RECOMMENDED" || e.edge_type === "recommended"
  );
  const endorsementsMutual = Math.min(endorsementEdges.length / 3, 1.0);
  const recommendations = Math.min(recommendationEdges.length, 1.0);

  // Shared connections — rough proxy from edge count
  const sharedConnections = Math.min(edgeCount / 20, 1.0);

  const interactionDepth = Math.min(
    (messageCount + endorsementEdges.length + recommendationEdges.length) / 15,
    1.0
  );

  // Weighted overall
  const overall =
    connectionAge * 0.1 +
    messageFrequency * 0.25 +
    messageRecency * 0.2 +
    endorsementsMutual * 0.1 +
    recommendations * 0.1 +
    sharedConnections * 0.1 +
    interactionDepth * 0.15;

  const normalizedOverall = Math.min(overall * 100, 100);

  let status: RSTEScore["status"];
  if (normalizedOverall >= 70) status = "strong";
  else if (normalizedOverall >= 45) status = "warm";
  else if (normalizedOverall >= 20) status = "cooling";
  else if (edgeCount > 0) status = "dormant";
  else if (connectedDaysAgo < 7 && connectedDaysAgo > 0) status = "new";
  else status = "unknown";

  const trend: RSTEScore["trend"] =
    messageRecency > 0.5 ? "improving" : messageRecency > 0.1 ? "stable" : "declining";

  return {
    overall: normalizedOverall,
    components: {
      connectionAge,
      messageFrequency,
      messageRecency,
      endorsementsMutual,
      recommendations,
      sharedConnections,
      interactionDepth,
    },
    status,
    trend,
  };
}

// ----- EMOT computation -----
async function computeEMOT(contactId: string): Promise<EMOTScore> {
  // Behavioral observations
  const obsRes = await query<{ cnt: string }>(
    `SELECT COUNT(*)::text as cnt FROM behavioral_observations WHERE contact_id = $1`,
    [contactId]
  );
  const obsCount = parseInt(obsRes.rows[0]?.cnt || "0", 10);

  // Edge signals
  const edgeRes = await query<{ edge_type: string }>(
    `SELECT edge_type FROM edges WHERE (source_contact_id = $1 OR target_contact_id = $1)`,
    [contactId]
  );
  const edges = edgeRes.rows;

  const hasAccepted = edges.some(
    (e) => e.edge_type === "CONNECTED_TO" || e.edge_type === "INVITED_BY"
  );
  const hasEndorsed = edges.some(
    (e) =>
      e.edge_type === "ENDORSED" ||
      e.edge_type === "endorsed"
  );
  const hasMessaged = edges.some((e) => e.edge_type === "MESSAGED");

  // Posting and engagement from scoring data
  const scoreRes = await query<{
    behavioral_signals: Record<string, unknown> | null;
  }>(
    `SELECT behavioral_signals FROM contact_scores WHERE contact_id = $1 ORDER BY scored_at DESC LIMIT 1`,
    [contactId]
  );

  const signals = scoreRes.rows[0]?.behavioral_signals;
  const amplification =
    typeof signals === "object" && signals !== null
      ? ((signals as Record<string, number>).amplification ?? 0)
      : 0;

  const profileActivity = Math.min(obsCount / 10, 1.0);
  const contentEngagement = Math.min(amplification, 1.0);
  const responseRate = hasMessaged ? 0.7 : 0;
  const connectionAcceptance = hasAccepted ? 1.0 : 0;
  const endorsementGiven = hasEndorsed ? 1.0 : 0;
  const contentAlignment = Math.min((obsCount > 0 ? 0.3 : 0) + amplification * 0.5, 1.0);

  const temperature =
    profileActivity * 0.15 +
    contentEngagement * 0.2 +
    responseRate * 0.25 +
    connectionAcceptance * 0.15 +
    endorsementGiven * 0.1 +
    contentAlignment * 0.15;

  const temp100 = Math.min(temperature * 100, 100);

  let label: EMOTScore["label"];
  if (temp100 >= 70) label = "hot";
  else if (temp100 >= 45) label = "warm";
  else if (temp100 >= 20) label = "lukewarm";
  else if (edges.length > 0) label = "cold";
  else label = "unknown";

  return {
    temperature: temp100,
    signals: {
      profileActivity,
      contentEngagement,
      responseRate,
      connectionAcceptance,
      endorsementGiven,
      contentAlignment,
    },
    label,
  };
}

// ----- SCEN computation -----
async function computeSCEN(contactId: string): Promise<SCENScore> {
  // Count non-null fields
  const fieldRes = await query<{
    full_name: string | null;
    headline: string | null;
    title: string | null;
    current_company: string | null;
    email: string | null;
    phone: string | null;
    about: string | null;
    location: string | null;
    tags: string[] | null;
    linkedin_url: string | null;
    composite_score: number | null;
    connections_count: number | null;
  }>(
    `SELECT c.full_name, c.headline, c.title, c.current_company, c.email, c.phone,
            c.about, c.location, c.tags, c.linkedin_url, cs.composite_score, c.connections_count
     FROM contacts c LEFT JOIN contact_scores cs ON cs.contact_id = c.id
     WHERE c.id = $1`,
    [contactId]
  );
  if (fieldRes.rows.length === 0) {
    return {
      confidence: 0,
      grade: "F",
      factors: {
        dataPoints: 0,
        scoringDimensions: 0,
        enrichmentSources: 0,
        edgeCount: 0,
        embeddingExists: false,
        recentActivity: false,
      },
      gaps: ["Contact not found"],
      recommendation: "Contact not found",
    };
  }
  const c = fieldRes.rows[0];
  const fields = Object.values(c);
  const dataPoints = fields.filter((v) => {
    if (v === null || v === undefined) return false;
    if (typeof v === "string" && v.trim() === "") return false;
    if (Array.isArray(v) && v.length === 0) return false;
    return true;
  }).length;

  // Scoring dimensions
  const dimRes = await query<{ cnt: string }>(
    `SELECT COUNT(*)::text as cnt FROM score_dimensions sd
     JOIN contact_scores cs ON cs.id = sd.contact_score_id
     WHERE cs.contact_id = $1`,
    [contactId]
  );
  const scoringDimensions = parseInt(dimRes.rows[0]?.cnt || "0", 10);

  // Enrichment sources
  const enrichRes = await query<{ cnt: string }>(
    `SELECT COUNT(DISTINCT provider)::text as cnt FROM person_enrichments WHERE contact_id = $1`,
    [contactId]
  );
  const enrichmentSources = parseInt(enrichRes.rows[0]?.cnt || "0", 10);

  // Edge count
  const edgeRes = await query<{ cnt: string }>(
    `SELECT COUNT(*)::text as cnt FROM edges WHERE source_contact_id = $1 OR target_contact_id = $1`,
    [contactId]
  );
  const edgeCount = parseInt(edgeRes.rows[0]?.cnt || "0", 10);

  // Embedding exists
  const embRes = await query<{ cnt: string }>(
    `SELECT COUNT(*)::text as cnt FROM profile_embeddings WHERE contact_id = $1`,
    [contactId]
  );
  const embeddingExists = parseInt(embRes.rows[0]?.cnt || "0", 10) > 0;

  // Recent activity (any edge or observation in 30 days)
  const actRes = await query<{ cnt: string }>(
    `SELECT COUNT(*)::text as cnt FROM edges
     WHERE (source_contact_id = $1 OR target_contact_id = $1)
     AND created_at > NOW() - INTERVAL '30 days'`,
    [contactId]
  );
  const recentActivity = parseInt(actRes.rows[0]?.cnt || "0", 10) > 0;

  // Confidence calculation
  const maxDataPoints = 12;
  const maxDimensions = 9;

  const confidence =
    (dataPoints / maxDataPoints) * 0.3 +
    (Math.min(scoringDimensions, maxDimensions) / maxDimensions) * 0.25 +
    (Math.min(enrichmentSources, 3) / 3) * 0.15 +
    (Math.min(edgeCount, 10) / 10) * 0.1 +
    (embeddingExists ? 0.1 : 0) +
    (recentActivity ? 0.1 : 0);

  let grade: SCENScore["grade"];
  if (confidence >= 0.85) grade = "A";
  else if (confidence >= 0.65) grade = "B";
  else if (confidence >= 0.45) grade = "C";
  else if (confidence >= 0.25) grade = "D";
  else grade = "F";

  const gaps: string[] = [];
  if (!c.email) gaps.push("No email");
  if (!c.about) gaps.push("No bio/about");
  if (scoringDimensions === 0) gaps.push("Not scored yet");
  if (!embeddingExists) gaps.push("No embedding");
  if (edgeCount === 0) gaps.push("No network edges");
  if (enrichmentSources === 0) gaps.push("Not enriched");

  let recommendation: string;
  if (confidence >= 0.85) recommendation = "Data sufficient for confident outreach";
  else if (enrichmentSources === 0)
    recommendation = "Enrich via PDL to improve confidence";
  else if (scoringDimensions === 0)
    recommendation = "Run scoring pipeline to assess fit";
  else recommendation = "Add more data points to increase confidence";

  return {
    confidence,
    grade,
    factors: {
      dataPoints,
      scoringDimensions,
      enrichmentSources,
      edgeCount,
      embeddingExists,
      recentActivity,
    },
    gaps: gaps.slice(0, 5),
    recommendation,
  };
}
