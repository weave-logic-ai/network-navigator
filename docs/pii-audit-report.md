# PII / Security Audit Report

**System**: LinkedIn Network Intelligence Platform (linkedin-prospector skill)
**Audit Date**: 2026-03-10
**Auditor**: Claude PII/Security Audit Specialist
**Last Updated**: 2026-03-10

---

## CORRECTION NOTICE (2026-03-10)

**This audit was originally performed against the WRONG copy of the codebase.** The audit scope was `~/.claude/skills/linkedin-prospector/scripts/` (the outdated copy with 5 scripts). The CANONICAL codebase at `/home/aepod/dev/ctox/.claude/linkedin-prospector/` has **already remediated** the most critical PII issues:

### Status of Original Findings Against Canonical Copy

| Finding | Original Status | Canonical Status |
|---------|----------------|-----------------|
| CRIT-01: Spreadsheet ID in lib.mjs | OPEN | **RESOLVED** -- canonical lib.mjs uses `process.env` |
| CRIT-02: GCP Project ID in lib.mjs | OPEN | **RESOLVED** -- not present in canonical lib.mjs |
| CRIT-03: Hardcoded /home/aepod/ paths | OPEN | **RESOLVED** -- uses `resolve(__dirname, ...)` |
| CRIT-04: Credential file paths | OPEN | **RESOLVED** -- not present in canonical lib.mjs |
| HIGH-01: contacts.json data | OPEN | **STILL OPEN** -- data files need separation from skill dir |
| HIGH-02: Real name in sheets.mjs | OPEN | **N/A** -- sheets.mjs not yet ported to canonical location |
| .sparc docs PII | OPEN | **RESOLVED** (2026-03-10) -- all counts/paths replaced with placeholders |

### Remaining PII Concerns (Canonical Copy)

1. **contacts.json** (951KB) still lives inside the skill directory -- needs separation to project data dir
2. **graph.json** (2.8MB) contains scored contact data -- same concern
3. **network-report.html** (376KB) contains rendered contact names -- same concern
4. **Old copy at `~/.claude/skills/linkedin-prospector/`** still exists with PII (marked DEPRECATED)

---

## ORIGINAL AUDIT (against outdated copy -- preserved for reference)

**Original Scope**: All scripts in `~/.claude/skills/linkedin-prospector/scripts/`, data files, and `.sparc/` documentation

The linkedin-prospector codebase (outdated copy) contains **16 confirmed PII/security leaks** across 11 files. The most critical issues are:

1. **Hardcoded Google Cloud project identifiers and spreadsheet IDs** exposing infrastructure to enumeration attacks
2. **Hardcoded absolute paths** revealing the system username, directory structure, and OS configuration
3. **A 929KB contacts.json file** containing real names, job titles, LinkedIn URLs, locations, and employer data for 897+ real individuals
4. **Credential file paths hardcoded in source** pointing to OAuth tokens and GCP Application Default Credentials
5. **A real person's name hardcoded in a code comment** (sheets.mjs line 155)

The codebase was designed as a local-only tool but several design choices make it dangerous to share, commit to version control, or deploy in any shared environment.

---

## Leak Inventory

### CRITICAL Severity

#### CRIT-01: Google Spreadsheet ID Hardcoded in `lib.mjs`

**File**: `/home/aepod/.claude/skills/linkedin-prospector/scripts/lib.mjs`
**Line**: 12
**Type**: Infrastructure credential / resource identifier

```javascript
// BEFORE (current)
export const SPREADSHEET_ID = '1kWFoIdLMUafX5fByAGM_APqPfsqW1loBj6LEkE_UNGg';
```

**Risk**: Anyone with this ID can attempt to access the spreadsheet. Combined with the project ID (CRIT-02), this provides enough information to target the Google Cloud project. The spreadsheet contains all contact scoring data pushed by `sheets.mjs`.

**Remediation**:
```javascript
// AFTER
export const SPREADSHEET_ID = process.env.GOOGLE_SPREADSHEET_ID || '';
```

Add to a `.env` file (never committed):
```
GOOGLE_SPREADSHEET_ID=1kWFoIdLMUafX5fByAGM_APqPfsqW1loBj6LEkE_UNGg
```

---

#### CRIT-02: Google Cloud Project ID Hardcoded in `lib.mjs`

**File**: `/home/aepod/.claude/skills/linkedin-prospector/scripts/lib.mjs`
**Line**: 13

```javascript
// BEFORE
export const PROJECT = 'api-project-964252417605';
```

**Risk**: The project ID `api-project-964252417605` is a real GCP project identifier. Combined with the spreadsheet ID, this reveals the full API surface. Found also in gcloud logs at `/home/aepod/.config/gcloud/logs/`.

**Remediation**:
```javascript
// AFTER
export const PROJECT = process.env.GOOGLE_CLOUD_PROJECT || '';
```

Add to `.env`:
```
GOOGLE_CLOUD_PROJECT=api-project-964252417605
```

---

#### CRIT-03: OAuth Token File Path Hardcoded in `lib.mjs`

**File**: `/home/aepod/.claude/skills/linkedin-prospector/scripts/lib.mjs`
**Line**: 10

```javascript
// BEFORE
export const TOKEN_FILE = '/home/aepod/dev/ctox/scripts/.sheets-token.json';
```

**Risk**: This reveals (a) the system username `aepod`, (b) the project path, and (c) the location of an OAuth token file containing `access_token`, `refresh_token`, `client_id`, and `client_secret` (as shown by the `getGoogleToken()` function on lines 45-62). If `.sheets-token.json` is committed, it constitutes a full credential leak.

**Remediation**:
```javascript
// AFTER
import { resolve } from 'path';
export const TOKEN_FILE = process.env.SHEETS_TOKEN_FILE
  || resolve(__dirname, '..', '.sheets-token.json');
```

---

#### CRIT-04: GCP Application Default Credentials Path in `lib.mjs`

**File**: `/home/aepod/.claude/skills/linkedin-prospector/scripts/lib.mjs`
**Line**: 11

```javascript
// BEFORE
export const ADC_FILE = '/home/aepod/.config/gcloud/application_default_credentials.json';
```

**Risk**: This file contains `client_id`, `client_secret`, and `refresh_token` for the entire GCP project. The `getGoogleToken()` function on line 47 reads both `client_id` and `client_secret` from this file. Hardcoding the path reveals the user's home directory and signals to an attacker exactly where to find the credentials.

**Remediation**:
```javascript
// AFTER
import { homedir } from 'os';
export const ADC_FILE = process.env.GOOGLE_APPLICATION_CREDENTIALS
  || resolve(homedir(), '.config', 'gcloud', 'application_default_credentials.json');
```

---

#### CRIT-05: contacts.json Contains PII of 897+ Real People

**File**: `/home/aepod/.claude/skills/linkedin-prospector/data/contacts.json`
**Size**: 929.6 KB
**Records**: 897+ contacts

**Data fields per contact**:
- `name` / `enrichedName` (real full names, e.g., "Katie HOLLER", "Rob Thomas", "Chuck (Charles) Choukalos")
- `profileUrl` (real LinkedIn URLs, e.g., `https://www.linkedin.com/in/katieholler/`)
- `headline` (job titles and employer information)
- `enrichedLocation` (city-level location, e.g., "New York City Metropolitan Area", "Danville, California")
- `currentRole` / `currentCompany` (employer and position details)
- `about` (personal profile text scraped from LinkedIn)
- `mutualConnections` (network relationship data)
- `searchTerms` (reveals the searcher's intent and targeting criteria)

**Risk**: This is a personal data store containing names, locations, employer details, professional summaries, and network topology of nearly 900 real people. Under GDPR, CCPA, and similar privacy regulations, this constitutes personal data processing. If committed to a repository or shared, it constitutes a mass PII disclosure.

**Remediation**:
1. **Immediate**: Ensure `contacts.json` is in `.gitignore`
2. **Short-term**: Move the data directory outside the project tree to a path like `~/.linkedin-prospector-data/`
3. **Long-term**: Implement data-at-rest encryption for the contacts store
4. Add a `data/.gitignore` with:
```
contacts.json
graph.json
network-report.html
cache/
snapshots/
*.token.json
```

---

### HIGH Severity

#### HIGH-01: Hardcoded Absolute Path for Playwright Browser Data in `lib.mjs`

**File**: `/home/aepod/.claude/skills/linkedin-prospector/scripts/lib.mjs`
**Line**: 9

```javascript
// BEFORE
export const USER_DATA_DIR = '/home/aepod/dev/ctox/.browser-data';
```

**Risk**: The `.browser-data/` directory contains a full Playwright persistent browser context with LinkedIn session cookies, localStorage data, and browsing history. Exposing this path tells an attacker exactly where to find an authenticated LinkedIn session.

**Remediation**:
```javascript
// AFTER
export const USER_DATA_DIR = process.env.BROWSER_DATA_DIR
  || resolve(__dirname, '..', '.browser-data');
```

---

#### HIGH-02: Hardcoded `createRequire` Path in `lib.mjs`

**File**: `/home/aepod/.claude/skills/linkedin-prospector/scripts/lib.mjs`
**Line**: 5

```javascript
// BEFORE
const require = createRequire('/home/aepod/dev/ctox/package.json');
```

**Risk**: Reveals the full filesystem path and ties the code to a specific machine. This will also break on any other system.

**Remediation**:
```javascript
// AFTER
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(resolve(__dirname, '..', '..', '..', '..', 'package.json'));
```

Or better, determine the project root dynamically:
```javascript
// Walk up from scripts dir to find nearest package.json
import { existsSync } from 'fs';
function findProjectRoot(startDir) {
  let dir = startDir;
  while (dir !== '/') {
    if (existsSync(resolve(dir, 'package.json'))) return dir;
    dir = dirname(dir);
  }
  throw new Error('Could not find package.json');
}
const projectRoot = findProjectRoot(__dirname);
const require = createRequire(resolve(projectRoot, 'package.json'));
```

---

#### HIGH-03: Hardcoded Seed File Path in `db.mjs`

**File**: `/home/aepod/.claude/skills/linkedin-prospector/scripts/db.mjs`
**Line**: 271

```javascript
// BEFORE
const file = args.file || '/home/aepod/dev/ctox/scripts/linkedin-enriched.json';
```

**Risk**: Reveals the username and project path. The file `linkedin-enriched.json` likely contains a bulk export of enriched LinkedIn contact data -- another PII data source.

**Remediation**:
```javascript
// AFTER
const DEFAULT_SEED_FILE = resolve(__dirname, '..', '..', '..', '..', 'scripts', 'linkedin-enriched.json');
const file = args.file || DEFAULT_SEED_FILE;
```

Or, remove the default entirely and require explicit `--file` argument:
```javascript
// AFTER (safer)
const file = args.file;
if (!file) {
  console.error('Usage: node db.mjs seed --file <path>');
  process.exit(1);
}
```

---

#### HIGH-04: Google Sheets URL Hardcoded in `sheets.mjs`

**File**: `/home/aepod/.claude/skills/linkedin-prospector/scripts/sheets.mjs`
**Line**: 173

```javascript
// BEFORE
console.log(`Sheet: https://docs.google.com/spreadsheets/d/1kWFoIdLMUafX5fByAGM_APqPfsqW1loBj6LEkE_UNGg`);
```

**Risk**: This is a convenience log message but it duplicates the spreadsheet ID exposure from CRIT-01 and provides a directly clickable URL. If captured in logs, CI output, or terminal recordings, it provides direct access to the spreadsheet.

**Remediation**:
```javascript
// AFTER
import { SPREADSHEET_ID } from './lib.mjs';
console.log(`Sheet: https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}`);
```

---

#### HIGH-05: Real Person's Name Hardcoded in Code Comment in `sheets.mjs`

**File**: `/home/aepod/.claude/skills/linkedin-prospector/scripts/sheets.mjs`
**Line**: 155

```javascript
// BEFORE
// Clear rows 5+ (preserve row 4 = Jason Magnuson)
```

**Risk**: This comment hardcodes a real person's name ("Jason Magnuson") in the source code, tying them to a specific row in the spreadsheet and revealing they are a data subject in this system. This name also appears in `contacts.json`.

**Remediation**:
```javascript
// AFTER
// Clear rows 5+ (preserve header and pinned rows)
```

---

### MEDIUM Severity

#### MED-01: `.sparc/specification.md` Contains Hardcoded Path

**File**: `/home/aepod/dev/ctox/.sparc/specification.md`
**Line**: 1123

```markdown
All paths relative to the skill root `/home/aepod/dev/ctox/.claude/linkedin-prospector/skills/linkedin-prospector/`:
```

**Risk**: Reveals the full filesystem path with username in documentation that may be committed to version control.

**Remediation**: Replace with a relative or generic reference:
```markdown
All paths relative to the skill root `<project-root>/.claude/linkedin-prospector/skills/linkedin-prospector/`:
```

---

#### MED-02: `.sparc/refinement.md` Contains Hardcoded Path

**File**: `/home/aepod/dev/ctox/.sparc/refinement.md`
**Line**: 1569

```markdown
All paths are relative to the skill root `/home/aepod/dev/ctox/.claude/linkedin-prospector/skills/linkedin-prospector/`.
```

**Risk**: Same as MED-01.

**Remediation**: Replace with:
```markdown
All paths are relative to the skill root `<project-root>/.claude/linkedin-prospector/skills/linkedin-prospector/`.
```

---

#### MED-03: Multiple `.sparc` Docs Reference "928 contacts, 1858 edges"

**Files**: All 6 `.sparc/` documents
**Occurrences**: 20+ across specification.md, architecture.md, pseudocode.md, refinement.md, completion.md, orchestration.md

**Risk**: While not PII by itself, these exact counts serve as fingerprinting data. Combined with the other leaks, they confirm the dataset size and could be used to verify unauthorized access to the data.

**Remediation**: Replace specific counts with parameterized references:
```markdown
// BEFORE
Given graph.json contains 928 contacts with behavioral scores

// AFTER
Given graph.json contains N contacts with behavioral scores
```

Or simply note "these values reflect the dataset at time of writing" and accept the risk as LOW since the counts alone do not identify individuals.

---

#### MED-04: OAuth Token Refresh Logic Writes Token to Disk in `lib.mjs`

**File**: `/home/aepod/.claude/skills/linkedin-prospector/scripts/lib.mjs`
**Lines**: 45-62

```javascript
export async function getGoogleToken() {
  const tokenData = JSON.parse(readFileSync(TOKEN_FILE, 'utf-8'));
  const creds = JSON.parse(readFileSync(ADC_FILE, 'utf-8'));
  const body = new URLSearchParams({
    client_id: creds.client_id,
    client_secret: creds.client_secret,
    refresh_token: tokenData.refresh_token,
    grant_type: 'refresh_token',
  });
  // ...
  writeFileSync(TOKEN_FILE, JSON.stringify(tokenData, null, 2));
}
```

**Risk**: This function reads `client_secret` from the ADC file and `refresh_token` from the token file, then writes the refreshed `access_token` back to disk in plaintext JSON. If either file is committed or the disk is accessed, all credentials are exposed. The token refresh cycle also means the token file is frequently updated, increasing the window where it might be captured in a git diff.

**Remediation**:
1. Use the `google-auth-library` package instead of manual OAuth flow
2. Store tokens in the OS keychain (e.g., `keytar` package)
3. At minimum, ensure `.sheets-token.json` is in `.gitignore` and the file permissions are `600`
4. Never read `client_secret` from the ADC file directly -- use `gcloud auth application-default print-access-token` instead

---

### LOW Severity

#### LOW-01: LinkedIn URLs in `.sparc/` Documentation Are Test Fixtures (Not Real PII)

**Files**: `.sparc/refinement.md`, `.sparc/specification.md`
**Occurrences**: Multiple lines (e.g., `https://linkedin.com/in/test-agency-owner`)

**Risk**: These are synthetic test fixture URLs (e.g., `test-agency-owner`, `test-warm-friend`, `alice`, `bob`). They do not map to real people. No remediation needed.

**Status**: ACCEPTABLE

---

## Data Separation Analysis

The core architectural issue is that **data and code are co-located** in the same directory tree, and the code contains hardcoded references to the data's location.

### Current State

```
linkedin-prospector/
  scripts/          <-- Code (shareable)
    lib.mjs         <-- Contains hardcoded paths to sensitive files
    sheets.mjs      <-- Contains hardcoded spreadsheet URL
    db.mjs          <-- Contains hardcoded seed file path
  data/             <-- PII Data (NEVER shareable)
    contacts.json   <-- 897+ real people
    graph.json      <-- Scored network with full PII
    network-report.html  <-- Interactive dashboard with PII
    cache/          <-- Cached LinkedIn HTML pages
```

### Recommended State

```
linkedin-prospector/
  scripts/              <-- Code (shareable, no hardcoded paths)
    lib.mjs             <-- Reads all paths from env vars or config
    sheets.mjs          <-- References SPREADSHEET_ID from lib.mjs
    db.mjs              <-- No default seed path
  config/
    .env.example        <-- Template showing required env vars
  data/                 <-- In .gitignore
    .gitignore          <-- Ignores everything in this directory

~/.linkedin-prospector/     <-- User-local data directory
  contacts.json
  graph.json
  network-report.html
  cache/
  .sheets-token.json
  .browser-data/
```

---

## Remediation Priority Matrix

| ID | Severity | File | Issue | Fix Type | Effort |
|----|----------|------|-------|----------|--------|
| CRIT-01 | CRITICAL | lib.mjs:12 | Hardcoded spreadsheet ID | Env var | 5 min |
| CRIT-02 | CRITICAL | lib.mjs:13 | Hardcoded GCP project ID | Env var | 5 min |
| CRIT-03 | CRITICAL | lib.mjs:10 | Hardcoded token file path | Env var + relative path | 10 min |
| CRIT-04 | CRITICAL | lib.mjs:11 | Hardcoded ADC file path | Env var + os.homedir() | 10 min |
| CRIT-05 | CRITICAL | contacts.json | 897+ real people's PII | .gitignore + data separation | 30 min |
| HIGH-01 | HIGH | lib.mjs:9 | Hardcoded browser data path | Env var + relative path | 5 min |
| HIGH-02 | HIGH | lib.mjs:5 | Hardcoded createRequire path | Dynamic resolution | 15 min |
| HIGH-03 | HIGH | db.mjs:271 | Hardcoded seed file path | Remove default / relative path | 5 min |
| HIGH-04 | HIGH | sheets.mjs:173 | Hardcoded Google Sheets URL | Reference SPREADSHEET_ID | 5 min |
| HIGH-05 | HIGH | sheets.mjs:155 | Real person's name in comment | Generic comment | 2 min |
| MED-01 | MEDIUM | specification.md:1123 | Hardcoded path in docs | Generic path | 2 min |
| MED-02 | MEDIUM | refinement.md:1569 | Hardcoded path in docs | Generic path | 2 min |
| MED-03 | MEDIUM | All .sparc docs | Dataset size fingerprinting | Parameterize or accept | 20 min |
| MED-04 | MEDIUM | lib.mjs:45-62 | Plaintext token refresh cycle | Use auth library | 2 hrs |

**Estimated total remediation time**: ~3.5 hours

---

## Comprehensive `lib.mjs` Rewrite

The most impactful single change is rewriting `lib.mjs` to eliminate all hardcoded paths and credentials. Here is the complete before/after:

### Before (current `lib.mjs`, 110 lines)

```javascript
import { createRequire } from 'module';
import { readFileSync, writeFileSync } from 'fs';

// Resolve playwright from the project's node_modules
const require = createRequire('/home/aepod/dev/ctox/package.json');
const { chromium } = require('playwright');

// Paths
export const USER_DATA_DIR = '/home/aepod/dev/ctox/.browser-data';
export const TOKEN_FILE = '/home/aepod/dev/ctox/scripts/.sheets-token.json';
export const ADC_FILE = '/home/aepod/.config/gcloud/application_default_credentials.json';
export const SPREADSHEET_ID = '1kWFoIdLMUafX5fByAGM_APqPfsqW1loBj6LEkE_UNGg';
export const PROJECT = 'api-project-964252417605';
```

### After (remediated `lib.mjs`)

```javascript
import { createRequire } from 'module';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Dynamically find the nearest package.json for playwright resolution
function findPackageJson(startDir) {
  let dir = startDir;
  while (dir !== '/' && dir !== '.') {
    const candidate = resolve(dir, 'package.json');
    if (existsSync(candidate)) return candidate;
    dir = dirname(dir);
  }
  throw new Error('Could not find package.json from ' + startDir);
}

const require = createRequire(findPackageJson(__dirname));
const { chromium } = require('playwright');

// Paths -- all configurable via environment variables
export const USER_DATA_DIR = process.env.BROWSER_DATA_DIR
  || resolve(__dirname, '..', '.browser-data');

export const TOKEN_FILE = process.env.SHEETS_TOKEN_FILE
  || resolve(__dirname, '..', '.sheets-token.json');

export const ADC_FILE = process.env.GOOGLE_APPLICATION_CREDENTIALS
  || resolve(homedir(), '.config', 'gcloud', 'application_default_credentials.json');

export const SPREADSHEET_ID = process.env.GOOGLE_SPREADSHEET_ID || '';
export const PROJECT = process.env.GOOGLE_CLOUD_PROJECT || '';
```

---

## `.env.example` Template

Create this file at the skill root for documentation purposes (never commit `.env` itself):

```bash
# Google Cloud / Sheets Integration
GOOGLE_SPREADSHEET_ID=your-spreadsheet-id-here
GOOGLE_CLOUD_PROJECT=your-gcp-project-id-here
GOOGLE_APPLICATION_CREDENTIALS=/path/to/application_default_credentials.json
SHEETS_TOKEN_FILE=/path/to/.sheets-token.json

# Browser Automation
BROWSER_DATA_DIR=/path/to/.browser-data

# Data Directory (optional -- defaults to ../data relative to scripts/)
DATA_DIR=/path/to/data-directory
```

---

## `.gitignore` Additions

Ensure the following entries exist in the project's `.gitignore`:

```gitignore
# PII data files -- NEVER commit
**/contacts.json
**/graph.json
**/network-report.html
**/linkedin-enriched.json
**/cache/
**/snapshots/

# Credentials and tokens -- NEVER commit
**/.sheets-token.json
**/.browser-data/
**/application_default_credentials.json
.env

# Skill data directory
.claude/skills/*/data/
```

---

## Verification Checklist

After applying all remediations, verify:

- [ ] `grep -r '/home/aepod' scripts/` returns zero results
- [ ] `grep -r 'api-project-964252417605' scripts/` returns zero results
- [ ] `grep -r '1kWFoIdLMUafX5fByAGM' scripts/` returns zero results
- [ ] `grep -r 'Jason Magnuson' scripts/` returns zero results
- [ ] `contacts.json` is listed in `.gitignore`
- [ ] `.sheets-token.json` is listed in `.gitignore`
- [ ] `.browser-data/` is listed in `.gitignore`
- [ ] `lib.mjs` reads all sensitive values from environment variables
- [ ] `lib.mjs` uses `__dirname`-relative paths as fallbacks (no absolute paths)
- [ ] `db.mjs seed` command requires explicit `--file` argument
- [ ] `.sparc/` docs use generic path references instead of `/home/aepod/`
- [ ] No credential files exist in the git staging area (`git status`)
- [ ] `.env.example` exists with placeholder values (not real credentials)

---

## Appendix: Files Audited

| File | Path | Lines | PII Issues Found |
|------|------|-------|-----------------|
| lib.mjs | `~/.claude/skills/linkedin-prospector/scripts/lib.mjs` | 110 | 6 (CRIT-01 through CRIT-04, HIGH-01, HIGH-02) |
| db.mjs | `~/.claude/skills/linkedin-prospector/scripts/db.mjs` | 293 | 1 (HIGH-03) |
| search.mjs | `~/.claude/skills/linkedin-prospector/scripts/search.mjs` | 398 | 0 |
| enrich.mjs | `~/.claude/skills/linkedin-prospector/scripts/enrich.mjs` | 136 | 0 |
| sheets.mjs | `~/.claude/skills/linkedin-prospector/scripts/sheets.mjs` | 190 | 2 (HIGH-04, HIGH-05) |
| contacts.json | `~/.claude/skills/linkedin-prospector/data/contacts.json` | ~10000+ | 1 (CRIT-05, entire file is PII) |
| specification.md | `/home/aepod/dev/ctox/.sparc/specification.md` | 1184 | 1 (MED-01) |
| architecture.md | `/home/aepod/dev/ctox/.sparc/architecture.md` | 1487 | 0 (paths are generic) |
| pseudocode.md | `/home/aepod/dev/ctox/.sparc/pseudocode.md` | 1528 | 0 |
| refinement.md | `/home/aepod/dev/ctox/.sparc/refinement.md` | 1611 | 1 (MED-02) |
| completion.md | `/home/aepod/dev/ctox/.sparc/completion.md` | 593 | 0 |
| orchestration.md | `/home/aepod/dev/ctox/.sparc/orchestration.md` | 784 | 0 |
