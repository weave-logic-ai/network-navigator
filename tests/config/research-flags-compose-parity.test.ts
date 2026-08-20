// Guards against the exact failure class ADR-035 flagged: a RESEARCH_* flag
// read by application code that is never forwarded through docker-compose.yml
// (so setting it in .env silently does nothing), or a name that diverges by a
// single character between the two.
//
// SCOPE NOTE (widened 2026-08-20): this originally scanned ONLY
// research-flags.ts, and that was too narrow — it passed while FOUR flags went
// unforwarded, because they are read directly inside connector modules rather
// than through the central flag module: RESEARCH_CONNECTOR_RSS (rss.ts),
// RESEARCH_CONNECTOR_BLOG (corporate-blog.ts), RESEARCH_CONNECTOR_GOOGLE_NEWS
// (google-news.ts) and RESEARCH_RECENCY_MODIFIER (recency-modifier.ts). The
// last of those was introduced the same day by a different change, so a
// narrowly-scoped guard would have let a brand-new unreachable flag through on
// day one. It now walks all of app/src.
import { readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';

const COMPOSE_PATH = path.join(__dirname, '../../docker-compose.yml');
const APP_SRC = path.join(__dirname, '../../app/src');

function walkTsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === '.next') continue;
      walkTsFiles(full, out);
    } else if (/\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

// Scans ALL of app/src, not just research-flags.ts — see the SCOPE NOTE above.
function researchEnvVarsReadByCode(): Set<string> {
  const found = new Set<string>();
  for (const file of walkTsFiles(APP_SRC)) {
    const source = readFileSync(file, 'utf8');
    for (const m of source.matchAll(/process\.env\.(RESEARCH_[A-Z0-9_]+)/g)) {
      found.add(m[1]);
    }
  }
  return found;
}

function researchEnvVarsForwardedByCompose(): Set<string> {
  const source = readFileSync(COMPOSE_PATH, 'utf8');
  // Matches the `NAME: ${NAME:-false}` style used for every RESEARCH_* entry
  // in the app service's `environment:` block.
  const matches = source.matchAll(/^\s+(RESEARCH_[A-Z0-9_]+):\s*\$\{\1[:-]/gm);
  return new Set(Array.from(matches, (m) => m[1]));
}

describe('RESEARCH_* flag reachability (docker-compose.yml <-> research-flags.ts)', () => {
  it('forwards every RESEARCH_* var that research-flags.ts reads', () => {
    const readByCode = researchEnvVarsReadByCode();
    const forwarded = researchEnvVarsForwardedByCompose();

    const missing = Array.from(readByCode).filter((name) => !forwarded.has(name));

    expect(missing).toEqual([]);
  });

  it('does not forward a RESEARCH_* var research-flags.ts never reads (stale entry)', () => {
    const readByCode = researchEnvVarsReadByCode();
    const forwarded = researchEnvVarsForwardedByCompose();

    const stale = Array.from(forwarded).filter((name) => !readByCode.has(name));

    expect(stale).toEqual([]);
  });
});
