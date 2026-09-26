# ruOS Deployment — Network Navigator as an always-on host

**Status**: Design Document
**Date**: 2026-09-19
**Relates to**: ADR-036 (editorial engine), ADR-037 (skill pack distribution)

---

## Why a remote host at all

The engine described in ADR-036 is only useful if it runs when nobody is
watching: source connectors polling for topic hooks, goal ticks,
scheduled scoring runs, draft generation overnight. A laptop that sleeps
is not that.

The ruOS desktop supplies it: an always-on Linux box with a governed
shell (`desktop_exec`), a secrets vault, a scheduler, an audited activity
feed, and a real Chrome with a persistent profile.

**What it does not supply, and this is the crux:** autonomy over
LinkedIn. ADR-036 puts every LinkedIn read and write on the extension
path, operator-driven. Running on an always-on host does not relax that.
The host runs *the thinking* continuously; *the clicking* still happens
when the operator is at the keyboard — theirs, or the ruOS desktop's via
`desktop_control`. Anyone reading this plan hoping the remote host makes
capture unattended should stop here: it does not, by design.

The honest division:

| Runs unattended on ruOS | Requires the operator |
|---|---|
| Source connector polling, ingestion | LinkedIn profile / connection capture |
| Scoring runs, graph metrics, community detection | Post performance capture |
| Goal engine ticks, idea generation | Publishing anything |
| Draft generation (LLM) | Accepting or rejecting a goal |
| Enrichment waterfall (paid APIs) | Approving a spend increase |

---

## Observed environment (2026-09-19)

Measured on machine `55f765b5b50c47bb8efd5ada12d5f0b0`, not assumed:

| Property | Value |
|---|---|
| OS | Ubuntu 24.04.5 LTS, x86_64 |
| CPU / RAM | 4 vCPU / 7.8 GiB |
| Root filesystem | 7.8 G total, **7.4 G free** — Fly upper layer (`/dev/vdb` on `/.fly-upper-layer`) |
| Home volume | `/dev/vdc` on `/home/ruv` — 20 G total, **19 G free** |
| `git` | present |
| `node` | v20.20.2 |
| `google-chrome` | present |
| `docker` | **MISSING** — apt candidate `docker.io` 29.1.3, `docker-compose-v2` 2.40.3 |
| `psql` | **MISSING** |
| init system | Fly `init` — **no systemd, no cron, no pm2** |
| Egress | npm, GitHub and Docker Hub all reachable |
| sudo | passwordless |
| Existing home contents | `CLAUDE.md`, `ruvector.db`, `lost+found` |

### Findings that drive the design

**1. The database cannot be run natively. This settles the Docker question.**
The `db` service is not stock Postgres and not `pgvector/pgvector` — it is
`ruvnet/ruvector-postgres:latest`, a custom image providing a `ruvector`
column type and graph functions. The application depends
on it directly:

- `$2::ruvector` casts and `<=>` distance — the hybrid-search route and
  `app/src/lib/embeddings/generator.ts`
- `ruvector_create_graph()` / `ruvector_delete_graph()` —
  `app/src/lib/graph/ruvector-sync.ts:35,41`

Ubuntu 24.04 offers `postgresql-16-pgvector 0.6.0` in apt, which provides
`vector` — a different type with none of these functions. Hybrid search has
an explicit fallback for running "outside ruvector-postgres"
(`hybrid-search/route.ts:40-52`); graph sync does not. Reproducing the image
from apt is not possible, so **the db service runs as that container.**

**2. The app could run natively, but needs a Node it does not have.**
`app/next.config.ts` sets `output: "standalone"`, so the built app is a
plain `node server.js` — no container required, and the host is glibc,
which is what `app/Dockerfile` chose `node:24-slim` over Alpine for
(`@huggingface/transformers` native bindings). But `app/package.json`
declares `engines: { node: ">=24 <25" }` and the desktop has **node
20.20.2**, with the NodeSource apt candidate also 20.20.2. Running the app
natively means installing Node 24 outside apt (nvm or the official
tarball) — which is precisely the job the image already does.

**3. Nothing on this box restarts anything.** PID 1 is Fly's `init`;
`/run/systemd/system` does not exist, so **systemd is not running** (the
`systemctl` binary is present but inert). There is **no cron** and no
`pm2`. Whatever supervises the stack has to be built. Docker's
`restart: unless-stopped` — already set on both services in
`docker-compose.yml` — covers containers crashing mid-day; it does not
start the daemon after a machine stop, so a ruOS boot hook is required
either way. Running natively means writing the inner supervision too.

**4. Docker is not installed, and its default data root would land on the
small filesystem.** The stack is `docker-compose`-based. Installing Docker
normally puts images and volumes in `/var/lib/docker` — on the 7.4 G root
layer. Postgres+pgvector, a Next.js production build and three
`node_modules` trees will not comfortably fit there. Docker must be
installed with `data-root` relocated to the 20 G home volume:

```json
/etc/docker/daemon.json
{ "data-root": "/home/ruv/docker" }
```

**5. Root-layer persistence across stop/start is unverified.** This is a
Fly machine: `/home/ruv` is a real volume and certainly persists;
`/` is an overlay whose survival across `desktop_stop` / `desktop_start`
has not been tested. Since a weekday 23:00 auto-stop is guaranteed to
exercise this, it is **the first thing to verify — before any other
work.** If apt-installed packages do not survive, then everything must
live under `/home/ruv` and a boot script must re-provision on every
start. Do not build on an assumption here; run the test in Phase 0.

**6. `desktop_exec` is governed.** One command per call, ADR-043 denylist
refusing push/deploy/destructive patterns, 30 s default timeout and 300 s
hard maximum, every run audited to
`~/.ruos/activity/<date>/`. Consequences:

- `npm install` and `docker build` exceed 300 s. They must be run
  `nohup`'d into a log and polled, not run in the foreground of one call.
- `git push` and similar will be refused. Deployment is **pull-only**: the
  desktop clones and pulls; it never pushes. That is the right direction
  anyway.
- Each call is a fresh shell. No `cd` or environment carries over — anchor
  every path.

---

## Phased setup

### Phase 0 — Persistence: RUN, and the answer is severe

**Executed 2026-09-19. Result: the root filesystem is entirely ephemeral.**

Method: installed `tree` via apt, wrote markers to `/opt`, `/etc` and
`/home/ruv`, ran `desktop_stop` then `desktop_start`, re-checked.

| Artifact | Survived? |
|---|---|
| `/home/ruv/ruos-persist-test.txt` | **yes** |
| `/opt/ruos-persist-test.txt` | no |
| `/etc/ruos-persist-test/marker` | no |
| `tree` binary (apt) | no |
| dpkg record for `tree` | no |

Root usage returned to its exact pre-install figure (43 M). The root layer
resets to the **base image** on every start: everything preinstalled
(node 20, git, google-chrome, python, iptables) is back, and every change
made since boot is gone. Only `/dev/vdc` mounted at `/home/ruv` persists.

**Consequences, and they are structural:**

- `sudo apt-get install docker.io` does **not** survive. Nothing installed
  by a package manager into `/` survives.
- Anything the deployment depends on must live under `/home/ruv`, or be
  reinstalled on every start.
- The weekday 23:00 auto-stop means this happens **daily**, not rarely.
- The ruOS side already runs its own per-boot init (`ruos-ruflo-init`,
  logged to `~/.ruos/ruflo-init.log`, observed re-running at 19:15:48 on
  the test boot), but it is ruOS's, not a user hook. There is no
  `~/.ruos/boot.d/`. A bootstrap script under `/home/ruv` invoked by a ruOS
  **schedule** is the supported mechanism — ruOS's scheduler is the closest
  thing this box has to cron, since it has neither cron nor systemd.

### Phase 0b — Docker on the ephemeral root: validated end to end

Rather than assume, the whole chain was exercised on 2026-09-19:

| Step | Result |
|---|---|
| Static Docker 29.8.1 tarball → `/home/ruv/opt/docker` | 224 MB, extracted, survives stop/start by living on the volume |
| `dockerd` with `--data-root=/home/ruv/docker`, socket at `/home/ruv/docker.sock` | starts clean; overlayfs driver; buildkit initialized |
| `docker run hello-world` | works — registry reachable, bridge networking functional |
| `docker pull ruvnet/ruvector-postgres:latest` | 629 MB, pulled clean |
| Container boots, `pg_isready` passes | yes — PostgreSQL 17.9 |
| `ruvector` extension present | **yes, version 0.3.0, installed by default** |

Environment notes gathered in passing: kernel 6.12.105-fly under KVM,
cgroups in hybrid v1+v2 layout (dockerd warns v1 is deprecated to 2029 —
harmless), no `nft` so dockerd falls back to iptables-legacy (present),
monolithic kernel with no loadable modules. Home volume after all of this:
**1.0 G used of 20 G**.

**Use the static tarball, not apt.** Both need a per-boot step, but the
tarball needs only `dockerd` relaunched, while apt needs a download and
install against a mirror that may not be reachable. Reinstalling ~800 MB
of packages every morning is not a deployment strategy.

### Phase 0c — A defect found while validating the image

The old hybrid-search route called
`ruvector_embed('all-MiniLM-L6-v2', $1)`. The function was absent from
the inspected `:latest` and `:2.0.5` images, both reporting extension
version **0.3.0**. Upstream RuVector source now includes an embedding
function, but its arguments are `(text, model_name)`, so the old call
would have been wrong on a build that included it too.

The route has a fallback for exactly this, but its comment (line 40) says
the fallback is for running *"outside ruvector-postgres"*. It is in fact
firing **inside** ruvector-postgres, on every call, permanently. Hybrid
search's vector-scored path is unreachable code today and the fallback is
the only path that ever runs.

Also worth recording: `:latest` and `:2.0.5` resolve to the **same image
id** (`7fb09d439d82`) — so `latest` is current, not stale, and the image's
`2.0.5` version is the *distribution* version while the extension inside
is `ruvector 0.3.0`. Those two numbers are not the same thing, which is
easy to misread. **Pin `:2.0.5`** in `docker-compose.yml` anyway: a silent
change under `latest` would be very hard to diagnose, and the tag costs
nothing to set.

**The write path was broken too, and that is the root cause.**
`app/src/lib/import/embedding-generator.ts` built its INSERT around the same
unavailable or miscalled function, and its bare `catch {}` counted each
failure in `errors` without reporting it. Affected imports wrote no
`profile_embeddings` rows. The search side then degraded silently.

**Fixed 2026-09-19** in both call sites, by embedding in Node with the model
the app already ships (`@huggingface/transformers`,
`Xenova/all-MiniLM-L6-v2`, mean-pooled, normalized — the same settings that
produce stored vectors) and binding the result as `$n::ruvector`:

- `lib/embeddings/generator.ts` — added exported `embedText` / `embedTexts`
  and `toRuvectorLiteral`.
- `contacts/hybrid-search/route.ts` — query vector computed in Node; the
  catch-all `message.includes('function')` fallback narrowed to the vector
  side only, so real errors surface instead of being disguised as results.
- `lib/import/embedding-generator.ts` — batch-embeds, and reports the first
  failure of each kind rather than swallowing every one.

Verified: `tsc --noEmit` clean, the full suite green (117 suites, 984
tests), and the bound-parameter form exercised against a live
`ruvector-postgres` container — `$1::ruvector` with `<=>` returns 1.0 for an
identical vector and 0 for an orthogonal one. `profile_embeddings.embedding`
is `RUVECTOR(384)`, matching the model, with an HNSW `ruvector_cosine_ops`
index that the `<=>` ordering uses.

### The native-vs-container decision, recorded

**Both services run in Docker.** The db has no alternative (finding 1).
The app *could* be native, and the temptation is real — `npm ci` plus
`next build` on 4 vCPU is slow, and a container build adds a layer on top
of that — but going native buys a faster inner loop at the cost of a
second Node installation, a second supervision mechanism, and a host that
no longer matches what ADR-037's `publicist init` ships to other
operators. Keep the host identical to the artifact.

For fast iteration, use the `dev` stage that `app/Dockerfile` already
defines (`target: dev`, `next dev` with a bind mount) rather than
rebuilding the `runner` image on every change.

### Phase 1 — Provision the host

- Docker Engine + compose plugin, `data-root` on `/home/ruv/docker`.
- `git clone` into `/home/ruv/dev/network-navigator`. The repo is private
  (`weave-logic-ai/network-navigator`); the deploy credential comes from the
  ruOS secrets vault (`secret_store`), never from a file in the repo and
  never pasted into a `desktop_exec` command line — those are audited to
  disk in cleartext.
- Long steps run detached with output to `/home/ruv/logs/`, polled across
  calls — `docker compose build` will exceed the 300 s ceiling on 4 vCPU.
  Note `app/Dockerfile` uses `npm ci --legacy-peer-deps`; the flag is not
  optional.
- Pull `ruvnet/ruvector-postgres:latest` as its own step and confirm it
  before building anything, since nothing else works without it.

### Phase 2 — Secrets

`.env` is assembled on the desktop from the ruOS vault. Nothing sensitive
is typed into `desktop_exec`, because `~/.ruos/activity/` retains the
command text.

Required: `POSTGRES_PASSWORD`, and `CRON_SECRET` if any ingestion schedule
is to work at all (cron auth fails closed without it). Needed for the
editorial engine: `ANTHROPIC_API_KEY`. For enrichment: `PDL_API_KEY`,
`APOLLO_API_KEY`, `LUSHA_API_KEY`, `THEIRSTACK_API_KEY`.

`docker compose up -d`, then confirm `GET :3750/api/health` returns
`{"status":"ok"}` with a real `version` from `schema_versions`.

**Apply migrations by hand.** `data/db/init/` runs only on first database
init. Anything added after the volume exists — including the ADR-036
editorial migrations and `048-seed-impulse-handlers.sql` — must be applied
explicitly, using the command documented in the header of `048`.

### Phase 3 — Survive the auto-stop: BUILT AND TESTED

`scripts/ruos-bootstrap.sh` in this repo is the per-boot re-provisioner,
deployed to `/home/ruv/bootstrap.sh` on the desktop (md5
`81db630a137c49f1e9ab6e239a1b4eb0`, 150 lines). It is idempotent, so it
serves as both boot step and heartbeat, and exits non-zero on failure so a
schedule surfaces the problem.

What it does, each step a no-op when already satisfied:

1. Static Docker binaries under `/home/ruv/opt/docker` — downloads the
   pinned tarball if absent.
2. Compose plugin at `/home/ruv/.docker/cli-plugins/docker-compose` —
   **the static Docker tarball does not include compose**, only
   dockerd/docker/containerd/runc/docker-proxy, so it is fetched separately.
3. Starts `dockerd` if not running, waits for the socket, and chowns the
   socket to `ruv` so the CLI needs no `sudo` afterwards.
4. `docker compose up -d` in the repo (skipped with `--no-stack`).
5. Polls `/api/health` and reports the body.

**One trap worth keeping in the file.** The first version failed from a
cold boot with `dockerd` dying instantly and nothing in its log:

```
invalid userland-proxy-path: userland-proxy is enabled,
but userland-proxy-path is not set
```

`sudo` resets `PATH` via `secure_path`, so the daemon could not find its
sibling helpers — `containerd`, `runc`, `docker-proxy` — which ship in the
same tarball. An interactive start that sets `PATH` inline works and hides
this; a script that merely exports `PATH` does not. The script now sets
`PATH` for the daemon *and* passes `--userland-proxy-path` explicitly, and
prints the tail of `dockerd.log` on failure so the next failure explains
itself.

**Verified on a real stop/start cycle (2026-09-19):**

| | |
|---|---|
| Static binaries after reboot | survived (on the volume) |
| Compose plugin after reboot | survived |
| Image cache after reboot | survived — both `ruvector-postgres` tags intact |
| `dockerd` after reboot | not running, as expected |
| Bootstrap from cold | **daemon up in ~1 s, exit 0** |
| Re-run while healthy | no-op, exit 0 |

**Schedule:** ruOS task `941f7bd1c25c1a0a9cce81e0b2749fce`, "network-navigator
bootstrap", `0 6-22 * * *` America/Toronto, target `shell`, enabled.
Test-fired via `schedule_run_now` — `last_status: ok`. It currently runs
with `--no-stack` because the repo is not cloned on the desktop yet; **drop
that flag once Phase 1 lands**, or the stack will never be started by the
schedule.

Note the platform's `min_interval_secs` is 300, so five minutes is the
floor for any ruOS schedule.

### Phase 3b — Container-level durability

A weekday 23:00 America/Toronto auto-stop applies to this desktop, and
idle autosleep may stop it sooner. Therefore:

- Every container gets `restart: unless-stopped` in `docker-compose.yml`.
- A boot hook brings the stack up on start, rather than expecting it to
  already be running.
- `desktop_keepawake` holds the machine up for a long job; it does not
  override the 23:00 stop. Schedule nothing across that boundary.
- Postgres data lives in a bind mount under `/home/ruv`, never in a
  container layer.
- After each start, verify health before treating the instance as live.
  `ready: true` from `desktop_status` is a provisioning flag and proves
  nothing about the stack — `last_heartbeat_at` is liveness for the
  machine, `/api/health` for the application.

### Phase 4 — Schedules

ruOS `schedule_create` drives the unattended half. All times
America/Toronto, all inside the wake window:

| Job | Cadence | Calls | Auth |
|---|---|---|---|
| RSS poll | every 4 h, 06:00–22:00 | `POST /api/sources/cron/rss-poll` | `X-Cron-Secret` |
| Google News refresh | daily 06:30 | `POST /api/sources/cron/google-news-refresh` | `X-Cron-Secret` |
| News sweep | daily 07:00 | `POST /api/sources/cron/news-sweep` | `X-Cron-Secret` |
| Podcast refresh | daily 08:00 | `POST /api/sources/cron/podcast-refresh` | `X-Cron-Secret` |
| Blog discovery | weekly Mon 09:00 | `POST /api/sources/cron/blog-discovery` | `X-Cron-Secret` |
| Parser roll-up | daily 04:00 | `POST /api/sources/cron/parser-rollup` | `X-Cron-Secret` |
| Scoring run | daily 05:30 | `POST /api/scoring/run` | none today |
| Graph metrics + communities | daily 06:00 | `POST /api/graph/compute` | none today |
| Goal tick (background pool) | every 2 h | `POST /api/goals/tick` | none today |
| Idea generation | daily 07:00 | editorial endpoint, ADR-036 | — |
| Draft generation | daily 07:30 | LLM, budget-capped | — |
| Health check | hourly | `GET /api/health` | none |

Notes that matter for wiring this up:

- The `sources/cron/*` family is the real ingestion surface — there is no
  single `/api/sources/ingest`. Each is `POST`, each requires
  `X-Cron-Secret` matched timing-safely against `CRON_SECRET`
  (`app/src/lib/sources/cron-auth.ts`), and each **fails closed when
  `CRON_SECRET` is unset**. Put `CRON_SECRET` in the ruOS vault and set it
  in `.env`, or every ingestion schedule silently 401s.
- `parser-rollup` additionally 404s unless `RESEARCH_FLAGS.parserTelemetry`
  is on. A schedule against a flag-gated route returns 404, not an error —
  check the response body, not just reachability.
- `scoring/run`, `graph/compute` and `goals/tick` carry **no auth at all**
  today. That is tolerable while the instance binds to localhost; it is not
  tolerable the moment the port is reachable. ADR-037's client-token work
  is the fix, and until it lands the app must not be exposed beyond
  loopback.

Two disciplines: everything touching a paid API respects
`budget_periods` (`012-budget-schema.sql`) — the scheduler must never be
the reason a budget is blown; and every scheduled run writes to
`analytics_events` so `activity_search` can answer "what did it do last
night".

### Phase 5 — The browser half

Load the built extension into the ruOS desktop's Chrome, sign into
LinkedIn once in that persistent profile, and point the extension at
`http://localhost:3750` with a token minted from `extension_tokens`.

Then capture sessions on the ruOS desktop are a `desktop_control` session
the operator drives — same human-in-the-loop posture as on a laptop, with
the advantage that the instance and the browser are on the same host and
`connect-src 'self' http://localhost:*` in the extension CSP is satisfied
without tunnelling.

`desktop_share` gives a view-only link for watching a run; `clip_record`
captures one for a demo. Neither grants control.

---

## Open items

- [x] **Phase 0 persistence result** — recorded above: root layer is
      ephemeral, only `/home/ruv` survives.
- [x] **Docker viability on this host** — validated end to end, including a
      live `ruvector-postgres` container.
- [x] **Bootstrap script + schedule** — `scripts/ruos-bootstrap.sh`,
      deployed and green on a real reboot; ruOS schedule created and
      test-fired.
- [x] **`ruvector_embed` defect** — fixed in both call sites; see Phase 0c.
- [ ] Drop `--no-stack` from the ruOS schedule once the repo is cloned
      (Phase 1), otherwise the schedule never starts the stack.
- [ ] Pin the `ruvnet/ruvector-postgres` tag in `docker-compose.yml`.
- [ ] Decide whether `profile_embeddings` needs a backfill run
      (`/api/admin/reindex`) — with the write path broken, existing rows are
      likely absent rather than merely stale.
- [ ] Disk headroom after a full build. 19 G should hold it; measure
      rather than assume, and measure again once `content_performance`
      has been accumulating (ADR-036 flags it as the fastest-growing
      table, with no retention policy yet decided).
- [ ] Whether the docs site (port 3001) is worth running here at all, or
      is purely a local dev concern.
- [ ] Backup path for the Postgres volume. A desktop is not a backup, and
      `desktop_delete` is irreversible.
- [ ] Whether `ruvector.db` already in `/home/ruv` is related to this
      project or unrelated — do not collide with it.
