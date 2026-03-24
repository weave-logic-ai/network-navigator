import { query } from '../../../db/client';
import type { Impulse } from '../../types';

/**
 * Enroll a contact in a campaign based on impulse type.
 * Stub implementation -- checks config for campaign_id and creates enrollment.
 */
export async function executeCampaignEnroller(
  impulse: Impulse,
  config: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const campaignId = config.campaign_id as string | undefined;
  if (!campaignId) {
    return { enrolled: false, reason: 'no_campaign_configured' };
  }

  const contactId = impulse.sourceEntityId;

  // Check if contact already in this campaign
  const existing = await query<{ id: string }>(
    `SELECT id FROM outreach_states
     WHERE contact_id = $1 AND campaign_id = $2
     LIMIT 1`,
    [contactId, campaignId]
  );

  if (existing.rows.length > 0) {
    return { enrolled: false, reason: 'already_enrolled', campaignId };
  }

  // Create enrollment (status = 'pending')
  try {
    await query(
      `INSERT INTO outreach_states (contact_id, campaign_id, status, step_index)
       VALUES ($1, $2, 'pending', 0)`,
      [contactId, campaignId]
    );
    return { enrolled: true, campaignId, contactId };
  } catch {
    return { enrolled: false, reason: 'enrollment_failed', campaignId };
  }
}
