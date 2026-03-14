# Phase 2: Core Engine -- Extension Plan

## Objective

No extension work is planned for Phase 2. The Chrome extension remains in its Phase 1 scaffolding state (Manifest V3 project structure, TypeScript configuration, esbuild build chain, shared types directory). Extension development begins in Phase 4.

## Rationale

Phase 2 focuses exclusively on backend core engine (scoring, enrichment, graph analytics) and the corresponding app UI integration. The extension has no dependency on or contribution to these subsystems:

- **Scoring engine**: operates on imported contact data, not captured pages
- **Enrichment pipeline**: calls external APIs, not the extension
- **Graph analytics**: computed from database edges, not extension input
- **ICP discovery**: clusters contacts already in the database

The extension's "dumb capture + smart app" architecture means it only needs to interact with the app's capture and task endpoints, which are built in Phase 4.

## Prerequisites for Phase 4

When Phase 4 begins, the extension will need the following from Phase 2:

| Phase 2 Output | Extension Use in Phase 4 |
|---|---|
| Scoring engine operational | Extension can display contact scores in side panel |
| Enrichment pipeline operational | Extension can trigger enrichment from captured profile page |
| Graph analytics computed | Extension can show warm intro paths in side panel |
| ICP profiles defined | Extension can show ICP match status for captured profiles |

These are read-only dependencies -- the extension will consume Phase 2 data via API endpoints, not modify the underlying engines.

## Parallel Agent Assignments

None. Zero agents assigned to extension work in Phase 2.

## Task Checklist

No tasks.

## Gate Criteria

No gate criteria specific to the extension in Phase 2. The extension scaffolding from Phase 1 should remain intact and buildable:

| # | Criterion | Verification Method |
|---|---|---|
| 1 | Extension project still builds | `cd extension && npm run build` exits 0 |
| 2 | Manifest V3 valid | Chrome can load the extension directory without errors |
| 3 | Shared types package intact | TypeScript interfaces compile without errors |

These are maintenance checks, not new deliverables.
