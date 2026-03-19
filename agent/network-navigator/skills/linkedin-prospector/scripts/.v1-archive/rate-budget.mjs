/**
 * rate-budget.mjs -- Daily LinkedIn operation budget tracker
 *
 * Manages a rate-budget.json data file that tracks daily LinkedIn operation
 * usage and enforces limits to stay within safe operating thresholds.
 *
 * Daily limits (from Network Intelligence Symposium):
 *   profile_visits:       80   (5-8s delay between)
 *   connection_requests:  20   (manual)
 *   messages_sent:        25   (manual)
 *   search_pages:         30   (8-12s delay between)
 *   activity_feeds:       20   (5-8s delay between)
 *
 * Usage (as module):
 *   import { checkBudget, consumeBudget, getBudgetStatus } from './rate-budget.mjs';
 *
 * Usage (CLI):
 *   node rate-budget.mjs --status     Print current budget
 *   node rate-budget.mjs --reset      Force reset all counters
 *   node rate-budget.mjs --history    Show last 7 days of usage
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { DATA_DIR } from './lib.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BUDGET_PATH = resolve(DATA_DIR, 'rate-budget.json');

const DEFAULT_LIMITS = {
  profile_visits:      { used: 0, limit: 80 },
  connection_requests: { used: 0, limit: 20 },
  messages_sent:       { used: 0, limit: 25 },
  search_pages:        { used: 0, limit: 30 },
  activity_feeds:      { used: 0, limit: 20 },
};

const MAX_HISTORY_DAYS = 30;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function todayStr() {
  return new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
}

function createDefaultBudget() {
  return {
    date: todayStr(),
    operations: JSON.parse(JSON.stringify(DEFAULT_LIMITS)),
    history: [],
  };
}

function loadBudget() {
  if (!existsSync(BUDGET_PATH)) {
    return createDefaultBudget();
  }
  try {
    return JSON.parse(readFileSync(BUDGET_PATH, 'utf-8'));
  } catch {
    // Corrupted file -- start fresh
    return createDefaultBudget();
  }
}

function saveBudget(budget) {
  const dir = dirname(BUDGET_PATH);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(BUDGET_PATH, JSON.stringify(budget, null, 2), 'utf-8');
}

/**
 * If the stored date !== today, archive yesterday's usage into history,
 * then reset all counters for the new day.
 */
function ensureCurrentDay(budget) {
  const today = todayStr();
  if (budget.date === today) return budget;

  // Archive the previous day's usage
  const archived = { date: budget.date };
  for (const [op, data] of Object.entries(budget.operations)) {
    if (data.used > 0) {
      archived[op] = data.used;
    }
  }

  // Only add to history if there was any usage
  const hadUsage = Object.keys(archived).length > 1; // more than just "date"
  if (hadUsage) {
    if (!budget.history) budget.history = [];
    budget.history.push(archived);

    // Trim history to MAX_HISTORY_DAYS
    if (budget.history.length > MAX_HISTORY_DAYS) {
      budget.history = budget.history.slice(-MAX_HISTORY_DAYS);
    }
  }

  // Reset for today
  budget.date = today;
  for (const op of Object.keys(DEFAULT_LIMITS)) {
    if (!budget.operations[op]) {
      budget.operations[op] = JSON.parse(JSON.stringify(DEFAULT_LIMITS[op]));
    } else {
      budget.operations[op].used = 0;
      // Preserve custom limits if set, otherwise use default
      if (budget.operations[op].limit === undefined) {
        budget.operations[op].limit = DEFAULT_LIMITS[op].limit;
      }
    }
  }

  saveBudget(budget);
  return budget;
}

function validateOperationType(operationType) {
  if (!DEFAULT_LIMITS[operationType]) {
    throw new Error(
      `Unknown operation type: "${operationType}". ` +
      `Valid types: ${Object.keys(DEFAULT_LIMITS).join(', ')}`
    );
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check whether an operation is allowed under the daily budget.
 * Auto-resets counters if the date has changed.
 *
 * @param {string} operationType - One of: profile_visits, connection_requests,
 *                                 messages_sent, search_pages, activity_feeds
 * @returns {{ allowed: boolean, remaining: number, limit: number, used: number }}
 */
export function checkBudget(operationType) {
  validateOperationType(operationType);
  const budget = ensureCurrentDay(loadBudget());
  const op = budget.operations[operationType];
  const remaining = Math.max(0, op.limit - op.used);

  return {
    allowed: remaining > 0,
    remaining,
    limit: op.limit,
    used: op.used,
  };
}

/**
 * Consume budget for an operation. Increments the used counter and persists.
 * Throws if the budget would be exceeded.
 *
 * @param {string} operationType
 * @param {number} count - Number of operations to consume (default: 1)
 * @returns {{ allowed: boolean, remaining: number, limit: number, used: number }}
 */
export function consumeBudget(operationType, count = 1) {
  validateOperationType(operationType);
  const budget = ensureCurrentDay(loadBudget());
  const op = budget.operations[operationType];

  if (op.used + count > op.limit) {
    throw new Error(
      `Rate budget exceeded for ${operationType}: ` +
      `${op.used}/${op.limit} used, cannot consume ${count} more.`
    );
  }

  op.used += count;
  saveBudget(budget);

  const remaining = Math.max(0, op.limit - op.used);
  return {
    allowed: remaining > 0,
    remaining,
    limit: op.limit,
    used: op.used,
  };
}

/**
 * Get the full budget status for all operation types.
 *
 * @returns {{ date: string, operations: object, totalUsed: number, totalLimit: number }}
 */
export function getBudgetStatus() {
  const budget = ensureCurrentDay(loadBudget());
  let totalUsed = 0;
  let totalLimit = 0;

  const operations = {};
  for (const [op, data] of Object.entries(budget.operations)) {
    const remaining = Math.max(0, data.limit - data.used);
    operations[op] = {
      used: data.used,
      limit: data.limit,
      remaining,
      percentage: data.limit > 0 ? Math.round((data.used / data.limit) * 100) : 0,
    };
    totalUsed += data.used;
    totalLimit += data.limit;
  }

  return {
    date: budget.date,
    operations,
    totalUsed,
    totalLimit,
  };
}

/**
 * Force reset all counters (useful for testing).
 * Does NOT archive to history.
 */
export function resetBudget() {
  const budget = createDefaultBudget();
  // Preserve existing history if file exists
  const existing = loadBudget();
  if (existing.history) {
    budget.history = existing.history;
  }
  saveBudget(budget);
  return getBudgetStatus();
}

/**
 * Get recent usage history.
 *
 * @param {number} days - Number of days to return (default: 7)
 * @returns {Array<object>}
 */
export function getBudgetHistory(days = 7) {
  const budget = loadBudget();
  const history = budget.history || [];
  return history.slice(-days);
}

// ---------------------------------------------------------------------------
// CLI mode
// ---------------------------------------------------------------------------

const isMain = process.argv[1] &&
  fileURLToPath(import.meta.url).endsWith(process.argv[1].replace(/.*\//, ''));

if (isMain) {
  const args = process.argv.slice(2);

  if (args.includes('--status') || args.length === 0) {
    const status = getBudgetStatus();
    console.log(`\nRate Budget Status (${status.date})\n${'='.repeat(50)}`);
    for (const [op, data] of Object.entries(status.operations)) {
      const bar = '|'.repeat(Math.round(data.percentage / 5)).padEnd(20, '.');
      console.log(
        `  ${op.padEnd(22)} ${String(data.used).padStart(3)}/${data.limit}  ` +
        `[${bar}] ${data.percentage}%`
      );
    }
    console.log(`${'='.repeat(50)}`);
    console.log(`  Total: ${status.totalUsed}/${status.totalLimit} operations used today`);
    console.log('');
  } else if (args.includes('--reset')) {
    resetBudget();
    console.log('Budget counters reset to zero.');
    const status = getBudgetStatus();
    console.log(`Date: ${status.date}`);
    for (const [op, data] of Object.entries(status.operations)) {
      console.log(`  ${op}: ${data.used}/${data.limit}`);
    }
  } else if (args.includes('--history')) {
    const daysArg = args.indexOf('--days');
    const days = daysArg >= 0 ? parseInt(args[daysArg + 1], 10) || 7 : 7;
    const history = getBudgetHistory(days);

    if (history.length === 0) {
      console.log('\nNo usage history recorded yet.\n');
    } else {
      console.log(`\nUsage History (last ${history.length} days)\n${'='.repeat(50)}`);
      for (const entry of history) {
        const ops = Object.entries(entry)
          .filter(([k]) => k !== 'date')
          .map(([k, v]) => `${k}=${v}`)
          .join(', ');
        console.log(`  ${entry.date}: ${ops || '(no usage)'}`);
      }
      console.log('');
    }
  } else {
    console.log('Usage: node rate-budget.mjs [--status] [--reset] [--history [--days N]]');
  }
}
