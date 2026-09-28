# ADR-037: Distribute the publicist as a manifest-generated skill pack bound to an operator-run instance

**Status**: Proposed (date: 2026-09-19)

## Context

The goal is a publicist/marketing agent that other people can run, not
only the author of this repo. "Self-replicating" needs a precise meaning
before it can be built, because two plausible readings have very
different costs.

**What already exists in the shape of a distributable pack:**

`agent/network-navigator/` is a skill pack today: `SKILL.md`,
`commands/` (`linkedin-prospector.md`, `network-intel.md`), `scripts/`
(`api-client.mjs`, `pipeline.mjs`, `analyze.mjs`, `configure.mjs`),
`data/` (`icp-config.json`, `outreach-config.json`,
`outreach-templates.yaml`, `rate-budget.json`) and its own
`package.json` at version 0.5.0. It is API-first by design — the skill
orchestrates REST calls and holds no database access.

`service-manifest.json` at the repo root already describes the services,
ports, health checks and required environment for the whole stack. It is
the closest thing the project has to a machine-readable capability
declaration.

**The two facts that constrain every option:**

1. **There is no authentication in this application.** ADR-035 established
   this: no `getServerSession`, `currentUser`, `auth()` or `getUser()`
   anywhere under `app/src/lib` or `app/src/app/api`; the owner is
   `owner_profiles WHERE is_current = TRUE LIMIT 1`; `tenants.owner_user_id`
   defaults to the literal `'local'`. The product is single-user,
   multi-tenant.
2. **The skill pack's client is unauthenticated.**
   `agent/network-navigator/skills/linkedin-prospector/scripts/api-client.mjs:4` reads
   `process.env.NETWORKNAV_URL || 'http://localhost:3750'` and issues bare
   `fetch` calls with no credential. The only real auth surface in the
   codebase is `withExtensionAuth` — `X-Extension-Token` validated against
   `extension_tokens`, with origin checks and rate limiting.

A hosted multi-tenant product is therefore not one ADR away. It is
blocked behind an authentication system that does not exist, and RLS
(`030-ecc-rls.sql`, `037-research-rls.sql`) protects rows only once
something can establish *who is asking* — which nothing currently can.

## Decision

**Ship the publicist as a versioned skill pack that binds to an instance
the operator runs themselves, and let the pack generate its own skill
surface from the instance's capability manifest.**

Three parts.

### 1. Binding: config file plus an extension-style token

The pack gains `publicist.config.json`:

```
{
  "instanceUrl": "http://localhost:3750",
  "tenantSlug": "default",
  "contractVersion": "1.x",
  "tokenEnv": "NETWORKNAV_TOKEN"
}
```

`api-client.mjs` is extended to send the token on every request. Server
side, the existing `extension_tokens` mechanism is generalized: rename the
concept to *client tokens*, keep `X-Extension-Token` working as an alias
for one release, and allow a token to declare a client kind
(`extension` | `agent`). This reuses `validateExtensionToken`, the revoke
path, the origin check and the rate limiter rather than inventing a second
credential system.

> This is not authentication. It is a bearer credential that proves *an*
> authorized client is calling — the same guarantee the extension has
> today. It does not identify a human, and it does not make a shared
> instance safe. It exists so that an instance reachable beyond
> `localhost` is not wide open, which is the minimum a distributed pack
> demands.

Non-`localhost` `instanceUrl` without a token is a hard error at pack
startup, not a warning.

### 2. Capability negotiation: `/api/manifest`

A new read-only endpoint serves a capability manifest generated from
`service-manifest.json` plus runtime state: contract version, which
optional subsystems are enabled (`RESEARCH_FLAGS`, `ECC_IMPULSES`, the
editorial context of ADR-036), which enrichment providers have keys,
which impulse handlers are seeded, and the schema version already exposed
by `/api/health`.

The pack calls it on every run and:

- refuses to run against an incompatible `contractVersion`;
- **generates its command surface from what the instance actually has.**
  An instance without the editorial tables does not get publicist
  commands. An instance with no `ANTHROPIC_API_KEY` gets research and
  scoring commands but not drafting.

This is the replication mechanism, stated plainly: **the pack is derived
from the manifest, not hand-maintained in parallel with it.** One pack
serves every instance shape, and a new capability on the server appears
in the agent without a pack release. It also kills the drift class this
repo keeps hitting — ADR-027 through ADR-032 each carry an "Updated
2026-08-19" note recording a decision the code silently diverged from.

### 3. Scaffolding: `publicist init`

The pack can create an instance it does not have: copy `.env.example`,
prompt for the required variables named in `service-manifest.json`,
`docker compose up -d`, wait on the health check, apply init scripts,
seed `impulse_handlers` for the default tenant, walk the operator through
the ICP/niche/offering configuration that `configure.mjs` already
automates, and print the Chrome extension load instructions.

That is the honest meaning of self-replicating here: **the pack can stand
up a working copy of the system it talks to, then reconfigure itself to
match it.** No claim beyond that.

### Explicitly out of scope

Hosted multi-tenant SaaS. Not rejected — **deferred, and blocked on
authentication**, exactly as ADR-035 defers per-user gating on the same
dependency. When auth lands, revisit this ADR; the tenant model, RLS
policies and token infrastructure built here are the substrate it would
use, not throwaway work.

## Consequences

**Good:**

- A second operator can run this within a day, with their own keys, their
  own data and no shared trust boundary. Data never leaves their machine,
  which for LinkedIn network data is a feature, not a compromise.
- The pack stops being a hand-maintained mirror of the API and becomes a
  projection of it. Server capability is the single source of truth.
- Reusing `extension_tokens` means one credential system with one revoke
  path.

**Costs and risks:**

- Generalizing `extension_tokens` touches a shipped auth path used by the
  live extension. The alias period is mandatory, and the extension's
  `chrome-extension://` origin check must keep passing while an agent
  client — which has no such origin — is allowed through a different rule.
  Getting this wrong locks the extension out.
- `/api/manifest` leaks configuration shape (which providers have keys,
  which flags are on). It reports booleans, never values, and is covered
  by the same token as everything else.
- Manifest-generated commands mean a server bug can silently remove agent
  capability. The pack must log what it generated and what it dropped, and
  say so to the operator, rather than quietly shrinking.
- Every distributed copy is an instance nobody can patch centrally. The
  pack needs a version check against a published contract and should warn
  loudly when the instance is behind.
- `docs/` currently documents a single-operator setup. A second audience
  means the configuration guide has to stop assuming the author's machine.

## Alternatives considered

**Hosted multi-tenant SaaS now.** Rejected for this milestone: requires an
authentication system, onboarding, billing and a security review of RLS
under real adversarial conditions. ADR-035 establishes the auth gap as a
multi-week project, not a wiring task. Deferred, not abandoned.

**One-command self-host installer, no pack.** Rejected as *insufficient
rather than wrong* — it is in fact part 3 of this decision. Alone it
distributes the application but leaves the agent hand-maintained against a
moving API, which is the drift problem this repo already has evidence of.

**Hand-written static skill pack, versioned per release.** Rejected: it is
what exists, and `SKILL.md` already documents six phases that must be kept
true by hand. Every ADR from 027 to 032 is a record of hand-maintained
intent drifting from code.

**Ship the pack as an MCP server instead of a skill pack.** Deferred. The
repo has `.mcp.json` and `.mcp/servers.json` and MCP would give a cleaner
tool surface than shell scripts. It is a packaging change that can be made
later without disturbing this decision, because both forms consume the
same manifest.

## Related

- [ADR-035](./ADR-035-research-mode-gating-supersedes-033.md) — the
  no-authentication finding this decision is built around.
- [ADR-028](./ADR-028-chrome-permission-model.md) — the extension token and
  origin model being generalized.
- [ADR-036](./ADR-036-editorial-engine-bounded-context.md) — the engine
  being packaged.
- `service-manifest.json` — the manifest this generalizes.
- `docs/plans/publicist-engine.md` — phased delivery.
