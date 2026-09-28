# Network Navigator

A professional networking intelligence platform that helps you analyze, enrich, and manage your LinkedIn connections. Includes a Next.js web dashboard, a Chrome browser extension for real-time LinkedIn data capture, and a PostgreSQL database with vector search.

## Features

- **Contact enrichment** via PeopleDataLabs, Apollo, Lusha, and TheirStack APIs
- **ICP (Ideal Customer Profile) scoring** with configurable verticals
- **Network graph visualization** and relationship mapping
- **AI-powered outreach** with message generation (Anthropic Claude)
- **Referral scoring** and behavioral analysis
- **Chrome extension** for capturing LinkedIn profile and connection data
- **Fumadocs documentation site** with guides and configuration reference

## Architecture

The project has three services orchestrated with Docker Compose:

| Service | Port | Description |
|---------|------|-------------|
| **app** | 3750 | Next.js web dashboard (contact management, enrichment, scoring, outreach) |
| **db** | 5432 | PostgreSQL with pgvector (32+ schema migrations, vector search, graph sync triggers) |
| **docs** | 3001 | Fumadocs documentation site (Next.js, KaTeX math support) |

Additional components:

- `browser/` — Chrome extension for LinkedIn data capture (esbuild, TypeScript, Manifest V3)
- `agent/` — Claude AI skill for prospecting automation
- `data/` — Runtime data directory (gitignored, Docker volume mounts)

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and Docker Compose
- [Node.js](https://nodejs.org/) 18+ (for local development)
- A `.env` file (see below)

## Quick Start

### 1. Clone the repository

```bash
git clone git@github.com:weave-logic-ai/network-navigator.git
cd network-navigator
```

### 2. Configure environment

```bash
cp .env.example .env
openssl rand -hex 32  # copy output into LOCAL_OPERATOR_SECRET in .env
# Set POSTGRES_PASSWORD in .env; keep .env out of Git.
```

Required variables:

| Variable | Required | Description |
|----------|----------|-------------|
| `POSTGRES_PASSWORD` | Yes | Database password |
| `LOCAL_OPERATOR_SECRET` | Yes | Local dashboard unlock secret; generate with `openssl rand -hex 32` |
| `EXTENSION_ALLOWED_ORIGINS` | For extension | Exact installed origin, `chrome-extension://` followed by the 32-letter ID shown in Chrome |
| `POSTGRES_USER` | No | Database user (default: `ctox`) |
| `POSTGRES_DB` | No | Database name (default: `ctox`) |
| `ANTHROPIC_API_KEY` | No | For AI-powered outreach and message generation |
| `PDL_API_KEY` | No | PeopleDataLabs enrichment |
| `APOLLO_API_KEY` | No | Apollo.io enrichment |
| `LUSHA_API_KEY` | No | Lusha enrichment |
| `THEIRSTACK_API_KEY` | No | TheirStack enrichment |

### 3. Start services

```bash
docker compose up -d
```

This starts the database (with automatic schema initialization) and the app. The app waits for the database health check to pass before starting.

- **App**: http://localhost:3750
- **API health check**: http://localhost:3750/api/health

Open http://localhost:3750/operator/unlock and enter the operator secret from
your local `.env` before using the dashboard. The app and database bind to
loopback for this local setup.

### 4. Start the docs site (optional)

```bash
cd docs
npm install
npm run dev
```

- **Docs**: http://localhost:3001

## Local Development

If you prefer running the app outside Docker:

```bash
docker compose up -d db
cd app
npm install
# Create the ignored app/.env.local as described below, then:
npm run dev
```

The root `.env` supplies Docker Compose, but Next.js launched from `app/`
loads `app/.env.local`, **not** the root file. Create `app/.env.local`
with values from your root `.env` (do not commit either file):

```dotenv
DATABASE_URL=postgresql://ctox:<POSTGRES_PASSWORD>@127.0.0.1:5432/ctox
LOCAL_OPERATOR_SECRET=<same secret as root .env>
EXTENSION_ALLOWED_ORIGINS=chrome-extension://<exact installed 32-letter extension ID>
```

If you changed `POSTGRES_USER` or `POSTGRES_DB`, use those values in
`DATABASE_URL`. Restart `npm run dev` after changing the secret or extension
origin. The direct development server listens on `http://localhost:3000` by
default; unlock at `http://localhost:3000/operator/unlock` before using it.
The extension popup must point at this same app URL when pairing to the direct
development server.

### Running tests

```bash
cd app
npm test
```

### Linting

```bash
cd app
npm run lint
```

### Building the Chrome extension

```bash
cd browser
npm install
npm run build
```

Load the `browser/` directory as an unpacked extension in Chrome
(`chrome://extensions` > Developer mode > Load unpacked). Copy the extension ID
shown there into `.env` as `EXTENSION_ALLOWED_ORIGINS=chrome-extension://<id>`;
the ID must match exactly. Run `docker compose up -d --force-recreate app` to
apply the environment change. Then unlock the dashboard, open its **Extension**
page, choose **Generate New Token**, and paste the full token into the extension
popup. The full token is displayed once; a listed prefix cannot reconnect.
If Chrome assigns a new ID after reinstalling, update the origin and recreate
the app container again. If you revoke or lose a token, generate a new one and
register it in the popup.

## Database

PostgreSQL with pgvector support. Schema is automatically applied on first run via init scripts in `data/db/init/`:

- `001-extensions.sql` through `019-referral-scoring-schema.sql`
- Includes vector embeddings, graph sync triggers, caching, and budget tracking schemas

To reset the database:

```bash
docker compose down -v   # removes volumes
docker compose up -d     # recreates with fresh schema
```

## Documentation

The `docs/` directory contains a [Fumadocs](https://fumadocs.vercel.app/) site with:

- Configuration guide
- LinkedIn prospector usage guide
- ICP vertical research reference

Build for production:

```bash
cd docs
npm run build
npm start
```

## Project Structure

```
.
├── app/                  # Next.js web application
│   ├── src/              # Application source code
│   ├── shared/           # Shared types and utilities
│   ├── Dockerfile        # Multi-stage Docker build
│   └── package.json
├── browser/              # Chrome extension (Manifest V3)
│   ├── src/              # Extension source code
│   ├── manifest.json
│   └── esbuild.config.mjs
├── data/
│   └── db/init/          # PostgreSQL schema migrations (001-019)
├── docs/                 # Fumadocs documentation site
│   ├── content/docs/     # MDX documentation pages
│   └── source.config.ts
├── agent/                # Claude AI prospecting skill
├── tests/                # Jest test suite
├── docker-compose.yml    # Service orchestration
└── .env.example          # Environment template
```

## License

Private — WeaveLogic AI
