// POST /api/admin/erasure - GDPR right-to-erasure (Article 17)
// Erases all data for a contact across all tables

import { NextRequest, NextResponse } from 'next/server';
import { query, transaction } from '@/lib/db/client';
import { PoolClient } from 'pg';
import * as actionLog from '@/lib/db/queries/action-log';

interface ErasureBody {
  contactId: string;
  confirmToken: string;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as ErasureBody;

    if (!body.contactId) {
      return NextResponse.json(
        { error: 'contactId is required' },
        { status: 400 }
      );
    }

    if (body.confirmToken !== 'CONFIRM_ERASURE') {
      return NextResponse.json(
        { error: 'Confirmation token required. Send confirmToken: "CONFIRM_ERASURE"' },
        { status: 400 }
      );
    }

    // Verify contact exists and get name for audit log
    const contactResult = await query<{
      id: string;
      full_name: string | null;
      first_name: string | null;
      last_name: string | null;
    }>(
      'SELECT id, full_name, first_name, last_name FROM contacts WHERE id = $1',
      [body.contactId]
    );

    if (contactResult.rows.length === 0) {
      return NextResponse.json(
        { error: 'Contact not found' },
        { status: 404 }
      );
    }

    const contact = contactResult.rows[0];
    const contactName = contact.full_name
      || [contact.first_name, contact.last_name].filter(Boolean).join(' ')
      || 'Unknown';

    // Record erasure in action log BEFORE deleting (for audit trail)
    await actionLog.recordAction({
      actionType: 'erasure',
      actor: 'admin',
      targetType: 'contact',
      targetId: body.contactId,
      targetName: contactName,
      metadata: {
        gdprArticle: 17,
        erasedAt: new Date().toISOString(),
      },
    });

    // Perform cascading erasure within a transaction
    await transaction(async (client: PoolClient) => {
      const contactId = body.contactId;

      // 1. Delete action_log entries for this contact (except the erasure record we just created)
      await client.query(
        `DELETE FROM action_log WHERE target_id = $1 AND target_type = 'contact' AND action_type != 'erasure'`,
        [contactId]
      );

      // 2. Delete enrichment transactions
      await client.query(
        'DELETE FROM enrichment_transactions WHERE contact_id = $1',
        [contactId]
      );

      // 3. Delete person enrichments
      await client.query(
        'DELETE FROM person_enrichments WHERE contact_id = $1',
        [contactId]
      );

      // 4. Delete score dimensions (via contact_scores FK)
      await client.query(
        `DELETE FROM score_dimensions WHERE contact_score_id IN
         (SELECT id FROM contact_scores WHERE contact_id = $1)`,
        [contactId]
      );

      // 5. Delete contact scores
      await client.query(
        'DELETE FROM contact_scores WHERE contact_id = $1',
        [contactId]
      );

      // 6. Delete ICP fits
      await client.query(
        'DELETE FROM contact_icp_fits WHERE contact_id = $1',
        [contactId]
      );

      // 7. Delete outreach events (via outreach_states FK)
      await client.query(
        `DELETE FROM outreach_events WHERE outreach_state_id IN
         (SELECT id FROM outreach_states WHERE contact_id = $1)`,
        [contactId]
      );

      // 8. Delete outreach states
      await client.query(
        'DELETE FROM outreach_states WHERE contact_id = $1',
        [contactId]
      );

      // 9. Delete tasks
      await client.query(
        'DELETE FROM tasks WHERE contact_id = $1',
        [contactId]
      );

      // 10. Delete edges (both source and target)
      await client.query(
        'DELETE FROM edges WHERE source_contact_id = $1 OR target_contact_id = $1',
        [contactId]
      );

      // 11. Delete behavioral observations
      await client.query(
        'DELETE FROM behavioral_observations WHERE contact_id = $1',
        [contactId]
      );

      // 12. Delete content profiles
      await client.query(
        'DELETE FROM content_profiles WHERE contact_id = $1',
        [contactId]
      );

      // 13. Delete activity patterns
      await client.query(
        'DELETE FROM activity_patterns WHERE contact_id = $1',
        [contactId]
      );

      // 14. Delete cluster memberships
      await client.query(
        'DELETE FROM cluster_memberships WHERE contact_id = $1',
        [contactId]
      );

      // 15. Delete work history
      await client.query(
        'DELETE FROM work_history WHERE contact_id = $1',
        [contactId]
      );

      // 16. Delete education
      await client.query(
        'DELETE FROM education WHERE contact_id = $1',
        [contactId]
      );

      // 17. Finally delete the contact itself
      await client.query(
        'DELETE FROM contacts WHERE id = $1',
        [contactId]
      );
    });

    return NextResponse.json({
      erased: true,
      contactId: body.contactId,
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Erasure failed', details: error instanceof Error ? error.message : undefined },
      { status: 500 }
    );
  }
}
