# SPARC Pseudocode: Referral Likelihood Scoring + Criteria-Driven Network Expansion

**Phase**: Pseudocode (P)
**System**: LinkedIn Network Intelligence Pipeline
**Runtime**: Node.js ESM (.mjs), JSON file storage
**Dataset**: N contacts, M edges, K clusters

---

## Table of Contents

1. [Data Structures](#1-data-structures)
2. [Baseline Computation](#2-baseline-computation)
3. [Referral Likelihood Scoring](#3-referral-likelihood-scoring)
4. [Referral Persona Assignment](#4-referral-persona-assignment)
5. [Referral Tier Assignment](#5-referral-tier-assignment)
6. [Criteria-Based Scan List Building](#6-criteria-based-scan-list-building)
7. [Pipeline Dependency Chain](#7-pipeline-dependency-chain)
8. [Complexity Analysis Summary](#8-complexity-analysis-summary)
9. [Edge Cases and Error Handling](#9-edge-cases-and-error-handling)
10. [Parallel Execution Opportunities](#10-parallel-execution-opportunities)

---

## 1. Data Structures

### 1.1 Graph (top-level, persisted as `graph.json`)

```
STRUCTURE: Graph
  contacts:   Map<URL, Contact>       -- keyed by LinkedIn profile URL
  companies:  Map<CompanyKey, Company>
  clusters:   Map<ClusterID, Cluster>  -- 10 keyword-based clusters
  edges:      Array<Edge>              -- M typed edges
  meta:       GraphMeta

STRUCTURE: GraphMeta
  totalContacts:          integer
  lastBuilt:              ISO8601 string
  lastScored:             ISO8601 string or null
  lastBehavioralScored:   ISO8601 string or null
  lastReferralScored:     ISO8601 string or null
  scoringVersion:         integer
  behavioralVersion:      integer
  referralVersion:        integer
  version:                integer
```

### 1.2 Contact

```
STRUCTURE: Contact
  -- Identity
  name:                 string or null
  enrichedName:         string or null
  headline:             string or null
  title:                string or null
  about:                string or null
  currentRole:          string or null
  currentCompany:       string or null
  companyId:            string or null
  enrichedLocation:     string or null
  location:             string or null
  connections:          string or null          -- raw: "500+ connections" / "17,936 followers"
  connectedTime:        string or null          -- raw: "Connected on March 5, 2026"
  mutualConnections:    integer (default 0)
  searchTerms:          Array<string>
  tags:                 Array<string>
  degree:               integer (1 = direct, 2 = discovered)
  deepScanned:          boolean (default false)
  discoveredVia:        Array<URL> or null
  cachedAt:             ISO8601 string or null

  -- Phase 1 Scores (scorer.mjs)
  scores:               ContactScores
  personaType:          string                  -- buyer | advisor | hub | peer | referral-partner
  icpCategories:        Array<string>

  -- Phase 2 Scores (behavioral-scorer.mjs)
  behavioralScore:      float (0-1)
  behavioralPersona:    string                  -- super-connector | content-creator | silent-influencer | rising-connector | passive-network
  behavioralSignals:    BehavioralSignals

  -- Phase 3 Scores (referral-scorer.mjs)
  referralTier:         string or null          -- gold-referral | silver-referral | bronze-referral | null
  referralPersona:      string                  -- white-label-partner | warm-introducer | co-seller | amplifier | passive-referral
  referralSignals:      ReferralSignals

STRUCTURE: ContactScores
  icpFit:                 float (0-1)
  networkHub:             float (0-1)
  relationshipStrength:   float (0-1)
  signalBoost:            float (0-1)
  behavioral:             float (0-1)
  goldScoreV1:            float (0-1)           -- original before behavioral re-weight
  goldScore:              float (0-1)           -- v2 after behavioral re-weight
  referralLikelihood:     float (0-1)
  tier:                   string                -- gold | silver | bronze | watch

STRUCTURE: BehavioralSignals
  connectionCount:        integer
  connectionPower:        float (0-1)
  connectionRecency:      float (0-1)
  connectedDaysAgo:       integer or null
  aboutSignals:           Array<string>         -- matched category names
  headlineSignals:        Array<string>         -- matched pattern names
  superConnectorTraits:   Array<string>
  traitCount:             integer
  amplification:          float (0-1)

STRUCTURE: ReferralSignals
  referralRole:             float (0-1)
  referralRoleMatch:        string or null      -- the pattern that matched
  clientOverlap:            float (0-1)
  clientOverlapIndustries:  Array<string>
  networkReach:             float (0-1)
  networkReachDetail:       { connections: int, clusters: int, edges: int }
  amplificationPower:       float (0-1)
  amplificationSignals:     Array<string>
  relationshipWarmth:       float (0-1)
  buyerInversion:           float (0-1)
```

### 1.3 Edge

```
STRUCTURE: Edge
  source:   URL (string)
  target:   URL (string)
  type:     string        -- same-company | same-cluster | mutual-proximity | discovered-connection | shared-connection
  weight:   float         -- 0.3 to 0.9
```

### 1.4 Cluster

```
STRUCTURE: Cluster
  label:        string
  keywords:     Array<string>
  contacts:     Array<URL>
  hubContacts:  Array<URL>        -- contacts with networkHub >= 0.6
```

### 1.5 Referral Configuration (persisted as `referral-config.json`)

```
STRUCTURE: ReferralConfig
  weights:                  Map<ComponentName, float>   -- 6 weights summing to 1.0
  roleTiers:                Map<TierName, RoleTier>     -- high/medium/low
  targetIndustries:         Array<string>               -- 16 industry keywords
  industrySignals:          IndustrySignals
  referralTiers:            Map<TierName, float>        -- threshold values
  personas:                 Map<PersonaName, PersonaConfig>
  networkReachBaselines:    NetworkReachConfig

STRUCTURE: RoleTier
  score:      float                 -- 1.0 | 0.7 | 0.3
  patterns:   Array<string>         -- lowercase keyword patterns

STRUCTURE: IndustrySignals
  servesTargetClients:  Array<string>   -- 10 service-provider signals
  industryKeywords:     Array<string>   -- 18 industry keywords

STRUCTURE: PersonaConfig
  description:  string
  requires:     Map<string, any>        -- thresholds + optional rolePatterns/behavioralPersonas

STRUCTURE: NetworkReachConfig
  connectionCountNorm:      integer     -- 500
  clusterBreadthWeight:     float       -- 0.4
  edgeDensityWeight:        float       -- 0.3
  connectionCountWeight:    float       -- 0.3
```

### 1.6 Baselines (computed at runtime, not persisted)

```
STRUCTURE: ReferralBaselines
  p90Mutuals:       integer (min 1)       -- 90th percentile of non-zero mutual connection counts
  edgeCounts:       Map<URL, integer>     -- per-contact edge count from edges array
  p90Edges:         integer (min 1)       -- 90th percentile of non-zero edge counts
  contactClusters:  Map<URL, Array<ClusterID>>  -- which clusters each contact belongs to
  activeClusters:   integer               -- count of clusters with > 0 contacts
```

### 1.7 Scan List Entry

```
STRUCTURE: ScanEntry
  url:      string          -- LinkedIn profile URL
  name:     string          -- display name
  reason:   string          -- why this contact was selected for scanning
```

---

## 2. Baseline Computation

```
ALGORITHM: ComputeReferralBaselines
INPUT: graph (Graph)
OUTPUT: baselines (ReferralBaselines)

BEGIN
    urls <- keys(graph.contacts)

    // ------------------------------------------------------------------
    // A. Mutual Connections P90
    // ------------------------------------------------------------------
    allMutuals <- []
    FOR EACH url IN urls DO
        mc <- graph.contacts[url].mutualConnections OR 0
        IF mc > 0 THEN
            allMutuals.append(mc)
        END IF
    END FOR

    sort(allMutuals, ascending)

    IF allMutuals.length > 0 THEN
        idx <- MAX(0, CEIL(0.9 * allMutuals.length) - 1)
        p90Mutuals <- MAX(allMutuals[idx], 1)
    ELSE
        p90Mutuals <- 1       // guard: no contacts have mutual connections
    END IF

    // ------------------------------------------------------------------
    // B. Edge Counts Per Contact
    // ------------------------------------------------------------------
    edgeCounts <- Map()
    FOR EACH url IN urls DO
        edgeCounts[url] <- 0
    END FOR
    FOR EACH edge IN (graph.edges OR []) DO
        edgeCounts[edge.source] <- (edgeCounts[edge.source] OR 0) + 1
        edgeCounts[edge.target] <- (edgeCounts[edge.target] OR 0) + 1
    END FOR

    edgeValues <- values(edgeCounts).filter(e => e > 0).sort(ascending)
    IF edgeValues.length > 0 THEN
        idx <- MAX(0, CEIL(0.9 * edgeValues.length) - 1)
        p90Edges <- MAX(edgeValues[idx], 1)
    ELSE
        p90Edges <- 1         // guard: no edges exist
    END IF

    // ------------------------------------------------------------------
    // C. Cluster Membership Per Contact
    // ------------------------------------------------------------------
    contactClusters <- Map()
    FOR EACH (clusterId, cluster) IN entries(graph.clusters OR {}) DO
        FOR EACH url IN cluster.contacts DO
            IF NOT contactClusters.has(url) THEN
                contactClusters[url] <- []
            END IF
            contactClusters[url].append(clusterId)
        END FOR
    END FOR

    activeClusters <- count(
        keys(graph.clusters OR {}).filter(k => graph.clusters[k].contacts.length > 0)
    )

    RETURN {
        p90Mutuals:      p90Mutuals,
        edgeCounts:      edgeCounts,
        p90Edges:        p90Edges,
        contactClusters: contactClusters,
        activeClusters:  activeClusters,
    }
END
```

### Complexity

| Operation | Time | Space |
|-----------|------|-------|
| Collect mutuals | O(N) | O(N) |
| Sort mutuals | O(N log N) | O(1) in-place |
| Build edge counts | O(E) where E = edge count | O(N) |
| Sort edge values | O(N log N) | O(N) |
| Build cluster membership | O(C * K_avg) where C = clusters, K_avg = avg contacts per cluster | O(N) |
| **Total** | **O(N log N + E)** | **O(N)** |

For the current dataset: N contacts, E edges, so ~O(N * K + E) operations.

---

## 3. Referral Likelihood Scoring

### 3.0 Orchestrator

```
ALGORITHM: ScoreAllReferrals
INPUT: (none -- reads graph.json, referral-config.json, icp-config.json from disk)
OUTPUT: mutates graph.contacts in-place, writes back to graph.json

PRECONDITIONS:
    graph.json exists (graph-builder.mjs completed)
    referral-config.json exists
    icp-config.json exists
    All contacts have behavioralScore defined (behavioral-scorer.mjs completed)

BEGIN
    { graph, config, icp } <- LoadFiles()

    urls <- keys(graph.contacts)
    IF urls.length == 0 THEN
        ERROR("No contacts in graph.json")
        EXIT(1)
    END IF

    // Guard: verify behavioral scoring ran
    firstContact <- graph.contacts[urls[0]]
    IF firstContact.behavioralScore IS undefined THEN
        ERROR("Behavioral scores not found -- run behavioral-scorer.mjs first")
        EXIT(1)
    END IF

    baselines <- ComputeReferralBaselines(graph)
    weights <- config.weights

    FOR EACH url IN urls DO
        contact <- graph.contacts[url]
        contact._url <- url          // temporary reference for baseline lookups

        // Compute 6 components (each returns { score, ...metadata })
        referralRole       <- ScoreReferralRole(contact, config)
        clientOverlap      <- ScoreClientOverlap(contact, config)
        networkReach       <- ScoreNetworkReach(contact, baselines, config)
        amplificationPower <- ScoreAmplificationPower(contact)
        relationshipWarmth <- ScoreRelationshipWarmth(contact, baselines)
        buyerInversion     <- ScoreBuyerInversion(contact)

        // Weighted composite
        referralLikelihood <- ROUND3(
            referralRole.score       * weights.referralRole       +   // 0.25
            clientOverlap.score      * weights.clientOverlap      +   // 0.20
            networkReach.score       * weights.networkReach       +   // 0.20
            amplificationPower.score * weights.amplificationPower +   // 0.15
            relationshipWarmth.score * weights.relationshipWarmth +   // 0.10
            buyerInversion.score     * weights.buyerInversion         // 0.10
        )

        components <- { referralRole, clientOverlap, networkReach,
                        amplificationPower, relationshipWarmth, buyerInversion }

        // Assign persona and tier
        referralPersona <- AssignReferralPersona(contact, components, referralLikelihood, config)
        referralTier    <- AssignReferralTier(referralLikelihood, config.referralTiers)

        // Persist on contact
        contact.scores.referralLikelihood <- referralLikelihood
        contact.referralTier              <- referralTier
        contact.referralPersona           <- referralPersona
        contact.referralSignals           <- BuildReferralSignals(components)

        DELETE contact._url

    END FOR

    graph.meta.lastReferralScored <- NOW()
    graph.meta.referralVersion    <- 1
    WriteJSON(GRAPH_PATH, graph)
END
```

### 3.1 Component 1: Referral Role Score (weight = 0.25)

Identifies contacts whose job function makes them natural referral sources (agencies, partners, consultants, advisors).

```
ALGORITHM: ScoreReferralRole
INPUT: contact (Contact), config (ReferralConfig)
OUTPUT: { score: float, matchedPattern: string or null, tier: string or null }

BEGIN
    text <- LOWERCASE(
        CONCAT(
            contact.headline OR "",
            " ",
            contact.currentRole OR "",
            " ",
            contact.title OR "",
            " ",
            contact.about OR ""
        )
    )

    // Cascade through tiers: high -> medium -> low
    // First match wins (greedy, highest score first)
    FOR EACH tierName IN ["high", "medium", "low"] DO
        tierConfig <- config.roleTiers[tierName]

        FOR EACH pattern IN tierConfig.patterns DO
            IF text CONTAINS pattern THEN
                RETURN {
                    score:          tierConfig.score,   // 1.0 | 0.7 | 0.3
                    matchedPattern: pattern,
                    tier:           tierName,
                }
            END IF
        END FOR
    END FOR

    // No match in any tier
    RETURN { score: 0, matchedPattern: null, tier: null }
END
```

**Pattern counts**: high=18, medium=14, low=10 patterns. Total scan = up to 42 substring checks per contact (early exit on first match).

**Time**: O(T * P) where T = text length, P = total pattern count. Effectively O(1) per contact because both T and P are bounded constants.

### 3.2 Component 2: Client Overlap Score (weight = 0.20)

Measures whether a contact serves the same industries you target, making them a natural referral channel.

```
ALGORITHM: ScoreClientOverlap
INPUT: contact (Contact), config (ReferralConfig)
OUTPUT: { score: float, matchedIndustries: Array<string>, industryMatchCount: int, serviceMatchCount: int }

BEGIN
    text <- LOWERCASE(
        CONCAT(
            contact.headline OR "",
            " ",
            contact.currentRole OR "",
            " ",
            contact.about OR "",
            " ",
            contact.currentCompany OR "",
            " ",
            JOIN(contact.tags OR [], " "),
            " ",
            JOIN(contact.searchTerms OR [], " ")
        )
    )

    // A. Count target industry keyword matches
    targetIndustries <- config.targetIndustries          // 16 keywords
    industryMatches <- 0
    matchedIndustries <- []
    FOR EACH industry IN targetIndustries DO
        IF text CONTAINS industry THEN
            industryMatches <- industryMatches + 1
            matchedIndustries.append(industry)
        END IF
    END FOR

    // B. Count service-provider signal matches
    serviceSignals <- config.industrySignals.servesTargetClients  // 10 keywords
    serviceMatches <- 0
    FOR EACH signal IN serviceSignals DO
        IF text CONTAINS signal THEN
            serviceMatches <- serviceMatches + 1
        END IF
    END FOR

    // C. Combine with 60/40 weighting
    industryScore <- CAP(industryMatches / 3, 1.0)     // 3+ industries -> 1.0
    serviceScore  <- CAP(serviceMatches / 2, 1.0)      // 2+ service signals -> 1.0
    combined      <- industryScore * 0.6 + serviceScore * 0.4

    RETURN {
        score:              ROUND3(CAP(combined, 1.0)),
        matchedIndustries:  matchedIndustries,
        industryMatchCount: industryMatches,
        serviceMatchCount:  serviceMatches,
    }
END
```

**Time**: O(I + S) where I = industry keyword count (16), S = service signal count (10). Constant per contact.

### 3.3 Component 3: Network Reach Score (weight = 0.20)

Measures how broadly a contact can reach across the network -- connection volume, cluster span, and edge density.

```
ALGORITHM: ScoreNetworkReach
INPUT: contact (Contact), baselines (ReferralBaselines), config (ReferralConfig)
OUTPUT: { score: float, connectionCount: int, clusterCount: int, edgeCount: int }

CONSTANTS (from config.networkReachBaselines):
    CONNECTION_COUNT_NORM    = 500
    CONNECTION_COUNT_WEIGHT  = 0.3
    CLUSTER_BREADTH_WEIGHT   = 0.4
    EDGE_DENSITY_WEIGHT      = 0.3

BEGIN
    // A. Connection count (from behavioral parsing of "500+ connections" string)
    connCount <- contact.behavioralSignals?.connectionCount OR 0
    connScore <- CAP(connCount / CONNECTION_COUNT_NORM, 1.0)

    // B. Cluster breadth (how many distinct clusters they belong to)
    clusterCount  <- LENGTH(baselines.contactClusters[contact._url] OR [])
    totalClusters <- MAX(baselines.activeClusters, 1)
    clusterScore  <- CAP(clusterCount / MAX(totalClusters * 0.3, 1), 1.0)
    //
    // Note: denominator is 30% of active clusters, so a contact in 3 of 10
    // clusters scores 3 / 3 = 1.0. This rewards cross-cluster breadth.

    // C. Edge density (how many graph edges connect to this contact)
    edgeCount <- baselines.edgeCounts[contact._url] OR 0
    edgeScore <- CAP(edgeCount / MAX(baselines.p90Edges, 1), 1.0)

    // D. Weighted combination
    score <- connScore    * CONNECTION_COUNT_WEIGHT +    // 0.3
             clusterScore * CLUSTER_BREADTH_WEIGHT  +    // 0.4
             edgeScore    * EDGE_DENSITY_WEIGHT          // 0.3

    RETURN {
        score:           ROUND3(CAP(score, 1.0)),
        connectionCount: connCount,
        clusterCount:    clusterCount,
        edgeCount:       edgeCount,
    }
END
```

**Time**: O(1) per contact (all values are pre-computed in baselines or behavioral signals).

### 3.4 Component 4: Amplification Power Score (weight = 0.15)

Identifies contacts who can amplify your message -- super-connectors, content creators, people with helping language.

```
ALGORITHM: ScoreAmplificationPower
INPUT: contact (Contact)
OUTPUT: { score: float, signals: Array<string> }

CONSTANTS:
    HELPING_WORDS  = ["helping", "connecting", "introducing", "empowering",
                      "enabling", "supporting", "bridging", "matchmaking"]

    CONTENT_WORDS  = ["speaker", "author", "writer", "podcast", "blogger",
                      "content creator", "keynote", "thought leader", "published"]

BEGIN
    score <- 0
    signals <- []
    text <- LOWERCASE(CONCAT(contact.about OR "", " ", contact.headline OR ""))

    // A. Super-connector traits from behavioral scorer
    traitCount <- contact.behavioralSignals?.traitCount OR 0

    IF traitCount >= 3 THEN
        score <- score + 0.4
        signals.append("super-connector-traits")
    ELSE IF traitCount >= 1 THEN
        score <- score + traitCount * 0.12
        signals.append("some-traits")
    END IF

    // B. Helping/connecting language
    helpingCount <- 0
    FOR EACH word IN HELPING_WORDS DO
        IF text CONTAINS word THEN
            helpingCount <- helpingCount + 1
        END IF
    END FOR

    IF helpingCount >= 2 THEN
        score <- score + 0.3
        signals.append("helping-language")
    ELSE IF helpingCount == 1 THEN
        score <- score + 0.15
        signals.append("some-helping")
    END IF

    // C. Content creation signals
    contentCount <- 0
    FOR EACH word IN CONTENT_WORDS DO
        IF text CONTAINS word THEN
            contentCount <- contentCount + 1
        END IF
    END FOR

    IF contentCount >= 1 THEN
        score <- score + 0.3
        signals.append("content-creator")
    END IF

    // Maximum possible score: 0.4 + 0.3 + 0.3 = 1.0
    RETURN { score: ROUND3(CAP(score, 1.0)), signals: signals }
END
```

**Time**: O(H + C) where H = helping word count (8), C = content word count (9). Constant per contact.

### 3.5 Component 5: Relationship Warmth Score (weight = 0.10)

Measures existing relationship closeness -- mutual connections, prior score, and recency of connection.

```
ALGORITHM: ScoreRelationshipWarmth
INPUT: contact (Contact), baselines (ReferralBaselines)
OUTPUT: { score: float, mutuals: int, relStrength: float, recencyScore: float }

BEGIN
    // A. Mutual connections (normalized by P90)
    mutuals <- contact.mutualConnections OR 0
    mutualScore <- CAP(mutuals / MAX(baselines.p90Mutuals, 1), 1.0)

    // B. Existing relationship strength from Phase 1 scorer
    relStrength <- contact.scores?.relationshipStrength OR 0

    // C. Recency from behavioral scorer
    daysAgo <- contact.behavioralSignals?.connectedDaysAgo

    IF daysAgo IS null OR daysAgo IS undefined THEN
        recencyScore <- 0.1       // unknown = low default
    ELSE IF daysAgo <= 90 THEN
        recencyScore <- 1.0       // connected within 3 months
    ELSE IF daysAgo <= 180 THEN
        recencyScore <- 0.7       // 3-6 months
    ELSE IF daysAgo <= 365 THEN
        recencyScore <- 0.4       // 6-12 months
    ELSE
        recencyScore <- 0.2       // older than 1 year
    END IF

    // D. Weighted combination
    score <- mutualScore  * 0.35 +
             relStrength  * 0.35 +
             recencyScore * 0.30

    RETURN {
        score:         ROUND3(CAP(score, 1.0)),
        mutuals:       mutuals,
        relStrength:   ROUND3(relStrength),
        recencyScore:  ROUND3(recencyScore),
    }
END
```

**Time**: O(1) per contact.

### 3.6 Component 6: Buyer Inversion Score (weight = 0.10)

Inverts ICP fit: low-ICP contacts with ecosystem presence are better referrers than buyers. High-ICP contacts score 0 here (they are buyers, not referrers).

```
ALGORITHM: ScoreBuyerInversion
INPUT: contact (Contact)
OUTPUT: { score: float, invertedIcp: float, ecosystemScore: float }

CONSTANTS:
    ECOSYSTEM_KEYWORDS = [
        "ecosystem", "partner", "community", "network", "alliance",
        "integration", "marketplace", "channel", "reseller", "agency",
        "consultancy", "service provider", "implementation"
    ]

BEGIN
    // A. Invert ICP fit
    icpFit <- contact.scores?.icpFit OR 0
    invertedIcp <- CAP(1.0 - icpFit, 1.0)

    // B. Ecosystem presence from text signals
    text <- LOWERCASE(
        CONCAT(
            contact.headline OR "",
            " ",
            contact.about OR "",
            " ",
            JOIN(contact.tags OR [], " ")
        )
    )

    ecosystemCount <- 0
    FOR EACH keyword IN ECOSYSTEM_KEYWORDS DO
        IF text CONTAINS keyword THEN
            ecosystemCount <- ecosystemCount + 1
        END IF
    END FOR
    ecosystemScore <- CAP(ecosystemCount / 3, 1.0)    // 3+ keywords -> 1.0

    // C. Combine: both low-ICP AND ecosystem presence required
    score <- invertedIcp * 0.5 + ecosystemScore * 0.5

    RETURN {
        score:          ROUND3(CAP(score, 1.0)),
        invertedIcp:    ROUND3(invertedIcp),
        ecosystemScore: ROUND3(ecosystemScore),
    }
END
```

**Design note**: A contact with icpFit=0.9 gets invertedIcp=0.1, so even with high ecosystemScore, buyer inversion remains low. This prevents double-counting contacts who are both prospects and referrers.

**Time**: O(K) where K = ecosystem keyword count (13). Constant per contact.

---

## 4. Referral Persona Assignment

Cascading waterfall -- first matching persona wins. This ensures mutually exclusive assignment with priority ordering.

```
ALGORITHM: AssignReferralPersona
INPUT:
    contact (Contact),
    components: {
        referralRole:       { score, matchedPattern, tier },
        clientOverlap:      { score, matchedIndustries, ... },
        networkReach:       { score, ... },
        amplificationPower: { score, signals },
        relationshipWarmth: { score, ... },
        buyerInversion:     { score, ... },
    },
    referralLikelihood (float),
    config (ReferralConfig)
OUTPUT: persona (string)

BEGIN
    text <- LOWERCASE(
        CONCAT(
            contact.headline OR "",
            " ",
            contact.about OR "",
            " ",
            contact.currentRole OR ""
        )
    )

    // -----------------------------------------------------------------
    // Priority 1: White-Label Partner
    // Agency/consultancy that can resell your services to their clients.
    // Requires: matching role pattern AND high referral role AND client overlap.
    // -----------------------------------------------------------------
    wlpConfig <- config.personas["white-label-partner"]
    matchesWlpRole <- ANY(
        pattern IN wlpConfig.requires.rolePatterns
        WHERE text CONTAINS pattern
    )
    IF matchesWlpRole
       AND components.referralRole.score >= wlpConfig.requires.minReferralRole    // >= 0.7
       AND components.clientOverlap.score >= wlpConfig.requires.minClientOverlap  // >= 0.4
    THEN
        RETURN "white-label-partner"
    END IF

    // -----------------------------------------------------------------
    // Priority 2: Warm Introducer
    // Strong relationship + broad network = makes warm intros.
    // -----------------------------------------------------------------
    wiConfig <- config.personas["warm-introducer"]
    IF components.relationshipWarmth.score >= wiConfig.requires.minRelationshipWarmth  // >= 0.5
       AND components.networkReach.score >= wiConfig.requires.minNetworkReach          // >= 0.5
    THEN
        RETURN "warm-introducer"
    END IF

    // -----------------------------------------------------------------
    // Priority 3: Co-Seller
    // Consultant/advisor serving overlapping clients = mutual referrals.
    // -----------------------------------------------------------------
    csConfig <- config.personas["co-seller"]
    matchesCsRole <- ANY(
        pattern IN csConfig.requires.rolePatterns
        WHERE text CONTAINS pattern
    )
    IF matchesCsRole
       AND components.clientOverlap.score >= csConfig.requires.minClientOverlap  // >= 0.5
    THEN
        RETURN "co-seller"
    END IF

    // -----------------------------------------------------------------
    // Priority 4: Amplifier
    // Super-connector or content creator who amplifies your brand.
    // -----------------------------------------------------------------
    ampConfig <- config.personas["amplifier"]
    behavioralPersona <- contact.behavioralPersona OR ""
    IF components.amplificationPower.score >= ampConfig.requires.minAmplificationPower  // >= 0.5
       OR behavioralPersona IN ampConfig.requires.behavioralPersonas   // ["super-connector", "content-creator"]
    THEN
        RETURN "amplifier"
    END IF

    // -----------------------------------------------------------------
    // Priority 5: Default
    // -----------------------------------------------------------------
    RETURN "passive-referral"
END
```

### Persona Assignment Decision Tree

```
                    [Contact]
                       |
              matchesWlpRole AND
          referralRole >= 0.7 AND
          clientOverlap >= 0.4?
                  /        \
               YES          NO
                |            |
     "white-label-partner"   |
                      relWarmth >= 0.5 AND
                      netReach >= 0.5?
                         /        \
                      YES          NO
                       |            |
             "warm-introducer"      |
                            matchesCsRole AND
                            clientOverlap >= 0.5?
                               /        \
                            YES          NO
                             |            |
                       "co-seller"        |
                                   ampPower >= 0.5 OR
                                   behPersona IN [super-connector,
                                                  content-creator]?
                                      /        \
                                   YES          NO
                                    |            |
                              "amplifier"   "passive-referral"
```

**Time**: O(P) per contact where P = max role patterns across all persona configs. Bounded constant.

---

## 5. Referral Tier Assignment

Simple threshold-based tiering after composite score is computed.

```
ALGORITHM: AssignReferralTier
INPUT: referralLikelihood (float), tiers (Map<string, float>)
OUTPUT: tier (string or null)

CONSTANTS (from referral-config.json):
    GOLD_THRESHOLD   = 0.65
    SILVER_THRESHOLD = 0.45
    BRONZE_THRESHOLD = 0.30

BEGIN
    IF referralLikelihood >= tiers["gold-referral"] THEN      // >= 0.65
        RETURN "gold-referral"
    ELSE IF referralLikelihood >= tiers["silver-referral"] THEN  // >= 0.45
        RETURN "silver-referral"
    ELSE IF referralLikelihood >= tiers["bronze-referral"] THEN  // >= 0.30
        RETURN "bronze-referral"
    ELSE
        RETURN null                                             // below 0.30
    END IF
END
```

**Time**: O(1).

---

## 6. Criteria-Based Scan List Building

Builds a prioritized, deduplicated list of contacts to deep-scan based on targeting criteria. Supports four modes: `gold`, `referral`, `hub`, `all`.

```
ALGORITHM: BuildScanList
INPUT: criteria (string: "gold" | "referral" | "hub" | "all"), minScore (float, default 0)
OUTPUT: list (Array<ScanEntry>)

BEGIN
    graph <- ReadJSON(GRAPH_PATH)

    // ------------------------------------------------------------------
    // A. Flatten and project contacts into scannable records
    // ------------------------------------------------------------------
    contacts <- []
    FOR EACH (url, contact) IN entries(graph.contacts) DO
        IF contact.scores IS null THEN
            CONTINUE                // skip unscored contacts
        END IF
        contacts.append({
            url:                url,
            name:               contact.enrichedName OR contact.name,
            goldScore:          contact.scores.goldScore OR 0,
            icpFit:             contact.scores.icpFit OR 0,
            networkHub:         contact.scores.networkHub OR 0,
            relStrength:        contact.scores.relationshipStrength OR 0,
            behavioral:         contact.behavioralScore OR 0,
            referralLikelihood: contact.scores.referralLikelihood OR 0,
            referralTier:       contact.referralTier OR null,
            referralPersona:    contact.referralPersona OR null,
            tier:               contact.scores.tier OR "watch",
            deepScanned:        contact.deepScanned OR false,
        })
    END FOR

    // ------------------------------------------------------------------
    // B. Deduplication and pre-scanned filter
    // ------------------------------------------------------------------
    seen <- Set()
    list <- []

    SUBROUTINE Add(contact, reason):
        IF seen.has(contact.url) THEN RETURN END IF
        IF contact.deepScanned THEN RETURN END IF        // already scanned
        seen.add(contact.url)
        list.append({ url: contact.url, name: contact.name, reason: reason })
    END SUBROUTINE

    // ------------------------------------------------------------------
    // C. Criteria-driven selection
    // ------------------------------------------------------------------

    // C.1 Gold-tier contacts (direct prospects)
    IF criteria == "gold" OR criteria == "all" THEN
        goldContacts <- contacts.filter(c => c.tier == "gold")
        goldContacts.sortByDescending(c => c.goldScore)
        FOR EACH c IN goldContacts DO
            Add(c, "gold")
        END FOR
    END IF

    // C.2 Referral-tier contacts (referral partners)
    IF criteria == "referral" OR criteria == "all" THEN

        // C.2a Gold-referral tier, sorted by referralLikelihood
        goldReferrals <- contacts
            .filter(c => c.referralTier == "gold-referral")
            .filter(c => c.referralLikelihood >= minScore)
            .sortByDescending(c => c.referralLikelihood)
        FOR EACH c IN goldReferrals DO
            Add(c, "gold-referral")
        END FOR

        // C.2b Warm introducers and white-label partners by persona
        warmIntros <- contacts
            .filter(c => c.referralPersona == "warm-introducer"
                      OR c.referralPersona == "white-label-partner")
            .filter(c => c.referralLikelihood >= minScore)
            .sortByDescending(c => c.referralLikelihood)
        FOR EACH c IN warmIntros DO
            Add(c, "referral-" + c.referralPersona)
        END FOR

        // C.2c Top 10 silver-referral tier
        silverReferrals <- contacts
            .filter(c => c.referralTier == "silver-referral")
            .filter(c => c.referralLikelihood >= minScore)
            .sortByDescending(c => c.referralLikelihood)
            .slice(0, 10)
        FOR EACH c IN silverReferrals DO
            Add(c, "silver-referral")
        END FOR
    END IF

    // C.3 Network hubs
    IF criteria == "hub" OR criteria == "all" THEN
        hubs <- contacts.copy()
            .filter(c => c.networkHub >= minScore)
            .sortByDescending(c => c.networkHub)
            .slice(0, 10)
        FOR EACH c IN hubs DO
            Add(c, "top-hub")
        END FOR
    END IF

    // C.4 Broad coverage: top N in each dimension (for "all" mode)
    IF criteria == "all" THEN
        nonGold <- contacts.filter(c => c.tier != "gold")

        // Top 5 by ICP fit
        nonGold.copy().sortByDescending(c => c.icpFit).slice(0, 5)
            .forEach(c => Add(c, "top-icp"))

        // Top 5 by behavioral score
        nonGold.copy().sortByDescending(c => c.behavioral).slice(0, 5)
            .forEach(c => Add(c, "top-behavioral"))

        // Top 5 by relationship strength
        nonGold.copy().sortByDescending(c => c.relStrength).slice(0, 5)
            .forEach(c => Add(c, "top-relationship"))
    END IF

    // C.5 Legacy fallback for "gold" criteria (backward compatibility)
    IF criteria == "gold" THEN
        nonGold <- contacts.filter(c => c.tier != "gold")

        nonGold.copy().sortByDescending(c => c.icpFit).slice(0, 5)
            .forEach(c => Add(c, "top-icp"))

        nonGold.copy().sortByDescending(c => c.networkHub).slice(0, 5)
            .forEach(c => Add(c, "top-hub"))

        nonGold.copy().sortByDescending(c => c.behavioral).slice(0, 5)
            .forEach(c => Add(c, "top-behavioral"))

        nonGold.copy().sortByDescending(c => c.relStrength).slice(0, 5)
            .forEach(c => Add(c, "top-relationship"))
    END IF

    RETURN list
END
```

### Scan List Size Estimates by Criteria

| Criteria | Max Possible Entries | Notes |
|----------|---------------------|-------|
| `gold` | gold_count + 20 | All gold contacts + top 5 each of icp/hub/behavioral/relStrength |
| `referral` | gold_referral + warm/wlp + 10 silver | All gold-referral + personas + capped silver |
| `hub` | 10 | Top 10 by networkHub |
| `all` | gold_count + referral_all + 10 hubs + 15 | Union of all the above with dedup |

### Complexity

| Operation | Time |
|-----------|------|
| Project contacts | O(N) |
| Sort per criteria bucket | O(N log N) per sort, up to ~8 sorts for "all" mode |
| Dedup via Set | O(1) per lookup |
| **Total for "all"** | **O(N log N)** dominated by sorts |

---

## 7. Pipeline Dependency Chain

### 7.1 Execution Order DAG

```
ALGORITHM: ExecutePipeline
INPUT: mode (string)
OUTPUT: success (boolean)

DEPENDENCY GRAPH:

    graph-builder.mjs
          |
          v
      scorer.mjs  (reads graph.json with contact data)
          |
          v
  behavioral-scorer.mjs  (reads graph.json with Phase 1 scores)
          |
          v
  referral-scorer.mjs  (reads graph.json with behavioral scores)
       /      \
      v        v
  analyzer.mjs  report-generator.mjs

INVARIANT: Each step reads graph.json, mutates it, and writes it back.
           Steps are strictly sequential within the main scoring chain.
```

### 7.2 Guard Logic

```
ALGORITHM: PipelineWithGuards
INPUT: steps (Array<{ script, args }>)
OUTPUT: results (Array<{ script, ok, skipped }>)

BEGIN
    graphOk      <- true
    scorerOk     <- true
    behavioralOk <- true

    results <- []

    FOR EACH step IN steps DO
        // Guard: skip scorer if graph-builder failed
        IF step.script == "scorer.mjs" AND NOT graphOk THEN
            results.append({ script: step.script, ok: false, skipped: true })
            scorerOk <- false
            CONTINUE
        END IF

        // Guard: skip behavioral-scorer if scorer failed
        IF step.script == "behavioral-scorer.mjs" AND NOT scorerOk THEN
            results.append({ script: step.script, ok: false, skipped: true })
            behavioralOk <- false
            CONTINUE
        END IF

        // Guard: skip referral-scorer if behavioral-scorer failed
        IF step.script == "referral-scorer.mjs" AND NOT behavioralOk THEN
            results.append({ script: step.script, ok: false, skipped: true })
            CONTINUE
        END IF

        ok <- RunScript(step.script, step.args)
        results.append({ script: step.script, ok: ok, skipped: false })

        // Track failures for downstream guards
        IF step.script == "graph-builder.mjs" AND NOT ok THEN
            graphOk <- false
        END IF
        IF step.script == "scorer.mjs" AND NOT ok THEN
            scorerOk <- false
        END IF
        IF step.script == "behavioral-scorer.mjs" AND NOT ok THEN
            behavioralOk <- false
        END IF
    END FOR

    RETURN results
END
```

### 7.3 Pipeline Modes

```
MODE DEFINITIONS:

    "full":
        search -> enrich -> graph-builder -> scorer -> behavioral-scorer
            -> referral-scorer -> analyzer -> delta(snapshot)

    "rebuild" (default):
        graph-builder -> scorer -> behavioral-scorer
            -> referral-scorer -> analyzer -> delta(snapshot)

    "rescore":
        scorer -> behavioral-scorer -> referral-scorer -> analyzer

    "behavioral":
        behavioral-scorer -> analyzer(behavioral) -> analyzer(visibility)

    "referrals":
        referral-scorer -> analyzer(referrals)

    "report":
        report-generator

    "deep-scan":
        deep-scan(url) -> graph-builder -> scorer -> behavioral-scorer
            -> referral-scorer -> report-generator
```

### 7.4 Batch Deep Scan Orchestration

```
ALGORITHM: BatchDeepScan
INPUT: opts: { criteria, minScore, maxPages, maxResults, delay, dryRun, skip }
OUTPUT: results summary

BEGIN
    scanList <- BuildScanList(opts.criteria, opts.minScore)

    IF scanList.length == 0 THEN
        PRINT "No contacts to scan"
        RETURN
    END IF

    IF opts.dryRun THEN
        PRINT scanList
        RETURN
    END IF

    results <- []

    // Execute scans SEQUENTIALLY (rate-limit constraint)
    FOR i <- opts.skip TO scanList.length - 1 DO
        contact <- scanList[i]

        result <- RunScript("deep-scan.mjs", [
            "--url", contact.url,
            "--max-pages", opts.maxPages,
            "--max-results", opts.maxResults,
        ])

        results.append({ name: contact.name, ok: result.ok })

        // Rate-limit delay between scans (except after last)
        IF i < scanList.length - 1 THEN
            SLEEP(opts.delay)        // default 10 seconds
        END IF
    END FOR

    // Post-scan rebuild (only if at least 1 scan succeeded)
    successCount <- count(results WHERE ok == true)
    IF successCount > 0 THEN
        RunScript("graph-builder.mjs")
        RunScript("scorer.mjs")
        RunScript("behavioral-scorer.mjs")
        RunScript("referral-scorer.mjs")
        RunScript("report-generator.mjs")
    END IF

    RETURN results
END
```

**Time**: O(S * (scan_time + delay)) where S = scan list length. Each deep-scan can take up to 3 minutes (180s timeout) plus the inter-scan delay (default 10s). Post-scan rebuild is O(N log N + E) as analyzed above.

---

## 8. Complexity Analysis Summary

### Per-Contact Scoring (referral-scorer.mjs)

| Component | Time per Contact | Space per Contact |
|-----------|-----------------|-------------------|
| ScoreReferralRole | O(P) = O(42) | O(1) |
| ScoreClientOverlap | O(I + S) = O(26) | O(I) for matched list |
| ScoreNetworkReach | O(1) | O(1) |
| ScoreAmplificationPower | O(H + C) = O(17) | O(1) |
| ScoreRelationshipWarmth | O(1) | O(1) |
| ScoreBuyerInversion | O(K) = O(13) | O(1) |
| AssignReferralPersona | O(P') = O(~20) | O(1) |
| AssignReferralTier | O(1) | O(1) |
| **Total per contact** | **O(1)** (bounded constants) | **O(1)** |

All component algorithms involve iterating over fixed-size keyword lists and performing substring matches against bounded-length text fields. While technically O(T * K) where T = text length and K = keyword count, both are bounded by constants in practice (headline max ~200 chars, about max ~2000 chars, keyword lists max ~42 entries).

### Full Scoring Run

| Phase | Time | Space |
|-------|------|-------|
| Load files (JSON parse) | O(F) where F = file size | O(N + E) |
| ComputeBaselines | O(N log N + E) | O(N) |
| Score all contacts | O(N) (constant per contact) | O(N) for signals |
| Persona/tier assignment | O(N) | O(1) per contact |
| Serialize graph.json | O(N + E) | O(F) |
| **Total** | **O(N log N + E)** | **O(N + E)** |

With N contacts and E edges at current dataset scale, this completes in well under 1 second.

### Scan List Building

| Operation | Time | Space |
|-----------|------|-------|
| Project contacts | O(N) | O(N) for projected array |
| Sort operations (up to 8 for "all") | O(8 * N log N) | O(N) per sort (in-place) |
| Dedup via Set | O(N) | O(N) |
| **Total** | **O(N log N)** | **O(N)** |

### Full Pipeline

| Mode | Time | Bottleneck |
|------|------|------------|
| `--rebuild` | O(N log N + E) * 4 steps | JSON I/O (4 read/write cycles) |
| `--rescore` | O(N log N + E) * 3 steps | JSON I/O |
| `--referrals` | O(N log N + E) | Single pass |
| Batch deep-scan | O(S * 190s) + O(N log N + E) | Network I/O (LinkedIn scraping) |

---

## 9. Edge Cases and Error Handling

### 9.1 Empty or Missing Data

```
EDGE CASES:

1. Zero contacts in graph.json:
   DETECTION: urls.length == 0
   HANDLING:  Print error, exit(1)
   AFFECTS:   All algorithms

2. No contacts have mutual connections (all = 0):
   DETECTION: allMutuals.length == 0 after filtering > 0
   HANDLING:  p90Mutuals defaults to 1 (prevents division by zero)
   AFFECTS:   ComputeBaselines, ScoreNetworkReach, ScoreRelationshipWarmth

3. No edges in graph:
   DETECTION: graph.edges is null/undefined or empty
   HANDLING:  Guard with (graph.edges OR []) in iteration;
              edgeValues will be empty; p90Edges defaults to 1
   AFFECTS:   ComputeBaselines, ScoreNetworkReach

4. Empty clusters (all clusters have 0 members):
   DETECTION: activeClusters == 0
   HANDLING:  activeClusters defaults to 1 in denominator;
              clusterScore will be 0 for all contacts
   AFFECTS:   ScoreNetworkReach

5. Contact missing behavioral scores:
   DETECTION: firstContact.behavioralScore IS undefined
   HANDLING:  Print error, exit(1) -- forces correct pipeline ordering
   AFFECTS:   ScoreAllReferrals (main entry point)

6. Contact missing Phase 1 scores:
   DETECTION: contact.scores IS null/undefined
   HANDLING:  BuildScanList skips unscored contacts with filter
   AFFECTS:   BuildScanList

7. Missing text fields (headline, about, title all null):
   DETECTION: All CONCAT operands resolve to ""
   HANDLING:  text becomes empty string; no patterns match;
              all text-based components score 0
   AFFECTS:   ScoreReferralRole, ScoreClientOverlap, ScoreAmplificationPower,
              ScoreBuyerInversion, AssignReferralPersona

8. All contacts already deep-scanned:
   DETECTION: scanList.length == 0 after filtering
   HANDLING:  Print "No contacts to scan", return gracefully
   AFFECTS:   BuildScanList, BatchDeepScan

9. Missing referral-config.json or icp-config.json:
   DETECTION: existsSync() returns false
   HANDLING:  Print error, exit(1)
   AFFECTS:   LoadFiles

10. Contact has no tags array:
    DETECTION: contact.tags is undefined
    HANDLING:  Default to [] via (contact.tags OR [])
    AFFECTS:   ScoreClientOverlap, ScoreBuyerInversion

11. Pipeline step failure mid-chain:
    DETECTION: RunScript returns ok=false
    HANDLING:  Guard variables (graphOk, scorerOk, behavioralOk) cascade
               to skip dependent steps; skipped steps logged
    AFFECTS:   PipelineWithGuards
```

### 9.2 Numeric Safety

```
INVARIANTS:
    - All scores are clamped to [0, 1] via CAP(value, 1.0)
    - Division denominators guarded with MAX(denominator, 1) to prevent NaN
    - ROUND3 = Math.round(n * 1000) / 1000 prevents floating-point noise
    - Weights verified to sum to 1.0 at configuration level:
        0.25 + 0.20 + 0.20 + 0.15 + 0.10 + 0.10 = 1.00
```

### 9.3 Deduplication Guarantees

```
INVARIANT: BuildScanList produces no duplicate URLs.

MECHANISM:
    - seen: Set<URL> tracks all URLs already added
    - Add() subroutine checks seen.has(url) before appending
    - First criteria match wins (a contact added as "gold" will not
      appear again as "top-icp" even if it qualifies)
    - deepScanned flag prevents re-scanning already-scanned contacts
```

---

## 10. Parallel Execution Opportunities

### 10.1 Within Referral Scoring

```
PARALLELIZABLE: Yes -- all 6 component scores for a single contact are independent.

CURRENT DESIGN: Sequential loop over contacts, sequential component computation.

POTENTIAL OPTIMIZATION:

    // Level 1: Parallelize across contacts (embarrassingly parallel)
    // Each contact's scoring reads shared baselines but writes only to its own record.
    contactBatches <- partition(urls, BATCH_SIZE)
    PARALLEL FOR EACH batch IN contactBatches DO
        FOR EACH url IN batch DO
            ScoreContact(url, baselines, config)
        END FOR
    END FOR

    // Level 2: Parallelize within a single contact (6 independent components)
    // Less practical -- overhead exceeds benefit for O(1) operations.

NOTE: In the current Node.js single-threaded environment, this parallelism
is theoretical. The scoring loop completes in < 100ms for N contacts,
so parallelization adds no practical benefit here. The bottleneck is
JSON serialization/deserialization, not scoring computation.
```

### 10.2 Within Baseline Computation

```
PARALLELIZABLE: Partially.

INDEPENDENT operations (can run concurrently):
    A. Mutual connections P90 collection
    B. Edge count accumulation
    C. Cluster membership mapping

DEPENDENT: P90 computation requires sorted array from (A)/(B).

PRACTICAL NOTE: All three are O(N) or O(E) at current dataset scale.
Total baseline computation < 5ms. No optimization needed.
```

### 10.3 Within Scan List Building

```
PARALLELIZABLE: No -- criteria categories are applied sequentially because
deduplication (seen Set) must enforce first-reason-wins ordering.

However, the individual SORT operations within each criteria category
are independent and could theoretically be parallelized:
    sort(goldContacts by goldScore)     |  concurrent
    sort(referrals by referralLikelihood)|  concurrent
    sort(hubs by networkHub)            |  concurrent

PRACTICAL NOTE: Sort on N contacts is < 1ms. Not worth parallelizing.
```

### 10.4 Within Pipeline Execution

```
PARALLELIZABLE: No for the main scoring chain (strict dependency).

    graph-builder -> scorer -> behavioral-scorer -> referral-scorer
    (each reads output of previous step from same file)

PARALLELIZABLE: Yes for terminal consumers.

    After referral-scorer completes, these can run concurrently:
        analyzer.mjs        |  concurrent
        report-generator.mjs |  concurrent
        delta.mjs            |  concurrent

    All three only READ graph.json (no writes back).
```

### 10.5 Within Batch Deep Scan

```
PARALLELIZABLE: No for individual scans.

    Deep scans hit LinkedIn's servers and must be sequential with delays
    to avoid rate limiting and account suspension.

    CONSTRAINT: opts.delay (default 10s) between scans.
    CONSTRAINT: 180s timeout per scan.

PARALLELIZABLE: Yes for the post-scan rebuild.

    After all scans complete, the rebuild pipeline runs:
        graph-builder -> scorer -> behavioral-scorer -> referral-scorer -> report-generator

    This is the same sequential chain as the normal pipeline.
    The report-generator could run concurrently with analyzer if both were needed.
```

### 10.6 Summary of Parallelism

```
| Operation                    | Parallelizable? | Speedup Potential | Practical? |
|------------------------------|-----------------|-------------------|------------|
| Score contacts (across N)    | Yes             | ~Kx (K workers)   | No (< 100ms total) |
| Score components (within 1)  | Yes             | ~6x               | No (< 0.1ms each)  |
| Baseline computation         | Partial         | ~2x               | No (< 5ms total)   |
| Scan list building           | No (dedup)      | N/A               | N/A                 |
| Pipeline scoring chain       | No (dependency) | N/A               | N/A                 |
| Pipeline terminal consumers  | Yes             | ~3x               | Yes (each ~1-5s)    |
| Batch deep scans             | No (rate limit) | N/A               | N/A                 |
| Post-scan rebuild            | No (dependency) | N/A               | N/A                 |
```

The only practical parallelization opportunity is running `analyzer.mjs`, `report-generator.mjs`, and `delta.mjs` concurrently after the scoring chain completes, since each only reads the finalized `graph.json` without writing back to it.

---

## Appendix A: Helper Functions

```
FUNCTION: CAP(value, max = 1.0)
    RETURN MIN(MAX(value, 0), max)

FUNCTION: ROUND3(n)
    RETURN ROUND(n * 1000) / 1000

FUNCTION: PERCENTILE(sortedArray, pct)
    IF sortedArray.length == 0 THEN RETURN 0
    idx <- MAX(0, CEIL(pct / 100 * sortedArray.length) - 1)
    RETURN sortedArray[idx]

FUNCTION: LOWERCASE(s)
    RETURN s converted to lowercase

FUNCTION: CONCAT(s1, s2, ...)
    RETURN all arguments joined into one string

FUNCTION: JOIN(array, separator)
    RETURN array elements joined with separator
```

## Appendix B: Configuration Constants Quick Reference

```
REFERRAL WEIGHTS:
    referralRole:        0.25
    clientOverlap:       0.20
    networkReach:        0.20
    amplificationPower:  0.15
    relationshipWarmth:  0.10
    buyerInversion:      0.10
                         ----
                         1.00

ROLE TIER SCORES:
    high:   1.0   (18 patterns: agency, partner, fractional, advisor, white label, ...)
    medium: 0.7   (14 patterns: consultant, broker, community manager, ...)
    low:    0.3   (10 patterns: manager, director, founder, ceo, vp, ...)

REFERRAL TIER THRESHOLDS:
    gold-referral:   >= 0.65
    silver-referral: >= 0.45
    bronze-referral: >= 0.30

NETWORK REACH WEIGHTS:
    connectionCountWeight:   0.3   (normalized vs 500)
    clusterBreadthWeight:    0.4   (clusters / 30% of active clusters)
    edgeDensityWeight:       0.3   (edges / P90 edges)

RELATIONSHIP WARMTH WEIGHTS:
    mutualScore:    0.35   (normalized vs P90 mutuals)
    relStrength:    0.35   (from Phase 1 scorer)
    recencyScore:   0.30   (step function on connectedDaysAgo)

RECENCY STEP FUNCTION:
    <= 90 days:     1.0
    <= 180 days:    0.7
    <= 365 days:    0.4
    > 365 days:     0.2
    unknown:        0.1

CLIENT OVERLAP WEIGHTS:
    industryScore:  0.6   (cap at 3+ industries)
    serviceScore:   0.4   (cap at 2+ service signals)

BUYER INVERSION WEIGHTS:
    invertedIcp:      0.5
    ecosystemScore:   0.5   (cap at 3+ ecosystem keywords)
```
