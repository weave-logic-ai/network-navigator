// Guards against the exact failure class ADR-035 flagged: a RESEARCH_* flag
// defined in research-flags.ts that is never forwarded through
// docker-compose.yml (so setting it in .env silently does nothing), or a
// name that diverges by a single character between the two files.
import { readFileSync } from 'fs';
import path from 'path';

const COMPOSE_PATH = path.join(__dirname, '../../docker-compose.yml');
const FLAGS_PATH = path.join(__dirname, '../../app/src/lib/config/research-flags.ts');

function researchEnvVarsReadByCode(): Set<string> {
  const source = readFileSync(FLAGS_PATH, 'utf8');
  const matches = source.matchAll(/process\.env\.(RESEARCH_[A-Z0-9_]+)/g);
  return new Set(Array.from(matches, (m) => m[1]));
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
