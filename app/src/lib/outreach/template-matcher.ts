// Automatic outreach template selection based on contact persona and tier.
// Maps scoring classifications to outreach template categories.

import { query } from '@/lib/db/client';

interface TemplateRecommendation {
  templateId: string;
  templateName: string;
  reason: string;
}

/**
 * Returns the recommended outreach template for a contact based on
 * their tier, persona, and optional referral persona.
 */
export async function getRecommendedTemplate(
  tier: string,
  persona: string,
  referralPersona?: string | null
): Promise<TemplateRecommendation | null> {
  const { category, reason } = resolveCategory(tier, persona, referralPersona);

  // Try to find an active template in the resolved category
  let template = await findTemplateByCategory(category);

  // Fall back to initial_outreach if no match
  if (!template && category !== 'initial_outreach') {
    template = await findTemplateByCategory('initial_outreach');
  }

  if (!template) return null;

  return {
    templateId: template.id,
    templateName: template.name,
    reason,
  };
}

// outreach_templates.category is constrained by a CHECK constraint
// (data/db/init/006-outreach-schema.sql) and re-validated by
// POST /api/outreach/templates (VALID_CATEGORIES in
// app/src/app/api/outreach/templates/route.ts) to exactly:
//   'initial_outreach' | 'follow_up' | 'meeting_request' |
//   'referral_ask' | 'content_share' | 'custom'
// Every branch below must resolve to one of these — a category outside
// this set can never match a real template, so findTemplateByCategory
// would always fall through to the initial_outreach default and the
// persona-specific reasoning would be silently discarded.
function resolveCategory(
  tier: string,
  persona: string,
  referralPersona?: string | null
): { category: string; reason: string } {
  // Referral-persona-based overrides (checked first)
  if (referralPersona === 'warm-introducer') {
    return {
      category: 'referral_ask',
      reason: 'Contact is a warm-introducer — use a referral ask template.',
    };
  }
  if (referralPersona === 'white-label-partner') {
    // No permitted category means "propose a partnership" — that's a
    // structurally different ask from the standard outreach/follow-up/
    // meeting/referral/content templates. 'custom' is the schema's
    // intended escape hatch for exactly this kind of specialized template.
    return {
      category: 'custom',
      reason: 'Contact is a white-label partner candidate — use a custom partnership proposal template.',
    };
  }

  // Tier + persona combinations
  if (tier === 'gold' && persona === 'buyer') {
    // First contact with a senior decision-maker is still a first contact.
    return {
      category: 'initial_outreach',
      reason: 'Gold-tier buyer — use initial outreach template tailored for an executive audience.',
    };
  }
  if (tier === 'gold' && persona === 'warm-lead') {
    return {
      category: 'follow_up',
      reason: 'Gold-tier warm lead — use follow-up template.',
    };
  }
  if (tier === 'silver' && persona === 'hub') {
    // A "hub" contact is valuable for the introductions/referrals they can
    // make into their own network — that's what referral_ask covers.
    return {
      category: 'referral_ask',
      reason: 'Silver-tier hub — use referral ask template to tap into their network.',
    };
  }

  // Default
  return {
    category: 'initial_outreach',
    reason: 'Default outreach — no specific persona/tier match.',
  };
}

async function findTemplateByCategory(
  category: string
): Promise<{ id: string; name: string } | null> {
  const result = await query<{ id: string; name: string }>(
    `SELECT id, name FROM outreach_templates
     WHERE category = $1 AND is_active = TRUE
     ORDER BY created_at DESC
     LIMIT 1`,
    [category]
  );
  return result.rows[0] ?? null;
}
