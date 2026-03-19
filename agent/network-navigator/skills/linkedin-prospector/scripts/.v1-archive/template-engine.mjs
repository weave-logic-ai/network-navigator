/**
 * template-engine.mjs - Merge field template renderer with character limit enforcement
 *
 * Features:
 * - Renders templates with merge fields ({{fieldName}})
 * - Enforces character limits (e.g., LinkedIn 300-char connection request limit)
 * - Progressive truncation of optional sections when limit exceeded
 * - Template validation and merge field discovery
 *
 * Usage:
 *   import { renderTemplate, validateTemplate, listMergeFields } from './template-engine.mjs';
 *   const msg = renderTemplate(templateString, contactData, { maxChars: 300 });
 */

import { readFileSync } from 'fs';

const MERGE_FIELD_PATTERN = /\{\{([a-zA-Z0-9_]+)\}\}/g;

/**
 * Extract all merge fields from a template string
 * @param {string} template - Template string with {{field}} placeholders
 * @returns {string[]} Array of field names found in template
 */
export function listMergeFields(template) {
  const fields = new Set();
  let match;
  const regex = new RegExp(MERGE_FIELD_PATTERN.source, 'g');
  while ((match = regex.exec(template)) !== null) {
    fields.add(match[1]);
  }
  return Array.from(fields).sort();
}

/**
 * Validate a template against available contact data
 * @param {string} template - Template string
 * @param {string[]} requiredFields - Fields that must be present in data
 * @param {object} options - Validation options
 * @returns {object} { valid: boolean, errors: string[], warnings: string[] }
 */
export function validateTemplate(template, requiredFields = [], options = {}) {
  const errors = [];
  const warnings = [];
  const fields = listMergeFields(template);

  // Check required fields are in template
  for (const req of requiredFields) {
    if (!fields.includes(req)) {
      errors.push(`Required field {{${req}}} missing from template`);
    }
  }

  // Estimate minimum length (assuming single-char values for all fields)
  const minLength = template.replace(MERGE_FIELD_PATTERN, 'x').length;
  if (options.maxChars && minLength > options.maxChars) {
    errors.push(`Template minimum length (${minLength}) exceeds limit (${options.maxChars})`);
  }

  // Estimate typical length (assuming 15-char average per field)
  const typicalLength = template.replace(MERGE_FIELD_PATTERN, 'x'.repeat(15)).length;
  if (options.maxChars && typicalLength > options.maxChars) {
    warnings.push(`Template typical length (~${typicalLength}) may exceed limit (${options.maxChars})`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    fields,
    minLength,
    typicalLength,
  };
}

/**
 * Render a template with contact data, enforcing character limits
 * @param {string} template - Template string with {{field}} placeholders
 * @param {object} data - Contact data with merge field values
 * @param {object} options - Rendering options
 * @param {number} options.maxChars - Maximum character limit (e.g., 300 for LinkedIn)
 * @param {boolean} options.strict - Throw error if field missing (default: replace with empty)
 * @param {boolean} options.trimLines - Trim whitespace from each line (default: true)
 * @param {string[]} options.optionalSections - Markers for optional sections to truncate first
 * @returns {object} { text: string, truncated: boolean, originalLength: number, fields: object }
 */
export function renderTemplate(template, data = {}, options = {}) {
  const {
    maxChars = null,
    strict = false,
    trimLines = true,
    optionalSections = ['{{personalNote}}', '{{sharedInterest}}'],
  } = options;

  // Normalize data: create safe accessors with fallbacks
  const safeData = {
    firstName: data.firstName || data.name?.split(' ')[0] || '',
    lastName: data.lastName || data.name?.split(' ').slice(1).join(' ') || '',
    name: data.name || '',
    company: data.company || data.currentCompany || '',
    headline: data.headline || '',
    currentRole: data.currentRole || data.title || '',
    mutualConnection: extractMutualConnection(data),
    mutualCount: data.mutualCount || (data.mutualConnections ? `${data.mutualConnections}` : ''),
    sharedInterest: extractSharedInterest(data),
    personalNote: data.personalNote || '',
    targetName: data.targetName || '',
    targetCompany: data.targetCompany || '',
    ...data, // Allow custom fields to pass through
  };

  // First pass: render all fields
  let rendered = template;
  const fieldsUsed = {};

  rendered = rendered.replace(MERGE_FIELD_PATTERN, (match, fieldName) => {
    const value = safeData[fieldName];
    if (value === undefined || value === null || value === '') {
      if (strict) {
        throw new Error(`Missing required field: ${fieldName}`);
      }
      fieldsUsed[fieldName] = '';
      return '';
    }
    fieldsUsed[fieldName] = value;
    return value;
  });

  // Trim lines if requested
  if (trimLines) {
    rendered = rendered
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .join('\n');
  }

  // Collapse multiple spaces
  rendered = rendered.replace(/ {2,}/g, ' ');

  // Remove empty lines
  rendered = rendered.replace(/\n{3,}/g, '\n\n').trim();

  const originalLength = rendered.length;
  let truncated = false;

  // If we exceed maxChars, progressively truncate optional sections
  if (maxChars && rendered.length > maxChars) {
    truncated = true;

    // Strategy 1: Remove personal note section
    if (data.personalNote) {
      const withoutNote = template.replace(/\{\{personalNote\}\}\.?\s*/g, '');
      rendered = renderTemplate(withoutNote, { ...data, personalNote: '' }, { ...options, maxChars: null }).text;
    }

    // Strategy 2: Shorten shared interest to just keyword
    if (rendered.length > maxChars && data.sharedInterest) {
      const shortInterest = data.sharedInterest.split(' ')[0]; // Just first word
      rendered = renderTemplate(template, { ...data, sharedInterest: shortInterest, personalNote: '' }, { ...options, maxChars: null }).text;
    }

    // Strategy 3: Hard truncate with ellipsis
    if (rendered.length > maxChars) {
      rendered = rendered.slice(0, maxChars - 3) + '...';
    }
  }

  return {
    text: rendered,
    truncated,
    originalLength,
    finalLength: rendered.length,
    fields: fieldsUsed,
    withinLimit: !maxChars || rendered.length <= maxChars,
  };
}

/**
 * Extract best mutual connection name from contact data
 */
function extractMutualConnection(data) {
  // If explicit mutual provided
  if (data.mutualConnection) return data.mutualConnection;

  // If discoveredVia array exists, take first
  if (data.discoveredVia?.length > 0) {
    const first = data.discoveredVia[0];
    return first.name || first;
  }

  // Fallback
  return 'a mutual connection';
}

/**
 * Extract shared interest from contact data
 */
function extractSharedInterest(data) {
  // If explicit interest provided
  if (data.sharedInterest) return data.sharedInterest;

  // From tags
  if (data.tags?.length > 0) {
    return data.tags[0];
  }

  // From persona
  if (data.persona) {
    const personaMap = {
      'decision-maker': 'digital transformation',
      'influencer': 'industry innovation',
      'technical-expert': 'technical architecture',
      'referral-source': 'business development',
    };
    return personaMap[data.persona] || 'your industry';
  }

  return 'AI and automation';
}

/**
 * Render template from YAML template config
 * @param {object} templateConfig - Template config from outreach-templates.yaml
 * @param {object} contactData - Contact data for merge fields
 * @returns {object} Render result with text, truncated flag, etc.
 */
export function renderFromConfig(templateConfig, contactData) {
  const maxChars = templateConfig.maxChars || null;
  const template = templateConfig.template;

  return renderTemplate(template, contactData, {
    maxChars,
    strict: false,
    trimLines: true,
  });
}

/**
 * Batch render multiple templates for comparison
 * @param {object[]} templates - Array of template configs
 * @param {object} contactData - Contact data
 * @returns {object[]} Array of render results with template name
 */
export function batchRender(templates, contactData) {
  return templates.map(tpl => ({
    name: tpl.name,
    type: tpl.type,
    result: renderFromConfig(tpl, contactData),
  }));
}

/**
 * Select best template for a contact based on rules
 * @param {object} contact - Contact data
 * @param {object[]} templates - Available templates
 * @param {object[]} rules - Selection rules from config
 * @returns {object|null} Best matching template
 */
export function selectTemplate(contact, templates, rules = []) {
  // Try rules in order
  for (const rule of rules) {
    let match = true;

    if (rule.persona && contact.persona !== rule.persona) match = false;
    if (rule.tier && contact.tier !== rule.tier) match = false;
    if (rule.degree && contact.degree !== rule.degree) match = false;

    if (match && rule.template) {
      const found = templates.find(t => t.name === rule.template || t.id === rule.template);
      if (found) return found;
    }
  }

  // Fallback to default
  return templates.find(t => t.default) || templates[0] || null;
}
