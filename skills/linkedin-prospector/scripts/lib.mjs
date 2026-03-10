import { chromium } from 'playwright';
import { readFileSync, existsSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Paths — override with env vars for portability
export const USER_DATA_DIR = process.env.BROWSER_DATA_DIR || resolve(process.cwd(), '.browser-data');

// Data directory — runtime data (contacts, graph, cache, snapshots, report)
// Defaults to the skill's own data/ dir, override with PROSPECTOR_DATA_DIR for separation
const SKILL_DATA_DIR = resolve(__dirname, '..', 'data');
export const DATA_DIR = process.env.PROSPECTOR_DATA_DIR || SKILL_DATA_DIR;

// RVF store path -- isRvfAvailable() lives in rvf-store.mjs (D-3)
export const RVF_STORE_PATH = resolve(DATA_DIR, 'network.rvf');

// Config directory — config files always load from the skill tree
export const CONFIG_DIR = SKILL_DATA_DIR;

// Niche-to-keyword mappings — loaded from icp-config.json, with hardcoded fallback
const configPath = resolve(CONFIG_DIR, 'icp-config.json');
let _niches;
try {
  if (existsSync(configPath)) {
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    _niches = config.niches;
  }
} catch { /* fall through to defaults */ }

export const NICHE_KEYWORDS = _niches || {
  dtc: ['DTC', 'direct to consumer', 'd2c brand'],
  ecommerce: ['ecommerce', 'e-commerce', 'digital commerce', 'online retail'],
  saas: ['SaaS', 'platform', 'software as a service'],
  'adobe-commerce': ['adobe commerce', 'magento'],
  shopify: ['shopify', 'shopify plus'],
  agency: ['digital agency', 'studio', 'consultancy'],
  php: ['PHP', 'Zend', 'Laravel', 'Symfony', 'Laminas'],
  retail: ['omnichannel retail', 'retail technology'],
};

/**
 * Launch Playwright persistent browser context with LinkedIn session.
 * Returns { context, page }.
 */
export async function launchBrowser() {
  const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: false,
    channel: 'chromium',
    viewport: { width: 1400, height: 900 },
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
  });
  const page = context.pages()[0] || await context.newPage();
  return { context, page };
}

/**
 * Parse CLI arguments into a key-value object.
 * Supports --key value and --flag (boolean).
 */
export function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) {
        args[key] = true;
      } else {
        args[key] = next;
        i++;
      }
    } else if (!args._) {
      args._ = argv[i];
    }
  }
  return args;
}
