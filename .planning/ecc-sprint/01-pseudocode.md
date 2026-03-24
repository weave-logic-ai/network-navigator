# ECC Sprint — Pseudocode

**Date**: 2026-03-24
**Covers**: Vertical→Niche→ICP→Offering Taxonomy, CausalGraph, ExoChain, Impulses, CognitiveTick, CrossRefs

---

## 0. Vertical→Niche→ICP→Offering Taxonomy Fix

### Current Problems

1. **Duplicate ICPs**: `/api/icp/discover` auto-saves on every GET with no uniqueness check
2. **Niche is broken**: `niche_profiles.industry` is a flat TEXT field — no hierarchy, no FK
3. **No vertical concept**: ICP criteria has `industries[]` but there's no verticals table
4. **Table name mismatch**: Tenant migrations (021-023) reference `icp_configs`, `niche_configs`, `offering_configs` — tables that don't exist (actual names: `icp_profiles`, `niche_profiles`, `offerings`)
5. **No structural relationship**: ICP, Niche, and Offering are all independent with no FK chain

### Orthogonal Nomenclature

```
Vertical          = Broad industry sector (the market)
  └─ Niche        = Focused problem space within that vertical
       └─ ICP     = Ideal buyer persona within that niche
            └─ Offering = What you sell to that ICP (M:M via icp_offerings)
```

Each level is orthogonal:
- **Vertical** answers "what market?"
- **Niche** answers "what problem in that market?"
- **ICP** answers "who has that problem?"
- **Offering** answers "what do we sell them?"

### Data Structures

```
Vertical {
  id: uuid
  name: text NOT NULL UNIQUE       // 'Healthcare', 'Financial Services', 'SaaS'
  slug: text NOT NULL UNIQUE       // 'healthcare', 'financial-services', 'saas'
  description: text
  metadata: jsonb                  // industry codes, market size, etc.
  created_at: timestamptz
  updated_at: timestamptz
}

NicheProfile {                     // MODIFIED — adds vertical_id, drops industry text
  id: uuid
  vertical_id: uuid FK → verticals  // NEW — replaces flat 'industry' text
  name: text NOT NULL
  description: text
  keywords: text[]
  company_size_range: text
  geo_focus: text[]
  member_count: int
  affordability: int (1-5)
  fitability: int (1-5)
  buildability: int (1-5)
  niche_score: real (computed)
  centroid: ruvector(384)
  metadata: jsonb
  UNIQUE(vertical_id, name)        // NEW — prevent duplicate niches within a vertical
}

IcpProfile {                       // MODIFIED — adds niche_id
  id: uuid
  niche_id: uuid FK → niche_profiles  // NEW — replaces standalone profile
  name: text NOT NULL
  description: text
  is_active: boolean
  criteria: jsonb {                // IcpCriteria — contact matching rules
    roles: string[]
    signals: string[]
    companySizeRanges: string[]
    locations: string[]
    minConnections: number
    // NOTE: industries[] REMOVED — inherited from parent vertical
  }
  weight_overrides: jsonb
  UNIQUE(niche_id, name)           // NEW — prevent duplicate ICPs within a niche
}
```

### ICP Discovery Fix (De-duplication)

```
function discoverIcps(minClusterSize):
  clusters = getContactAttributeClusters()
  results = []

  for each cluster in clusters:
    if cluster.contact_count < minClusterSize: continue
    if no distinguishing characteristics: continue

    suggestedName = buildName(cluster)

    results.push({suggestedName, criteria, contactCount, confidence})

  return results.sortBy(confidence DESC)


// SEPARATE endpoint — discovery no longer auto-saves
function saveDiscoveredIcp(discovery, nicheId):
  // De-duplicate: check if similar ICP already exists in this niche
  existing = findIcpByNicheAndName(nicheId, discovery.suggestedName)
  if existing:
    return {action: 'skipped', existing: existing.id, reason: 'duplicate_name'}

  // Also check criteria overlap — if >80% role overlap, it's a duplicate
  nicheIcps = getIcpsByNiche(nicheId)
  for each icp in nicheIcps:
    overlap = computeCriteriaOverlap(icp.criteria, discovery.criteria)
    if overlap > 0.8:
      return {action: 'skipped', existing: icp.id, reason: 'criteria_overlap', overlap}

  profile = createIcpProfile({
    nicheId,
    name: discovery.suggestedName,
    criteria: discovery.criteria
  })
  return {action: 'created', id: profile.id}
```

### Scoring Pipeline Update

```
function scoreContact(contactId, icpProfileId?):
  // Resolve ICP → Niche → Vertical chain
  if icpProfileId:
    icp = getIcpProfile(icpProfileId)
  else:
    icp = getDefaultActiveIcp()  // first active ICP, or null

  if icp:
    niche = getNiche(icp.niche_id)
    vertical = getVertical(niche.vertical_id)

    // ICP criteria NO LONGER carries industries — derived from vertical
    effectiveCriteria = {
      ...icp.criteria,
      industries: [vertical.name],     // inherited from vertical
      nicheKeywords: niche.keywords,   // bonus signals from niche
    }
  else:
    effectiveCriteria = null

  score = computeCompositeScore(contact, ALL_SCORERS, weights, effectiveCriteria)
  return score
```

---

## 1. CausalGraph — Scoring Provenance

### Data Structures

```
CausalNode {
  id: uuid
  tenant_id: uuid
  entity_type: 'score' | 'dimension' | 'input' | 'weight' | 'enrichment' | 'graph_metric'
  entity_id: string           // e.g., contact_score.id, dimension name
  operation: string           // e.g., 'compute_icp_fit', 'apply_weight', 'aggregate_composite'
  inputs: jsonb               // snapshot of inputs used
  output: jsonb               // snapshot of result produced
  hlc_timestamp: bigint       // hybrid logical clock (monotonic counter + wall clock)
  session_id: uuid?           // optional research session
  created_at: timestamptz
}

CausalEdge {
  id: uuid
  source_node_id: uuid → CausalNode
  target_node_id: uuid → CausalNode
  relation: 'caused' | 'enabled' | 'weighted_by' | 'derived_from' | 'merged_into'
  weight: float              // contribution strength 0.0-1.0
  metadata: jsonb
}
```

### Score with Causal Trace

```
function scoreContactWithProvenance(contactId, profileName?, sessionId?):
  // Phase 0: Create root causal node
  rootNode = createCausalNode('score', contactId, 'score_contact', {contactId, profileName})

  // Phase 1: Score each dimension — each creates a causal node
  for each dimension in [icp_fit, network_hub, relationship_strength, ...9 dims]:
    inputData = gatherDimensionInputs(contactId, dimension)
    inputNode = createCausalNode('input', dimension.name, 'gather_inputs', inputData)

    rawScore = dimension.scorer(inputData)
    dimNode = createCausalNode('dimension', dimension.name, 'compute_' + dimension.name,
                               {inputs: inputData}, {raw: rawScore})

    createCausalEdge(inputNode, dimNode, 'caused', 1.0)

    // Weight application
    weight = getWeight(profileName, dimension.name)
    weightNode = createCausalNode('weight', dimension.name, 'apply_weight',
                                   {raw: rawScore, weight}, {weighted: rawScore * weight})

    createCausalEdge(dimNode, weightNode, 'weighted_by', weight)
    createCausalEdge(weightNode, rootNode, 'merged_into', weight)

  // Phase 2: Composite aggregation
  compositeScore = sumWeightedDimensions(...)
  tier = assignTier(compositeScore)
  persona = assignPersona(dimensionScores)

  updateCausalNode(rootNode, output: {compositeScore, tier, persona})

  // Phase 3: Referral scoring (if Phase 1 complete)
  if hasEnoughData(contactId):
    referralRoot = createCausalNode('score', contactId, 'score_referral', {})
    createCausalEdge(rootNode, referralRoot, 'enabled', 1.0)
    // ...similar pattern for 6 referral components

  return {score, causalGraph: {root: rootNode, nodes, edges}}
```

### Counterfactual Query

```
function counterfactualScore(contactId, modifiedWeights):
  // Retrieve existing causal graph
  originalGraph = getCausalGraph(contactId, latest=true)

  // Re-execute with modified weights (reuse cached input nodes)
  for each weightNode in originalGraph.nodes where type='weight':
    oldWeight = weightNode.inputs.weight
    newWeight = modifiedWeights[weightNode.entity_id] ?? oldWeight
    if newWeight != oldWeight:
      // Create counterfactual branch
      cfNode = createCausalNode('weight', weightNode.entity_id, 'counterfactual_weight',
                                 {raw: weightNode.inputs.raw, weight: newWeight},
                                 {weighted: weightNode.inputs.raw * newWeight})
      createCausalEdge(weightNode, cfNode, 'counterfactual', newWeight)

  newComposite = recomputeComposite(modifiedWeights, originalGraph.inputNodes)

  return {
    original: originalGraph.root.output,
    counterfactual: {compositeScore: newComposite, ...},
    diff: computeDiff(originalGraph.root.output, newComposite)
  }
```

---

## 2. ExoChain — Enrichment Audit Trail

### Data Structure

```
ExoChainEntry {
  id: uuid
  tenant_id: uuid
  chain_id: uuid              // groups entries for one enrichment operation
  sequence: int               // order within chain
  prev_hash: bytea            // BLAKE3 hash of previous entry (null for genesis)
  entry_hash: bytea           // BLAKE3(prev_hash || operation || data || timestamp)
  operation: string           // 'budget_check', 'provider_select', 'field_check', 'enrich_call',
                              // 'enrich_result', 'budget_debit', 'waterfall_complete'
  data: jsonb                 // operation-specific payload
  actor: string               // 'system', 'user:xxx', 'provider:pdl'
  created_at: timestamptz
}
```

### Enrichment with ExoChain

```
function enrichContactWithChain(contactId, targetFields, tenantId):
  chainId = newUUID()
  prevHash = null

  // Entry 1: Budget check
  budget = getBudgetStatus(tenantId)
  prevHash = appendChainEntry(chainId, 0, prevHash, 'budget_check', {
    remaining: budget.remaining,
    utilization: budget.utilization,
    canProceed: budget.remaining > 0
  })

  if not budget.canProceed:
    appendChainEntry(chainId, 1, prevHash, 'waterfall_complete', {reason: 'budget_exhausted'})
    return {result: null, chain: chainId}

  // Entry 2: Determine needed fields
  existingFields = getFilledFields(contactId)
  neededFields = targetFields - existingFields
  prevHash = appendChainEntry(chainId, 1, prevHash, 'field_check', {
    existing: existingFields, needed: neededFields, skipped: targetFields ∩ existingFields
  })

  // Entries 3+: Provider waterfall
  providers = getActiveProviders(tenantId, sortBy: 'priority')
  seq = 2
  allResults = []

  for each provider in providers:
    if neededFields.isEmpty(): break

    canFill = provider.capabilities ∩ neededFields
    if canFill.isEmpty(): continue

    cost = provider.estimateCost()
    prevHash = appendChainEntry(chainId, seq++, prevHash, 'provider_select', {
      provider: provider.name, canFill, cost, budgetAfter: budget.remaining - cost
    })

    if cost > budget.remaining:
      prevHash = appendChainEntry(chainId, seq++, prevHash, 'provider_skip', {
        reason: 'over_budget', provider: provider.name, cost, remaining: budget.remaining
      })
      continue

    result = provider.enrich(contactId)
    prevHash = appendChainEntry(chainId, seq++, prevHash, 'enrich_result', {
      provider: provider.name,
      fieldsReturned: result.filledFields,
      fieldsEmpty: canFill - result.filledFields,
      status: result.status
    })

    prevHash = appendChainEntry(chainId, seq++, prevHash, 'budget_debit', {
      provider: provider.name, cost: result.actualCost, newRemaining: budget.remaining - result.actualCost
    })

    budget.remaining -= result.actualCost
    neededFields -= result.filledFields
    allResults.push(result)

  // Final entry
  appendChainEntry(chainId, seq, prevHash, 'waterfall_complete', {
    totalProviders: allResults.length,
    totalCost: sum(allResults.map(r => r.actualCost)),
    fieldsFilled: targetFields - neededFields,
    fieldsRemaining: neededFields
  })

  return {results: allResults, chainId}


function appendChainEntry(chainId, seq, prevHash, operation, data):
  entryHash = blake3(prevHash || operation || JSON.stringify(data) || now())
  INSERT INTO exo_chain_entries (chain_id, sequence, prev_hash, entry_hash, operation, data)
  return entryHash
```

---

## 3. Impulse System — Decoupled Automation

### Data Structures

```
Impulse {
  id: uuid
  tenant_id: uuid
  impulse_type: string        // 'tier_changed', 'persona_assigned', 'score_computed',
                              // 'enrichment_complete', 'contact_created', 'edge_created'
  source_entity_type: string  // 'contact', 'score', 'enrichment', 'edge'
  source_entity_id: uuid
  payload: jsonb              // type-specific data
  created_at: timestamptz
}

ImpulseHandler {
  id: uuid
  tenant_id: uuid
  impulse_type: string        // which impulse type to listen for
  handler_type: string        // 'task_generator', 'campaign_enroller', 'notification', 'webhook'
  config: jsonb               // handler-specific configuration
  enabled: boolean
  priority: int               // execution order
}

ImpulseAck {
  impulse_id: uuid
  handler_id: uuid
  status: 'success' | 'failed' | 'skipped'
  result: jsonb
  processed_at: timestamptz
}
```

### Impulse Dispatch

```
function emitImpulse(tenantId, type, sourceType, sourceId, payload):
  impulse = INSERT INTO impulses (tenant_id, impulse_type, source_entity_type,
                                   source_entity_id, payload)

  // Async dispatch — does not block caller
  queueImpulseDispatch(impulse.id)
  return impulse


async function dispatchImpulse(impulseId):
  impulse = getImpulse(impulseId)
  handlers = getHandlers(impulse.tenant_id, impulse.impulse_type, enabled=true, orderBy='priority')

  for each handler in handlers:
    try:
      result = executeHandler(handler, impulse)
      INSERT INTO impulse_acks (impulse_id, handler_id, status: 'success', result)
    catch error:
      INSERT INTO impulse_acks (impulse_id, handler_id, status: 'failed', result: {error})


function executeHandler(handler, impulse):
  switch handler.handler_type:
    case 'task_generator':
      return generateTaskFromImpulse(impulse, handler.config)
    case 'campaign_enroller':
      return enrollInCampaign(impulse, handler.config)
    case 'notification':
      return sendNotification(impulse, handler.config)
    case 'webhook':
      return callWebhook(impulse, handler.config)
```

### Integration with Scoring Pipeline

```
// In scoring/pipeline.ts — after score computed:
function scoreContact(contactId):
  score = computeCompositeScore(...)  // existing
  previousScore = getPreviousScore(contactId)

  upsertScore(contactId, score)  // existing

  // NEW: Emit impulses based on state changes
  emitImpulse(tenantId, 'score_computed', 'contact', contactId, {
    composite: score.compositeScore, tier: score.tier, persona: score.persona
  })

  if previousScore and previousScore.tier != score.tier:
    emitImpulse(tenantId, 'tier_changed', 'contact', contactId, {
      from: previousScore.tier, to: score.tier, composite: score.compositeScore
    })

  if previousScore and previousScore.persona != score.persona:
    emitImpulse(tenantId, 'persona_assigned', 'contact', contactId, {
      from: previousScore.persona, to: score.persona
    })

  return score
```

---

## 4. CognitiveTick — Research Session Context

### Data Structures

```
ResearchSession {
  id: uuid
  tenant_id: uuid
  user_id: string
  intent: jsonb               // {goal: string, icp_focus: string[], verticals: string[]}
  context: jsonb              // accumulated evidence, contact list, findings
  status: 'active' | 'paused' | 'completed'
  created_at: timestamptz
  updated_at: timestamptz
}

SessionMessage {
  id: uuid
  session_id: uuid → ResearchSession
  role: 'user' | 'assistant' | 'system'
  content: text
  context_snapshot: jsonb     // what the model saw at this point
  tokens_used: int
  created_at: timestamptz
}
```

### Session-Aware Claude Integration

```
function analyzeWithSession(tenantId, userId, contactId, prompt, sessionId?):
  // Get or create session
  session = sessionId
    ? getSession(sessionId)
    : createSession(tenantId, userId, {goal: 'analyze', contacts: [contactId]})

  // Build context from session history
  recentMessages = getSessionMessages(session.id, limit: 10)
  contactData = getContactWithScoresAndEnrichment(contactId)

  // Construct system prompt with session context
  systemPrompt = buildSystemPrompt({
    intent: session.intent,
    accumulatedContext: session.context,
    contactData,
    recentMessages
  })

  // Record user message
  insertSessionMessage(session.id, 'user', prompt, {contactId, intent: session.intent})

  // Call Claude with full context
  response = callClaude(systemPrompt, recentMessages, prompt)

  // Record assistant response
  insertSessionMessage(session.id, 'assistant', response.content, {tokens: response.usage})

  // Update session context with new findings
  updateSessionContext(session.id, {
    lastContactAnalyzed: contactId,
    findings: extractFindings(response.content),
    intentShift: detectIntentShift(session.intent, prompt)
  })

  return {response: response.content, sessionId: session.id}


function detectIntentShift(currentIntent, newPrompt):
  // Simple keyword-based detection for v1
  // e.g., "now focus on CFOs" → update icp_focus
  // Future: use DSTE-style belief revision
  keywords = extractICPKeywords(newPrompt)
  if keywords.verticals and keywords.verticals != currentIntent.verticals:
    return {type: 'vertical_shift', from: currentIntent.verticals, to: keywords.verticals}
  return null
```

---

## 5. CrossRefs — Typed Entity Relationships

### Data Structure

```
CrossRef {
  id: uuid
  tenant_id: uuid
  edge_id: uuid → edges       // existing edge this annotates
  relation_type: 'co_worker' | 'referrer' | 'shared_company' | 'mutual_connection' |
                 'reported_to' | 'invested_in' | 'co_author' | 'advisor' | 'custom'
  context: jsonb              // {company: 'Acme', period: '2020-2023', role: 'same team'}
  confidence: float           // 0.0-1.0 how sure we are of this relation
  source: string              // 'enrichment:pdl', 'user:manual', 'graph:inference', 'extension:capture'
  source_entity_id: uuid?     // optional link to enrichment/capture that produced this
  bidirectional: boolean      // true if relationship is symmetric
  created_at: timestamptz
  updated_at: timestamptz
}
```

### CrossRef from Enrichment

```
function extractCrossRefs(contactId, enrichmentResult, provider):
  refs = []

  // Work history → co-worker relationships
  for each job in enrichmentResult.workHistory:
    coworkers = findContactsAtCompany(job.companyId, job.startDate, job.endDate)
    for each coworker in coworkers:
      edge = getOrCreateEdge(contactId, coworker.id, 'professional')
      refs.push(createCrossRef(edge.id, 'co_worker', {
        company: job.companyName,
        period: job.startDate + '-' + job.endDate,
        overlapping_roles: [job.title, coworker.titleAtCompany]
      }, confidence: 0.9, source: 'enrichment:' + provider))

  // Mutual connections → mutual_connection relationship
  for each mutual in enrichmentResult.mutualConnections:
    edge = getOrCreateEdge(contactId, mutual.id, 'social')
    refs.push(createCrossRef(edge.id, 'mutual_connection', {
      shared_connections: mutual.count,
      notable: mutual.names
    }, confidence: 0.95, source: 'enrichment:' + provider))

  return refs
```
