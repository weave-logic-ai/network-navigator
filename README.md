# NetworkNav

Client: weavelogic

## Overview

LinkedIn networking navigation and prospecting tool. Includes a Next.js web application, Chrome browser extension, and PostgreSQL database with Docker Compose orchestration.

## Architecture

- `app/` — Next.js application (run npm commands from here)
- `browser/` — Chrome extension
- `agent/` — Claude skill code
- `db/init/` — PostgreSQL schema init scripts
- `data/` — User data (gitignored)
- `tests/` — Test suite (jest)
- `docs/` — Documentation

## Setup

```bash
# Start services
docker compose up -d

# Install app dependencies
cd app && npm install

# Run dev server
npm run dev
```

## Development

```bash
cd app/

# Build
npm run build

# Test
npm test

# Lint
npm run lint
```
