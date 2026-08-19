# ADR-034: Per-component harness strategy — scoring, CI, and the no-op-metric rule

**Status**: Accepted (date: 2026-08-18) — **Updated: 2026-08-19**

> **Update 2026-08-18**: every gap this ADR originally recorded as open has
> since landed. `browser/`, `docs/` and `scripts/` now have real, verified
> test commands; the MetaHarness aggregate script exists; and the MCP scan
> false-clean is fixed. The Consequences section below reflects the built
> state, not the target. See the revised bullets for what changed and for
> the two findings that surfaced only once the scan started working.

## Context

Network Navigator is a monorepo of four independent Node components — `app/`,
`browser/`, `docs/`, `scripts/` — each with its own `package.json`. Three
have their own lockfile (`app/package-lock.json`, `browser/package-lock.json`,
`docs/package-lock.json`); `scripts/` currently has neither a lockfile nor a
`scripts` key. There is no root `package.json`, no root lockfile, and no
npm/yarn/pnpm workspace tying the four together.

Before this ADR, two problems existed simultaneously:

1. **No CI at all.** The repo had no `.github` directory — nothing was
   verified on push or PR.
2. **MetaHarness scoring was root-scanned and misleading.** Pointing
   `metaharness score` at the repo root reports `repo_type: "unknown_mcp"`,
   `compileConfidence: 12`, `publish_readiness: 0.05`, verdict `blocked` —
   because the root has no `package.json`/`tsconfig.json` for the tool to
   find, not because of any real defect. Per-component baselines captured
   2026-08-16 tell a materially different story:

   ```
   component  harnessFit  compileConfidence  risk_score  verdict
   app        57          90                 0.295       needs-work
   browser    61          65                 0.47        needs-work
   docs       51          65                 --          --
   scripts    50          40                 --          --
   root       50          12                 0.72        blocked (ARTIFACT — do not track)
   ```

   Root's `blocked` verdict is an artifact of scanning the wrong directory
   and must not be reported as a repo health signal.

Separately, `app/`'s test script previously carried `--passWithNoTests`,
which let `npm test` report green with zero assertions run — a metric raised
without any real verification behind it (fixed as part of this same work;
see Related). The same failure mode was identified as a live risk for
`browser/`, `docs/`, and `scripts/`, none of which had a test command at
all: adding a no-op test script to any of them would raise
`compileConfidence` by ~25 points while adding zero real safety, exactly
reproducing the `--passWithNoTests` problem.

There was also a false-clean finding in the MCP surface scan: the repo has a
real `.mcp.json` at root registering three MCP servers (`claude-flow` with 15
max agents and the security/browser/neural capability groups enabled,
`ruv-swarm`, `flow-nexus`), but `metaharness_mcp_scan` looks for
`.mcp/servers.json` and `.harness/claims.json`, finds neither, and reports
"no MCP surface — nothing to scan." The OIA audit then rolls that up as
worst-severity "clean," which is a false clean, not a verified-safe result.

## Decision

1. **The repo is scored and verified per-component, not at root.** `app/`,
   `browser/`, `docs/`, and `scripts/` are the tracked components. The repo
   root is explicitly excluded from the tracked set — scoring it produces
   tool artifacts, not findings, per the baseline table above.

2. **CI is the verification gate.** `.github/workflows/ci.yml` runs a matrix
   job over the four tracked components. Each component: installs
   dependencies (`npm ci` where a lockfile exists, `npm install` where it
   doesn't — currently only `scripts/`), then runs
   `npm run {lint,typecheck,build,test} --if-present`. `--if-present` means
   a component with no `test` script currently contributes nothing to the
   gate for that check — this is accepted as a known, visible gap (tracked
   by the baseline table and by the open work below), not a passing result.
   Triggers: push to `main` and `pull_request`.

3. **A repo-wide MetaHarness scan aggregates per-component, not root.** A
   script (`scripts/metaharness-scan.sh` or equivalent) runs
   `metaharness score` and `metaharness genome` against each of the four
   component directories and reports one aggregate table, so drift between
   components is visible at a glance. It is non-blocking in CI — a report,
   not a gate — until the underlying per-component gaps below are closed.

4. **Standing rule: a metric must not be raised by adding a no-op command.**
   Adding a test/typecheck/lint script whose only purpose is to make a
   number go up — an empty test suite, `--passWithNoTests`, a script that
   always exits 0 — is treated as equivalent to not having the check at all,
   and worse, because it hides that fact. `docs/` (a Fumadocs site) is the
   clearest case where "test" may honestly mean a link-check or a
   build-assertion rather than a unit-test suite; whatever is added must
   verify something real.

5. **~~The MCP surface false-clean is a recorded gap.~~ RESOLVED
   2026-08-18 — and the mechanism above was wrong.** The original text
   guessed the fix was making the scanner recognize `.mcp.json`, or adding
   a `.mcp/servers.json` shim. Reading `metaharness/dist/mcp-scan.js`
   showed otherwise: the scanner reads `.harness/mcp-policy.json`,
   `.claude/settings.json` and `package.json`, and **never consults the
   root `.mcp.json` at all** — so the real server registry was structurally
   invisible to it. (`.mcp/servers.json` belongs to a different command,
   `harness mcp ls|invoke`.) Fixed by adding `.harness/mcp-policy.json`
   describing the real posture. The scan moved from `mcpEnabled: false` /
   "clean" to `mcpEnabled: true` / 8 findings / worst HIGH. The old
   `toolSafety: 100` was a false clean produced by scanning nothing, and
   must never be cited as a passing security check.

6. **The permissive MCP posture is an ACCEPTED risk, not an open gap.**
   Decided by the repo owner 2026-08-19. The blanket `mcp__claude-flow__:*`
   grant in `.claude/settings.json` stays as-is: this is a single-maintainer
   local development repo, and the agent tooling needs shell, network and
   file-write to function. Consequently the 8 findings the scan now reports
   are **expected output, not a to-do list** — they describe reality, and
   must not be "fixed" by flipping flags in `.harness/mcp-policy.json`.
   Knowingly held: arbitrary command execution, unscoped network egress,
   filesystem and cloud-storage writes, no approval gate, no audit log, no
   tool timeout, no per-turn call budget. One real control is in place:
   `permissions.deny` blocks `Read(./.env*)`, so secrets are unreachable.
   **The scan under-reports this.** metaharness's wildcard check
   exact-string-matches `mcp__*` / `mcp__*__*`, so the actual
   `mcp__claude-flow__:*` rule does not trip its `wildcard-tool-perm`
   finding — the true surface is broader than the 8 findings suggest.
   This acceptance is scoped to local single-maintainer development and
   must be revisited before exposing the MCP surface to CI, to a shared or
   multi-user environment, or to any untrusted input path.

## Consequences

- The repo now has a real CI gate where it previously had none, and a
  per-component score that reflects actual state instead of a root-scan
  artifact.
- ~~As of this writing, the gate is honest but incomplete.~~ **Closed
  2026-08-18.** All three gaps are filled with real, executed tests:
  `browser/` gained a `node:test` suite over the ADR-028 permission-mirror
  logic (14 assertions against a faked `chrome` global) — the riskiest
  untested surface is now covered; `docs/` got a zero-dependency link
  checker rather than invented unit tests, since it is a pure Fumadocs
  wrapper with no business logic of ours (it validates 151 links across
  75 files and caught a genuinely dead `/docs/api-reference/profile`
  reference on its first run); `scripts/` is confirmed to STAY STANDALONE
  and gained 18 assertions over its PII redaction ruleset.
- Because `--if-present` is silent about absent scripts, a future
  contributor could satisfy CI by adding empty scripts. Decision point 4
  exists specifically to make that an explicit violation of documented
  policy rather than a passing, unremarked-upon CI run. **The rule was
  enforced in practice on 2026-08-18**: the three new test commands raised
  `compileConfidence` by +25 each (browser 65→90, docs 65→90, scripts
  40→65), and those gains were confirmed EARNED by mutation-testing —
  breaking `approved-origins.ts` canonicalization failed 3 of 14 browser
  tests. A no-op script would have produced the same +25 with none of the
  signal, which is precisely what this decision forbids.
- ~~The MetaHarness aggregate script and the `.mcp.json` scan fix are
  separate, still-open pieces of work.~~ **Both landed 2026-08-18.**
  `scripts/metaharness-scan.sh` scores the four components, excludes the
  root with an explicit notice, degrades gracefully when the binary is
  absent, and always exits 0 so it is safe as a non-blocking CI report.
- **The MCP scan fix inverted the security picture, and that is the
  point.** The scan moved from `mcpEnabled: false` / "clean" to
  `mcpEnabled: true` / 8 findings / worst HIGH. The prior "clean" was a
  false clean produced by scanning nothing. Two corrections to the
  original understanding, both established by reading
  `metaharness/dist/mcp-scan.js` rather than trusting tool descriptions:
  (a) the scanner reads `.harness/mcp-policy.json`, `.claude/settings.json`
  and `package.json` — it never consults the root `.mcp.json`, so the real
  server registry was structurally invisible to it; (b) the scanner's
  wildcard check exact-string-matches `mcp__*`/`mcp__*__*`, so the actual
  `mcp__claude-flow__:*` blanket grant in `.claude/settings.json` does NOT
  trip its wildcard finding. **The true posture is therefore worse than
  even the 8 findings show.** Tightening that grant is a deliberate,
  user-owned security decision and is intentionally NOT made by this ADR.

## Alternatives considered

### Score/verify the repo as a single root unit

Rejected. There is no root `package.json`/`tsconfig.json` and no workspace
tool joining the four components, so a root-level scan measures the absence
of a workspace, not the health of the code. The baseline table shows the
resulting numbers (`compileConfidence: 12`, verdict `blocked`) are strictly
worse and less accurate than any of the four real components — treating them
as a repo health signal would be actively misleading.

### Add no-op test/typecheck scripts to close the compileConfidence gap quickly

Rejected. This is the same failure mode already found and fixed in `app/`'s
`--passWithNoTests` flag. A metric raised without real verification behind
it is worse than an honest low score, because it removes the visible signal
that work is still needed.

### Fold `scripts/` into `app/` now, as part of this ADR

Deferred, not decided here. `scripts/` currently has no lockfile and no
`scripts` key — it's a bare dependency holder for `capture-fixture.ts`,
`fixture-lint.ts`, and `redaction.ts`. Whether it becomes a fully-fledged
fifth-in-practice component (with its own `build`/`test`/`typecheck`) or is
absorbed into `app/` is left to the component-ownership decision this ADR's
Related work covers; both the CI matrix and the MetaHarness aggregate treat
it as a tracked component in the meantime so it isn't silently dropped from
visibility either way.

## Related

- CI gate: `.github/workflows/ci.yml`
- MCP registration referenced in point 5: `.mcp.json` (root)
- ADR-028 (Chrome permission model — the untested surface called out for
  `browser/`)
- This ADR documents the architecture behind a cluster of same-session
  decisions: adding the CI workflow; removing `--passWithNoTests` from
  `app/`'s test script; building the per-component MetaHarness aggregate
  script; deciding real test commands for `browser/`/`docs/`/`scripts/`;
  and fixing the MetaHarness MCP scan path miss. Several of those are open
  work at the time this ADR was written and are not retroactively marked
  done by it.
