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
# Edit .env with your credentials
```

Required variables:

| Variable | Required | Description |
|----------|----------|-------------|
| `POSTGRES_PASSWORD` | Yes | Database password |
| `POSTGRES_USER` | No | Database user (default: `navigator`) |
| `POSTGRES_DB` | No | Database name (default: `navigator`) |
| `LEGACY_IMPORT_DIRS` | No | Colon-separated directories the import routes may read (default: `/data/`) |
| `ANTHROPIC_API_KEY` | No | For AI-powered outreach and message generation |
| `PDL_API_KEY` | No | PeopleDataLabs enrichment |
| `APOLLO_API_KEY` | No | Apollo.io enrichment |
| `LUSHA_API_KEY` | No | Lusha enrichment |
| `THEIRSTACK_API_KEY` | No | TheirStack enrichment |

#### Upgrading from an older install

Earlier releases used a different default for the database user and name. To keep an
existing database, set `POSTGRES_USER` and `POSTGRES_DB` in `.env` to the values it was
created with (check `docker inspect` on your old db container, or your previous `.env`).
Container names are now `network-navigator-db` and `network-navigator-app`, so update any
scripts that call `docker exec` on the old names.

### 3. Start services

```bash
docker compose up -d
```

This starts the database (with automatic schema initialization) and the app. The app waits for the database health check to pass before starting.

- **App**: http://localhost:3750
- **API health check**: http://localhost:3750/api/health

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
cd app
npm install
npm run dev
```

Make sure the database is running (`docker compose up db -d`) and `DATABASE_URL` in `.env` points to `localhost:5432`.

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

Load the `browser/dist/` directory as an unpacked extension in Chrome (`chrome://extensions` > Developer mode > Load unpacked).

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
