#!/usr/bin/env node
/**
 * activity-scanner.mjs
 * LinkedIn Activity & Engagement Intelligence Scanner
 *
 * Extracts recent LinkedIn activity (posts, articles, shares, comments) and computes
 * activity scores based on topic relevance, recency, engagement, and frequency.
 *
 * Part of Network Intelligence Symposium recommendations (Committee 1).
 *
 * Usage:
 *   node activity-scanner.mjs --scan <url>              # Scan single contact
 *   node activity-scanner.mjs --scan-tier gold          # Scan all gold contacts
 *   node activity-scanner.mjs --score-only              # Recompute scores from existing data
 *   node activity-scanner.mjs --mock --mock-count 50    # Generate synthetic test data
 *   node activity-scanner.mjs --stats                   # Show score distribution
 *
 * Options:
 *   --delay <seconds>   Delay between profile visits (default: 3)
 *   --max <n>          Maximum profiles to scan (default: 25)
 *   --verbose          Show detailed logging
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { DATA_DIR, CONFIG_DIR } from './lib.mjs';
import { checkBudget, consumeBudget } from './rate-budget.mjs';

const GRAPH_PATH = resolve(DATA_DIR, 'graph.json');
const ICP_PATH = resolve(CONFIG_DIR, 'icp-config.json');
const VERBOSE = process.argv.includes('--verbose');

// CLI flags
const MOCK_MODE = process.argv.includes('--mock');
const SCORE_ONLY = process.argv.includes('--score-only');
const STATS_MODE = process.argv.includes('--stats');
const SCAN_URL = process.argv.find((v, i) => process.argv[i - 1] === '--scan');
const SCAN_TIER = process.argv.find((v, i) => process.argv[i - 1] === '--scan-tier');
const MOCK_COUNT = parseInt(process.argv.find((v, i) => process.argv[i - 1] === '--mock-count') || '50', 10);
const DELAY = parseInt(process.argv.find((v, i) => process.argv[i - 1] === '--delay') || '3', 10) * 1000;
const MAX_PROFILES = parseInt(process.argv.find((v, i) => process.argv[i - 1] === '--max') || '25', 10);

const log = (...a) => { if (VERBOSE) console.log('[activity]', ...a); };
const cap = (v, max = 1.0) => Math.min(Math.max(v, 0), max);
const round = (n, places = 3) => Math.round(n * Math.pow(10, places)) / Math.pow(10, places);

// ============================================================================
// Constants & Configuration
// ============================================================================

const ACTIVITY_TYPE_WEIGHTS = {
  'article': 1.0,        // Original long-form content
  'post': 1.0,           // Original posts
  'poll': 0.9,           // Polls (original content)
  'repost-commentary': 0.7,  // Repost with commentary
  'comment-long': 0.5,   // Comments 50+ chars
  'repost': 0.4,         // Plain reposts
  'comment': 0.2,        // Short comments
  'reaction': 0.15       // Likes/reactions
};

// Topic relevance keyword tiers (Committee 1 recommendations)
const TOPIC_KEYWORDS = {
  // Core AI/Automation (weight 1.0) - NOTE: Using word-boundary regex to avoid false positives
  core: [
    { pattern: /\bai\b/gi, score: 1.0 },
    { pattern: /machine learning/gi, score: 1.0 },
    { pattern: /deep learning/gi, score: 1.0 },
    { pattern: /\bllm\b/gi, score: 1.0 },
    { pattern: /large language model/gi, score: 1.0 },
    { pattern: /generative ai/gi, score: 1.0 },
    { pattern: /\bautomation\b/gi, score: 1.0 },
    { pattern: /hyperautomation/gi, score: 1.0 },
    { pattern: /\brpa\b/gi, score: 1.0 },
    { pattern: /prompt engineering/gi, score: 1.0 },
    { pattern: /\bagentic\b/gi, score: 1.0 },
    { pattern: /ai agent/gi, score: 1.0 },
    { pattern: /chatgpt/gi, score: 1.0 },
    { pattern: /claude/gi, score: 1.0 },
    { pattern: /gpt-4/gi, score: 1.0 }
  ],
  // Applied AI (weight 0.7)
  applied: [
    { pattern: /digital transformation/gi, score: 0.7 },
    { pattern: /data science/gi, score: 0.7 },
    { pattern: /analytics/gi, score: 0.7 },
    { pattern: /\bnlp\b/gi, score: 0.7 },
    { pattern: /natural language processing/gi, score: 0.7 },
    { pattern: /computer vision/gi, score: 0.7 },
    { pattern: /workflow automation/gi, score: 0.7 },
    { pattern: /mlops/gi, score: 0.7 },
    { pattern: /neural network/gi, score: 0.7 }
  ],
  // Ecosystem (weight 0.4)
  ecosystem: [
    { pattern: /innovation/gi, score: 0.4 },
    { pattern: /future of work/gi, score: 0.4 },
    { pattern: /scaling/gi, score: 0.4 },
    { pattern: /tech stack/gi, score: 0.4 },
    { pattern: /modernization/gi, score: 0.4 },
    { pattern: /data-driven/gi, score: 0.4 }
  ]
};

const RECENCY_DECAY_HALF_LIFE = 30; // days

// ============================================================================
// Data Loading
// ============================================================================

function loadFiles() {
  if (!existsSync(GRAPH_PATH)) {
    console.error('❌ graph.json not found. Run graph-builder.mjs first.');
    process.exit(1);
  }
  if (!existsSync(ICP_PATH)) {
    console.error('❌ icp-config.json not found.');
    process.exit(1);
  }
  return {
    graph: JSON.parse(readFileSync(GRAPH_PATH, 'utf-8')),
    icp: JSON.parse(readFileSync(ICP_PATH, 'utf-8'))
  };
}

function saveGraph(graph) {
  writeFileSync(GRAPH_PATH, JSON.stringify(graph, null, 2), 'utf-8');
  log('Graph saved to', GRAPH_PATH);
}

// ============================================================================
// Topic Relevance Scoring
// ============================================================================

/**
 * Compute topic relevance score for a piece of text (0-1)
 * Uses tiered keyword matching with word-boundary regex
 */
function computeTopicRelevance(text) {
  if (!text || typeof text !== 'string') return 0;

  const allKeywords = [
    ...TOPIC_KEYWORDS.core,
    ...TOPIC_KEYWORDS.applied,
    ...TOPIC_KEYWORDS.ecosystem
  ];

  let totalScore = 0;
  let matchCount = 0;

  for (const { pattern, score } of allKeywords) {
    const matches = text.match(pattern);
    if (matches && matches.length > 0) {
      totalScore += score;
      matchCount++;
    }
  }

  // Average score of matched keywords, cap at 1.0
  return matchCount > 0 ? cap(totalScore / matchCount) : 0;
}

// ============================================================================
// Activity Scoring Components
// ============================================================================

/**
 * Compute recency score using exponential decay
 * Score = exp(-daysSince / halfLife)
 */
function computeRecencyScore(posts) {
  if (!posts || posts.length === 0) return 0;

  // Find most recent post
  const mostRecentDate = posts.reduce((latest, post) => {
    const postDate = new Date(post.date);
    return postDate > latest ? postDate : latest;
  }, new Date(0));

  const daysSince = (Date.now() - mostRecentDate.getTime()) / (1000 * 60 * 60 * 24);

  // Exponential decay: score = exp(-daysSince / halfLife)
  return Math.exp(-daysSince / RECENCY_DECAY_HALF_LIFE);
}

/**
 * Compute engagement score from post metrics
 * Uses log scale normalization to handle wide variance
 */
function computeEngagementScore(posts) {
  if (!posts || posts.length === 0) return 0;

  // Compute weighted engagement for each post
  const engagementScores = posts.map(post => {
    const eng = post.engagement || {};
    const likes = eng.likes || 0;
    const comments = eng.comments || 0;
    const shares = eng.shares || 0;

    // Weight: comments = 3x likes, shares = 5x likes
    return likes + (comments * 3) + (shares * 5);
  });

  // Average engagement across posts
  const avgEngagement = engagementScores.reduce((sum, v) => sum + v, 0) / engagementScores.length;

  // Log scale normalization (100 engagement = max score)
  return Math.min(1, Math.log(1 + avgEngagement) / Math.log(100));
}

/**
 * Compute frequency score based on posting rate
 * 4+ posts per month = max score
 */
function computeFrequencyScore(posts) {
  if (!posts || posts.length === 0) return 0;

  // Find date range
  const dates = posts.map(p => new Date(p.date)).filter(d => !isNaN(d.getTime()));
  if (dates.length === 0) return 0;

  const earliest = new Date(Math.min(...dates.map(d => d.getTime())));
  const latest = new Date(Math.max(...dates.map(d => d.getTime())));

  const monthsSpanned = Math.max(1, (latest - earliest) / (1000 * 60 * 60 * 24 * 30));
  const postsPerMonth = posts.length / monthsSpanned;

  // 4+ posts/month = 1.0, linear scale below
  return Math.min(1, postsPerMonth / 4);
}

/**
 * Main activity score computation
 * Formula: topicRelevance * 0.35 + recencyScore * 0.25 + engagementScore * 0.20 + frequencyScore * 0.20
 */
function computeActivityScore(activityData) {
  if (!activityData || !activityData.posts || activityData.posts.length === 0) {
    return {
      activityScore: 0,
      activityDetails: {
        topicRelevance: 0,
        recencyScore: 0,
        engagementScore: 0,
        frequencyScore: 0
      }
    };
  }

  const posts = activityData.posts;

  // Compute topic relevance across all posts
  const topicScores = posts.map(p => computeTopicRelevance(p.text));
  const topicRelevance = topicScores.reduce((sum, v) => sum + v, 0) / topicScores.length;

  // Compute other components
  const recencyScore = computeRecencyScore(posts);
  const engagementScore = computeEngagementScore(posts);
  const frequencyScore = computeFrequencyScore(posts);

  // Weighted formula
  const activityScore = (
    topicRelevance * 0.35 +
    recencyScore * 0.25 +
    engagementScore * 0.20 +
    frequencyScore * 0.20
  );

  return {
    activityScore: round(activityScore),
    activityDetails: {
      topicRelevance: round(topicRelevance),
      recencyScore: round(recencyScore),
      engagementScore: round(engagementScore),
      frequencyScore: round(frequencyScore)
    }
  };
}

// ============================================================================
// Mock Data Generation
// ============================================================================

/**
 * Generate realistic synthetic LinkedIn activity data for testing
 * Uses power law distribution for engagement, realistic topics from ICP config
 */
function generateMockActivity(contact, icp) {
  const postCount = Math.floor(Math.random() * 11); // 0-10 posts
  if (postCount === 0) {
    return { posts: [] };
  }

  // Sample topics from ICP signals + common AI terms
  const icpSignals = Object.values(icp.profiles).flatMap(p => p.signals || []);
  const topics = [
    ...icpSignals,
    'AI deployment', 'machine learning pipeline', 'automation strategy',
    'digital transformation', 'workflow optimization', 'tech innovation',
    'scaling challenges', 'team building', 'industry trends'
  ];

  const posts = [];
  const now = Date.now();

  for (let i = 0; i < postCount; i++) {
    // Random date in last 90 days
    const daysAgo = Math.floor(Math.random() * 90);
    const postDate = new Date(now - (daysAgo * 24 * 60 * 60 * 1000));

    // Random topic
    const topic = topics[Math.floor(Math.random() * topics.length)];

    // Power law distribution for engagement (most posts have low engagement)
    const engagementBase = Math.pow(Math.random(), 2) * 100; // Skew toward low values
    const likes = Math.floor(engagementBase);
    const comments = Math.floor(engagementBase * 0.2);
    const shares = Math.floor(engagementBase * 0.05);

    // Random post type
    const types = ['post', 'post', 'post', 'article', 'repost-commentary', 'comment'];
    const type = types[Math.floor(Math.random() * types.length)];

    posts.push({
      date: postDate.toISOString(),
      text: `Excited to share thoughts on ${topic}. Great progress this quarter!`,
      type,
      engagement: { likes, comments, shares },
      topics: [topic.toLowerCase()]
    });
  }

  // Sort by date (newest first)
  posts.sort((a, b) => new Date(b.date) - new Date(a.date));

  return {
    lastScanned: new Date().toISOString(),
    posts
  };
}

// ============================================================================
// Playwright-Based Scraping (for when auth works)
// ============================================================================

/**
 * Extract activity from LinkedIn profile using Playwright
 * NOTE: LinkedIn auth is currently broken. This code is ready for when it's fixed.
 * The selectors below are approximations and may need adjustment.
 */
async function scanActivityWithPlaywright(page, profileUrl) {
  // Rate budget check before visiting activity feed
  const budget = checkBudget('activity_feeds');
  if (!budget.allowed) {
    console.log(`  Rate limit reached: ${budget.used}/${budget.limit} activity feeds today. Skipping ${profileUrl}`);
    return { posts: [] };
  }

  // Navigate to activity feed
  const activityUrl = profileUrl.replace(/\/$/, '') + '/recent-activity/all/';

  try {
    await page.goto(activityUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);

    // Scroll to load more posts (3 scroll iterations)
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => window.scrollBy(0, 1000));
      await page.waitForTimeout(1500);
    }

    // Extract posts
    // WARNING: These selectors are approximations and need verification when auth is restored
    const posts = await page.evaluate(() => {
      const items = document.querySelectorAll('.feed-shared-update-v2, .profile-creator-shared-feed-update');
      return Array.from(items).map(item => {
        // Extract text content
        const textEl = item.querySelector('.feed-shared-text, .update-components-text');
        const text = textEl?.textContent?.trim() || '';

        // Extract date
        const timeEl = item.querySelector('time');
        const date = timeEl?.getAttribute('datetime') || '';

        // Extract engagement metrics (selectors may vary)
        const likesEl = item.querySelector('.social-details-social-counts__reactions-count');
        const likes = parseInt(likesEl?.textContent?.replace(/[^\d]/g, '') || '0', 10);

        const commentsEl = item.querySelector('.social-details-social-counts__comments');
        const commentsText = commentsEl?.textContent || '';
        const comments = parseInt(commentsText.match(/\d+/)?.[0] || '0', 10);

        // Shares are harder to extract consistently
        const shares = 0;

        // Determine post type (simplified heuristic)
        let type = 'post';
        if (item.querySelector('.article-title')) type = 'article';
        else if (item.querySelector('.update-components-reshare')) type = 'repost';

        return {
          date,
          text,
          type,
          engagement: { likes, comments, shares }
        };
      }).filter(p => p.date && p.text);
    });

    consumeBudget('activity_feeds');

    return {
      lastScanned: new Date().toISOString(),
      posts
    };
  } catch (error) {
    console.error(`Error scanning ${profileUrl}:`, error.message);
    return { posts: [] };
  }
}

/**
 * Scan contacts using Playwright (currently disabled due to auth issues)
 */
async function scanWithPlaywright(contacts, delay, maxProfiles) {
  // Rate budget check before starting activity scanning
  const budget = checkBudget('activity_feeds');
  if (!budget.allowed) {
    console.log(`  Rate limit reached: ${budget.used}/${budget.limit} activity feeds today. Stopping.`);
    return;
  }

  console.log('⚠️  Playwright scanning is currently disabled due to LinkedIn auth issues.');
  console.log('⚠️  Use --mock flag to generate synthetic test data instead.');
  return;

  // Code below is ready for when auth is restored
  /*
  let playwright;
  try {
    playwright = await import('playwright');
  } catch (error) {
    console.error('❌ Playwright not installed. Run: npm install playwright');
    process.exit(1);
  }

  const browserDataDir = resolve(process.cwd(), '.browser-data');
  const browser = await playwright.chromium.launchPersistentContext(browserDataDir, {
    headless: false,
    viewport: { width: 1280, height: 800 }
  });

  const page = browser.pages()[0];

  let scanned = 0;
  for (const contact of contacts.slice(0, maxProfiles)) {
    console.log(`\n[${scanned + 1}/${Math.min(maxProfiles, contacts.length)}] Scanning ${contact.name}...`);

    const activityData = await scanActivityWithPlaywright(page, contact.url);
    const scoreResult = computeActivityScore(activityData);

    // Update contact
    contact.activity = {
      ...activityData,
      ...scoreResult
    };

    console.log(`  ✓ Found ${activityData.posts.length} posts, score: ${scoreResult.activityScore}`);

    scanned++;
    if (scanned < Math.min(maxProfiles, contacts.length)) {
      await page.waitForTimeout(delay);
    }
  }

  await browser.close();
  */
}

// ============================================================================
// Main Processing Functions
// ============================================================================

/**
 * Score all contacts from existing activity data (no scraping)
 */
function scoreExistingData(graph) {
  console.log('\n📊 Recomputing activity scores from existing data...\n');

  let scored = 0;
  let hasData = 0;

  for (const contact of Object.values(graph.contacts)) {
    if (contact.activity && contact.activity.posts && contact.activity.posts.length > 0) {
      hasData++;
      const scoreResult = computeActivityScore(contact.activity);
      contact.activity = {
        ...contact.activity,
        ...scoreResult
      };
      scored++;
    }
  }

  console.log(`✓ Scored ${scored} contacts with activity data`);
  console.log(`  (${hasData - scored} had data but no posts)\n`);

  saveGraph(graph);
  return scored;
}

/**
 * Generate mock activity data for testing
 */
function generateMockData(graph, icp, count) {
  console.log(`\n🎭 Generating mock activity data for ${count} contacts...\n`);

  // Select contacts - prioritize by tier if available, otherwise by goldScore, otherwise just first N
  let candidates = Object.values(graph.contacts);

  if (candidates.some(c => c.tier)) {
    // Sort by tier priority: gold > silver > bronze > watch
    const tierOrder = { gold: 4, silver: 3, bronze: 2, watch: 1 };
    candidates = candidates
      .filter(c => c.tier)
      .sort((a, b) => (tierOrder[b.tier] || 0) - (tierOrder[a.tier] || 0));
  } else if (candidates.some(c => c.goldScore)) {
    candidates = candidates
      .filter(c => c.goldScore > 0)
      .sort((a, b) => b.goldScore - a.goldScore);
  }

  const selectedContacts = candidates.slice(0, count);

  let generated = 0;
  for (const contact of selectedContacts) {
    const activityData = generateMockActivity(contact, icp);
    const scoreResult = computeActivityScore(activityData);

    contact.activity = {
      ...activityData,
      ...scoreResult
    };

    if (activityData.posts.length > 0) {
      generated++;
      log(`${contact.name}: ${activityData.posts.length} posts, score ${scoreResult.activityScore}`);
    }
  }

  console.log(`✓ Generated mock data for ${generated} contacts (${selectedContacts.length} total selected)`);
  console.log(`  (${selectedContacts.length - generated} contacts got zero posts)\n`);

  saveGraph(graph);
  return generated;
}

/**
 * Show activity score statistics
 */
function showStats(graph) {
  console.log('\n📈 Activity Score Distribution\n');

  const contactsWithActivity = Object.values(graph.contacts)
    .filter(c => c.activity && c.activity.activityScore !== undefined);

  if (contactsWithActivity.length === 0) {
    console.log('❌ No contacts have activity scores yet.\n');
    console.log('Run with --mock to generate test data, or --scan-tier to scan real profiles.\n');
    return;
  }

  const scores = contactsWithActivity.map(c => c.activity.activityScore).sort((a, b) => a - b);
  const withPosts = contactsWithActivity.filter(c => c.activity.posts && c.activity.posts.length > 0);

  // Basic stats
  const mean = scores.reduce((sum, v) => sum + v, 0) / scores.length;
  const median = scores[Math.floor(scores.length / 2)];
  const p90 = scores[Math.floor(scores.length * 0.9)];
  const max = scores[scores.length - 1];

  console.log(`Total contacts with activity data: ${contactsWithActivity.length}`);
  console.log(`Contacts with posts: ${withPosts.length}\n`);

  console.log('Score Distribution:');
  console.log(`  Mean:   ${round(mean)}`);
  console.log(`  Median: ${round(median)}`);
  console.log(`  P90:    ${round(p90)}`);
  console.log(`  Max:    ${round(max)}\n`);

  // Tier breakdown
  const tiers = {
    'High (0.7+)': scores.filter(s => s >= 0.7).length,
    'Medium (0.4-0.7)': scores.filter(s => s >= 0.4 && s < 0.7).length,
    'Low (0.2-0.4)': scores.filter(s => s >= 0.2 && s < 0.4).length,
    'Minimal (<0.2)': scores.filter(s => s < 0.2).length
  };

  console.log('Score Tiers:');
  for (const [tier, count] of Object.entries(tiers)) {
    const pct = ((count / scores.length) * 100).toFixed(1);
    console.log(`  ${tier.padEnd(20)} ${count.toString().padStart(4)} (${pct}%)`);
  }

  // Top performers
  console.log('\nTop 10 by Activity Score:');
  const top10 = contactsWithActivity
    .sort((a, b) => b.activity.activityScore - a.activity.activityScore)
    .slice(0, 10);

  for (let i = 0; i < top10.length; i++) {
    const c = top10[i];
    const posts = c.activity.posts?.length || 0;
    const details = c.activity.activityDetails || {};
    console.log(`  ${(i + 1).toString().padStart(2)}. ${c.name.padEnd(30)} ${round(c.activity.activityScore)} (${posts} posts, topic:${round(details.topicRelevance)} rec:${round(details.recencyScore)})`);
  }

  console.log('');
}

/**
 * Scan contacts in a specific tier
 */
async function scanTier(graph, tier) {
  const contacts = Object.values(graph.contacts).filter(c => c.tier === tier);

  if (contacts.length === 0) {
    console.log(`❌ No contacts found in tier: ${tier}\n`);
    return;
  }

  console.log(`\n🔍 Scanning ${tier} tier (${contacts.length} contacts)...\n`);

  if (MOCK_MODE) {
    // Mock mode: generate synthetic data
    for (const contact of contacts.slice(0, MAX_PROFILES)) {
      const activityData = generateMockActivity(contact, icp);
      const scoreResult = computeActivityScore(activityData);
      contact.activity = { ...activityData, ...scoreResult };
    }
    console.log(`✓ Generated mock data for ${Math.min(MAX_PROFILES, contacts.length)} ${tier} contacts\n`);
    saveGraph(graph);
  } else {
    // Real scraping (currently disabled)
    await scanWithPlaywright(contacts, DELAY, MAX_PROFILES);
  }
}

/**
 * Scan a single contact
 */
async function scanSingle(graph, icp, url) {
  const contact = graph.contacts[url];

  if (!contact) {
    console.log(`❌ Contact not found: ${url}\n`);
    return;
  }

  console.log(`\n🔍 Scanning ${contact.name}...\n`);

  if (MOCK_MODE) {
    const activityData = generateMockActivity(contact, icp);
    const scoreResult = computeActivityScore(activityData);
    contact.activity = { ...activityData, ...scoreResult };

    console.log(`✓ Generated ${activityData.posts.length} posts`);
    console.log(`  Activity score: ${scoreResult.activityScore}`);
    console.log(`  Details:`, scoreResult.activityDetails);
    console.log('');

    saveGraph(graph);
  } else {
    // Real scraping (currently disabled)
    await scanWithPlaywright([contact], DELAY, 1);
  }
}

// ============================================================================
// Main Entry Point
// ============================================================================

async function main() {
  const { graph, icp } = loadFiles();

  // Show help if no arguments
  if (process.argv.length === 2) {
    console.log(`
LinkedIn Activity Scanner — Network Intelligence Symposium (Committee 1)

Usage:
  node activity-scanner.mjs --scan <url>              Scan single contact
  node activity-scanner.mjs --scan-tier <tier>        Scan all contacts in tier (gold/silver/bronze)
  node activity-scanner.mjs --score-only              Recompute scores from existing data
  node activity-scanner.mjs --mock --mock-count 50    Generate synthetic test data
  node activity-scanner.mjs --stats                   Show score distribution

Options:
  --delay <seconds>   Delay between profile visits (default: 3)
  --max <n>          Maximum profiles to scan (default: 25)
  --verbose          Show detailed logging

Examples:
  # Generate mock data for testing
  node activity-scanner.mjs --mock --mock-count 50

  # Show statistics
  node activity-scanner.mjs --stats

  # Recompute scores after manual data edits
  node activity-scanner.mjs --score-only

  # Scan gold tier (when auth works)
  node activity-scanner.mjs --scan-tier gold --max 10

Note: LinkedIn auth is currently broken. Use --mock for testing.
`);
    return;
  }

  // Execute based on mode
  if (STATS_MODE) {
    showStats(graph);
  } else if (SCORE_ONLY) {
    scoreExistingData(graph);
  } else if (MOCK_MODE && !SCAN_URL && !SCAN_TIER) {
    generateMockData(graph, icp, MOCK_COUNT);
  } else if (SCAN_URL) {
    await scanSingle(graph, icp, SCAN_URL);
  } else if (SCAN_TIER) {
    await scanTier(graph, SCAN_TIER);
  } else {
    console.log('❌ Invalid arguments. Run without arguments to see help.\n');
  }
}

main().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
