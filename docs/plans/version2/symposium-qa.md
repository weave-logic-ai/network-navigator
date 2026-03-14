# Version 2 Symposium -- Cross-Panel Q&A for Product Owner

## Introduction

This document consolidates all open questions raised by the four expert panels during the Version 2 Symposium for the LinkedIn Network Intelligence tool. These questions require product owner decisions before the final analysis and SPARC planning can proceed.

The four panels that contributed questions:

- **Panel 1**: Data Architecture & Graph Engine
- **Panel 2**: Application UX & Dashboard Design
- **Panel 3**: Chrome Extension Architecture & Integration
- **Panel 4**: Enrichment Pipeline & Intelligence Engine

Questions have been de-duplicated, merged where multiple panels raised the same concern, and organized into thematic groups for efficient review. Each question includes a placeholder for the product owner's answer.

---

## Scope & Scale

**Q1. What is the maximum number of contacts the V2 system should support?**
The LinkedIn export shows ~956 connections, but with 2nd-degree discovery and API enrichment the dataset could grow significantly. SQLite works well up to ~100K contacts; beyond that, Neo4j or PostgreSQL would be needed. Graph analytics performance also degrades at scale (JSON graph is fine at 500; requires a dedicated graph DB at 50K+). What is the upper bound we should design for?
*Raised by: Panel 1, Panel 4*
*Panel 1 recommendation: Design for up to 100K with SQLite; add a migration path to Neo4j if needed.*
*Panel 4 recommendation: Architect for 5,000 at launch; plan for 50K+ as a future tier.*

**Answer:**
https://github.com/ruvnet/ruvector/blob/main/crates/ruvector-postgres/README.md
I would like to use postgres as the backend for this. I think we should save this for it's own sprint later, but if it's best to put it in now, I would suggest a docker-compose with pgsql and the ruvector extension on it. I think I agree with the panels, but please look at if there is synergy by adopting pgsql right now.

---

**Q2. Should the system support multiple LinkedIn accounts or multiple users?**
Should a user be able to import data from more than one LinkedIn account (e.g., personal + company page, or a team of sales reps each exporting their connections)? This affects whether contact IDs are globally unique or scoped per account, whether the graph supports multiple "owner" nodes, and whether session state, tasks, and extension sync need user-scoping.
*Raised by: Panel 1, Panel 2, Panel 3*
*Panel 3 note: Also asks whether the extension should support switching between multiple app instances.*

**Answer:**
1:1 initially. I think that is the intent currently to help a single user. There may be room to add multi-account enrichment or something like that in the future, but it should just be single Linkedin Account now.
---

## Architecture & Storage

**Q3. Should enrichment data be stored alongside the core contact record or in separate provenance-tracked tables?**
A single combined view is simpler to query but loses source attribution. Separate tables preserve "PDL says this email, Apollo says that email" and support TTL-based refresh, but require JOIN queries in the UI.
*Raised by: Panel 1*
*Panel recommendation: Separate tables with a materialized "current best" view. Confirmation needed that this aligns with how the UI will display enrichment data.*

**Answer:**
seperate tables, as we can export view tables as needed, and we will also need to be feeding the vector tables. This entire data structure needs to be centered in ruvector RVF format, with a flat database with separate tables, sources, files for all imported enrichment etc.

---

**Q4. What is the data retention policy for enriched data?**
Some enrichment providers require data refresh or deletion after certain periods (e.g., PDL requires re-verification every 12 months). Should the system auto-purge stale enrichment data, flag it for user review, or simply mark it as stale?
*Raised by: Panel 1, Panel 4*
*Panel 1 recommendation: Defined retention policies -- 365 days for enrichment, 180 days for behavioral, 90 days for message analytics, with auto-expiry.*
*Panel 4 recommendation: 90-day re-enrichment for person data, 30-day for company data.*

**Answer:**
We should offer a tool in the admin app to allow purging data that matches whatever filter (name, date range, older than, etc) This can be manual person has to go and click it. It should use warning modals etc when removing data to ensure it does not happen accidently.

---

**Q5. Should the vector store embeddings be updated for V2's richer data?**
The current RVF store uses 384-dimensional embeddings. With enrichment adding new text fields (about sections, post content, work history), should we: (a) keep 384-dim but rebuild with richer input, (b) move to larger embeddings (768/1024-dim), or (c) support multiple embedding spaces (profile similarity + content/topic similarity)?
*Raised by: Panel 1*

**Answer:**
two embedding spaces — but keep them both 384-dim:
  - Profile similarity  (nodes)
  - Content/topic similarity  (signals)

This way we keep the embedding spaces small, and make them modular, we may find more are needed later.

---

## Enrichment & APIs

**Q6. What is the initial monthly budget for API enrichment services?**
Three scenarios were modeled: $150/month (PDL Starter + Lusha Free + TheirStack), $400/month (adds Apollo), and $800/month (full stack including Crunchbase and BuiltWith). The budget determines which providers are available and how many contacts can be enriched per month.
*Raised by: Panel 2, Panel 4*
*Panel 4 recommendation: Start with Scenario A ($150/month) and let users upgrade.*

**Answer:**
I would rather have it so ALL options are available we can sign up for them as needed and test them. We want to try to offer the cheapest way to get best enrichment so a clear plan of what we can use from where and what it requires will answer this, and some users may have a bigger budget.


---

**Q7. Which enrichment providers should be supported at launch vs. later phases?**
The V2 plan lists 6 providers (PDL, Apollo, Lusha, Crunchbase, BuiltWith, Clay). Should we build the abstraction layer for all 6 but implement only 2-3 initially?
*Raised by: Panel 1, Panel 4*
*Panel 1 recommendation: Build the abstraction for all; implement 2-3 initially.*
*Panel 4 recommendation: Launch with PDL + Lusha Free (person enrichment) and TheirStack (company tech stacks). Add Apollo, Crunchbase, and BuiltWith in Phase 2.*

**Answer:**
Cheapest that gets us the most data, analyze this please.

---

**Q8. Should enrichment run as a background process or require user initiation?**
Background enrichment (drip mode, e.g., 10 contacts/hour) spreads costs and keeps data fresh automatically. User-initiated enrichment gives more control and predictable spend. A third option is scheduled enrichment (e.g., "enrich 10 contacts per day at 9am").
*Raised by: Panel 1, Panel 4*
*Panel 4 recommendation: User-initiated with a background option -- users trigger batches but can opt into auto-enrichment for gold-tier contacts.*

**Answer:**
Hybrid, with budgets for background enrichment etc. Background enrichment should be driven by an agent.

---

**Q9. Should the enrichment budget have a hard cap or a soft cap?**
When the monthly budget is exceeded, should the system refuse to enrich (hard cap) or warn but allow override (soft cap)? What is the expected monthly enrichment budget for a typical user?
*Raised by: Panel 2*

**Answer:**
Enrichment budget will vary based on backends and user accounts etc. They will have to be able to set these, and it should be based on what they have configured and want to use.


---

## Chrome Extension

**Q10. What is the preferred communication protocol between the extension and the app?**
Options: (a) HTTP-only via localhost (simpler, polling-based), (b) WebSocket-only (real-time but more complex), or (c) hybrid HTTP + WebSocket (HTTP for request/response, WebSocket for push updates from app to extension). WebSocket is only needed if the app must push real-time updates (task changes, Claude suggestions) to the extension. If polling every 30 seconds is acceptable, HTTP alone suffices.
*Raised by: Panel 3*
*Panel recommendation: Hybrid HTTP + WebSocket.*

**Answer:**
hybrid, http where socket is not needed. But we do not want to slow the user down it should be that speed to finish their tasks is the most important KPI

---

**Q11. Which LinkedIn page types must be supported at launch?**
The panel designed extractors for Profile, Search Results, Feed/Activity, Connections List, Company Page, and Messages. Should all ship in Phase 1, or should we prioritize a subset?
*Raised by: Panel 3*
*Panel recommendation: Profile + Search Results for Phase 1; others in Phase 2.*

**Answer:**
We have extractors for most of that already, we do not need to add additional ones but we should annote in our docs where we are leaving data on the table.

---

**Q12. Will the extension be published to the Chrome Web Store or distributed as sideloaded?**
The Chrome Web Store provides auto-updates and credibility, but LinkedIn-related extensions face higher scrutiny and potential rejection. Sideloading requires developer mode and manual updates but avoids store policies.
*Raised by: Panel 3*
*Panel recommendation: Start with sideloading for the initial user base; target Chrome Web Store once compliance posture is proven.*

**Answer:**
Sideloading is acceptable initially, we will deal with publishing at a later time.

---

**Q13. Should data capture be entirely manual or offer an opt-in auto-capture mode?**
Manual capture (user clicks "Capture") is safest for LinkedIn ToS compliance. Auto-capture (captures every profile the user manually navigates to, without clicking a button) is more convenient for power users but carries higher risk.
*Raised by: Panel 3*
*Panel recommendation: Manual as default; opt-in auto-capture toggle for power users.*

**Answer:**
Autocapture should be an opt-in. Easy capture especially on targeted ones is a must. It will be the user loading the page, the data will be local.
---

**Q14. Should the Claude agent run in the extension or exclusively in the local app?**
Running Claude in the extension is not feasible (API keys would be exposed; service workers have compute limits). The panel recommends all Claude interaction goes through the Next.js app, with results pushed to the extension. The extension would be a data capture + display layer only.
*Raised by: Panel 3*
*Panel recommendation: All Claude interaction via the app. Extension is a thin client.*

**Answer:**
yes the extension will go through next.js app for any claude interactions. In many ways this should basically be transparent from the extension. In the APP it may be much more apparent that claude is being called and it will not be transparent.

---

**Q15. How should selector updates be deployed when LinkedIn changes its DOM?**
Options: (a) Extension update via Chrome Web Store (slow, 1-3 day review), (b) Sideloaded update (fast, manual), or (c) Remote selector config fetched from the app on startup (fastest, no extension update needed).
*Raised by: Panel 3*
*Panel recommendation: Option (c) -- a selector config file served by the app, allowing immediate updates without redeploying the extension.*

**Answer:**
extension should be completely lightweight and unaware of the DOM, it will only SAVE the page into the local cache via the app. This way we have cached copy of the page (we should keep at least the last 5 copies), so we can adjust changes to DOM etc. The user does all interaction, and the extension is only guiding the interactions and pushing cache into local app, which can then be acted on through rounds of enrichment. All of the data-sources should work like this in my opinion, this allows for rerun or debug etc easily.

---

## ICP & Scoring

**Q16. Should ICP profiles be fully automated, semi-automated, or manual?**
V1 requires manual ICP configuration. V2 can discover ICPs from data clustering (HDBSCAN). The question is whether discovered ICPs should auto-activate or require user confirmation before influencing scoring. Should there also be a "trust the algorithm" mode for power users?
*Raised by: Panel 1, Panel 2, Panel 4*
*Panel 4 recommendation: Semi-automated -- system discovers ICPs automatically but presents them for user review before they affect scoring.*

**Answer:**
The natural ICPs and Niches need to be exposed to user, allowing them to build specific networks/plans etc based on them. It is not a singular thing. Additionally, yes there should be a power user mode which allows the user to select there own ICP or Niche, and works with them to build out how to network into that and even helps find super hubs outside of linkedin using other data sources. Always trying to figure out what the wedge shape is, and how to expand it. (The wedge is the 3d, radius is users penetration, Nitch is the arc length and ICP is the height of the wedge)
---

**Q17. Should the system support multiple simultaneous ICP profiles?**
Should a user have more than one active ICP (e.g., "AI Startups" + "Enterprise E-Commerce")? If so, should contacts be scored against all ICPs with per-ICP tier assignments (a contact could be Gold for one ICP and Bronze for another)?
*Raised by: Panel 1, Panel 2*
*Panel 1 note: Per-ICP scoring requires an `icp_profile_id` foreign key on the score table, which changes the scoring pipeline significantly.*

**Answer:**
Yes they may switch Niche Profiles. ICP is the "depth of the market" which Niche is the broadness of the offering they are focused on.  This model should allow for a lot of different analysis by swapping out one or more of those dimensions.

---

**Q18. Should scoring weights be user-adjustable via the UI?**
V1 hardcodes scoring weights. V2 could expose a "scoring tuning" panel where users adjust dimension weights (e.g., "I care more about network position than ICP fit"). This adds UI complexity but gives power users control. Separately, should the system adaptively learn weights from outreach outcomes (Bayesian updating)?
*Raised by: Panel 4*

**Answer:**
v2 should create score tuning in the admin panel, all math should be exposed there, and we should allow the user to see it on detailed user view on hover for instance etc. Expose it all, shadcn ui has tons of components to handle exposing all of this easily. This of course will allow us to also expose training on the RVF components, so let's make sure we are allowing the user to help us improve their models.

---

**Q19. Should the scoring algorithm be versioned so V1-era and V2-era scores can be compared?**
V2 introduces richer data inputs (actual message frequency, real enrichment data) that will change scoring outcomes. Should users be able to compare old scores with new scores on the same contacts?
*Raised by: Panel 1*

**Answer:**
Old scores are not important. This can be a complete rewrite of the scoring elements if need be, we need to make them extensible so creating a base, and then the various extensions to it for each scoring types data would be great. We should even look at using existing scoring libraries or methods and bring in an expert or two on this if we need to.
---

## UX & Workflow

**Q20. What is the primary user persona for V2?**
Is the target user a power user doing daily prospecting (high data density, keyboard shortcuts, batch operations) or a casual networker checking in weekly (guided workflows, lower complexity)? This fundamentally affects information density, progressive disclosure, and onboarding decisions across all views.
*Raised by: Panel 2*

**Answer:**
Modern Agentic Technology Professional. Able to use claude code, able to understand containers and what is happening with this stack. More than that the primary actor should be an agent, claude with its task based system and user interaction with claude which triggers it. Claude should be 80%+ of the effort for all of the work. The user will interact with claude, app and the chrome extension. Make this thing data visualization rich. Help the user explore and build their semantic neural network of contacts and their specific offerings. We will want to ensure we are keeping that offering or offerings in view and this goes with the niche/icp to some degree although it may be independant. Initial users will likely be from CTOx program, and heavily agentic centric developers from https://agentics.org/

---

**Q21. Should the guided workflow be persistent, a dedicated page, a dashboard widget, or a combination?**
How prominent should task guidance be? Options include a persistent sidebar visible across all views, a dedicated Tasks page, a dashboard widget, or a combination. Experienced users may find persistent guidance intrusive.
*Raised by: Panel 2*
*Panel recommendation: Dashboard widget + dedicated Tasks page; global task counter in the header.*

**Answer:**
Dashboard widget should remain high level (we will have tasks but also goals which are more high level and it may be useful to see a count and name of the top three goals or something like that)
tasks page should include goals, and the agent should be able to populate this automatically as well. The tasks and goals can be modified by the user, or even rejected.
The extension should be 80% goals and task based, with the other bit accomodating interactions and connectivity and communications.
---

**Q22. How autonomous should the AI task generator be?**
Should the system create tasks silently and surface them when ready, or propose tasks for user approval before they enter the queue? When the system detects a new potential ICP cluster, should it auto-create and notify, or present it as a "suggestion" the user must accept? How many simultaneous ICPs should be supported?
*Raised by: Panel 2*

**Answer:**
Create goals with tasks, user can reject or edit. New ICP would include a new goal and a task with a link to app with details(user would see it in linkedin via extension or looking at the app), allowing them to explore etc etc. I think Unlimited ICP, because it's simply a profile of a customer. Niche is really a compound of the offering and the person offering it. An ICP may fit into more than one nitch, depending on how narrow the ICP is defined. Niches certainly can accomodate more than one ICP. For the user Nitch is the filter mechanism. As far as UI/UX, keep displaying of graphs and charts limited to just a couple groupings of these, depending on what is being showed.
---

**Q23. Should CSV import auto-generate initial ICP clusters and tasks, or prompt the user first?**
When a user imports a CSV, should the system immediately auto-generate clusters and a task queue, or prompt the user to configure preferences first (e.g., "What kind of contacts are you most interested in?")?
*Raised by: Panel 2*

**Answer:**
Both, auto-generate as you ask them questions as the generating is happeing. The more we generate and enrich the more questions you may have to help the user define their nitch and icp selections, and when working through the interactions with targets again more questions will surface as things get answered, and new info is found out etc.

---

**Q24. Should the tool be fully usable without any paid enrichment provider?**
Should users be required to configure at least one enrichment provider during onboarding, or should the tool be fully functional with only CSV data + Chrome extension data?
*Raised by: Panel 2*

**Answer:**
Yes, it should work with just the CSV, although it will be very limited. It will end up prompting to add more enrichment sources etc.

---

## Outreach & Templates

**Q25. What level of AI involvement is acceptable in message crafting?**
Options: (a) fully AI-generated messages (Claude produces the complete message from contact data), (b) user-authored templates with AI variable filling, or (c) hybrid where the user selects a template category and AI fills + adjusts tone.
*Raised by: Panel 2, Panel 3*
*Panel 3 recommendation: Claude-powered personalization in the app; extension fetches the fully rendered message. This keeps the API key in the app, enables richer personalization using graph context, and keeps the extension thin.*

**Answer:**
Templates should be stored in a place that the user can edit them. Claude may use the templates and the data we have on the target to fill and adjust and add details. NO message should ever be sent through any medium without the user approving it, we intially do not have to worry because we will just be providing it through clipboard.

---

**Q26. Should the system recommend outreach timing or only template content?**
Timing intelligence requires activity pattern data from the Chrome extension (posting times, engagement windows). This adds extension complexity. Is timing optimization in scope for V2.0, or is template personalization sufficient?
*Raised by: Panel 4*

**Answer:**
All timing intelligence etc should be possible using the user interaction -> cache of FULL pages.

---

**Q27. Should outreach sequence progression be system-managed or fully manual?**
V1 requires manual confirmation for state transitions. Should V2 keep this fully manual, or introduce system-suggested next steps (e.g., "It's been 3 days since Alice accepted your connection. Here's a follow-up message ready to send.")?
*Raised by: Panel 4*

**Answer:**
Timed, branching and configurable. docs/plans/messages_templates.md details an example flow.

---

## Privacy & Compliance

**Q28. What is the scope of the message analysis pipeline?**
The messages.csv export contains full message content (1MB+ of conversation data). Should the system: (a) only extract metadata (message count, frequency, recency per contact) for relationship scoring, (b) store full message content for LLM-powered analysis (e.g., Claude analyzing conversation topics), or (c) analyze messages on import but discard content after extracting signals? This significantly affects storage size and privacy posture.
*Raised by: Panel 1*

**Answer:**
Using local rvf format to store all related semantic data, including full message is fine. This is the users personal data, and we are not policing that. Using claude to analyze is fine, all of this is business related and above board nothing requiring NDA etc, people would not put that on Linkedin.

---

**Q29. What data elements should the Chrome extension capture from LinkedIn pages?**
The V2 plan mentions "About section, visible recent posts, comments/likes, activity cadence, mutual connections." Should the data model use a generic `behavioral_observation` table (type + JSON value) or specific tables per observation type (posts, engagement, profile_views)?
*Raised by: Panel 1*
*Panel recommendation: Generic behavioral observation table for flexibility, with typed extraction at the query layer.*

**Answer:**
Both should be possible, and then vectorized as needed.

---

**Q30. Should the extension store captured data locally or always push to the app immediately?**
Local storage (chrome.storage) enables offline buffering but duplicates data. Should the extension maintain its own cache of captured profiles to support "already captured" badges?
*Raised by: Panel 3*
*Panel recommendation: Minimal local storage (capture queue + session state only); app is the source of truth.*

**Answer:**
Minimal local storage in chrome extension except where needed for local capture queue and working data for interacitons etc.
---

**Q31. Where should extension settings live -- in the extension or in the app?**
`chrome.storage.sync` persists across Chrome installations. App-managed settings are centralized but require the app to be running.
*Raised by: Panel 3*
*Panel recommendation: App-managed settings with a minimal local fallback (app URL, token).*

**Answer:**
App-managed settings with a minimal local fallback
---

## Data Export & Interoperability

**Q32. What export formats should V2 support beyond graph.json?**
Should V2 support: (a) CSV export of enriched contacts for CRM import, (b) CRM integration (HubSpot, Salesforce direct sync), (c) standard graph formats (GraphML, GEXF for Gephi)? This affects whether an export abstraction layer is needed.
*Raised by: Panel 1*

**Answer:**
csv export of enriched contacts is enough for this version.

---

**Q33. Should graph analytics (centrality, community detection) recompute on every data change or on-demand?**
Real-time recomputation gives fresh metrics but is CPU-intensive for large networks. On-demand ("Reanalyze Network") is cheaper but metrics may be stale.
*Raised by: Panel 4*
*Panel recommendation: Incremental updates -- recompute affected subgraphs when new contacts are added; full recomputation nightly or on-demand.*

**Answer:**
Incremental updates -- recompute affected subgraphs when new contacts are added; full recomputation nightly or on-demand.*
---

**Q34. Should Claude analyze every captured post or batch-process periodically?**
Per-post analysis costs ~$0.004/post and provides real-time insights. Batch processing (weekly or on-demand) is 3-5x cheaper but delays insights.
*Raised by: Panel 4*
*Panel recommendation: Batch processing as default with on-demand analysis for specific contacts.*

**Answer:**
Batch processing as default with on-demand analysis for specific contacts.
---

**Q35. What depth of content analysis is expected?**
Options: (a) Light -- topic extraction + basic sentiment (~$0.003/contact), (b) Medium -- topics + pain points + engagement style (~$0.008/contact), (c) Deep -- full profile including content similarity mapping, tone analysis, receptiveness signals (~$0.015/contact).
*Raised by: Panel 4*
*Panel recommendation: Medium as default; Deep available for gold-tier contacts.*

**Answer:**
Medium as default; Deep available for gold-tier contacts. Light should be available for initial investigation of potential network members, if they qualify or user wants they can go to medium/deep etc. It should be an escalating scale with quick add via light, and over time build depth where it is detected that it is needed, or bandwidth/budget is available. One of the main goals is to find "friends of friends" or people in gaps or outside graph that are in our ICP/NICHE slice, and to qualify who is a network hub or valuable target, the more valuable the more intel we need.

---

## Extension UX Details

**Q36. What should the extension's latency tolerance be for data transfer to the app?**
Should data captured by the extension appear in the app: (a) immediately via WebSocket push, (b) on explicit user "send" action, or (c) on periodic sync (every N minutes)?
*Raised by: Panel 2*

**Answer:**
Immediately. The app should only show that the task is completed, or not and provide whatever guidance is needed to complete the task.

---

**Q37. Should the extension surface tasks proactively while the user browses LinkedIn?**
For example: "You're viewing Sarah Chen's profile -- we have a task to explore her." Or should tasks only be initiated from the app?
*Raised by: Panel 2*

**Answer:**
It should be "You need to visit Sarah Chen's profile, with a clickable link that opens it in the current tab. There would be a list of people to explore this way, broken down into goals. App should only provide the link via clipboard to avoid exposing the app to linkedin. 
---

**Q38. When the user clicks a task in the extension, what should happen?**
Options: (a) auto-navigate to the LinkedIn URL (could be seen as automation), (b) copy the URL to clipboard, or (c) show a clickable link the user can choose to open.
*Raised by: Panel 3*
*Panel recommendation: For profile tasks, show a clickable link. For search tasks, copy the search query to clipboard with instructions.*

**Answer:**
For profile tasks, show a clickable link. For search tasks, copy the search query to clipboard with instructions. (For the app, only clipboard)
---

**Q39. When the app is offline and captures are queued, what export format should be available?**
The popup could allow exporting buffered data as JSON, CSV, or both.
*Raised by: Panel 3*
*Panel recommendation: JSON (matches the app's internal format) with optional CSV export for profiles.*

**Answer:**
Extension should not work without the app up.
---

---

**Once these questions are answered, the symposium will produce the Final Analysis with complete business requirements and technical specifications for SPARC planning across all three streams (Backend, App, Chrome Extension).**
