import type { Impulse } from '../../types';

/**
 * Send notifications for impulse events.
 * Stub implementation -- logs to console. Future: email, websocket, push.
 */
export async function executeNotification(
  impulse: Impulse,
  config: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const channel = (config.channel as string) ?? 'log';
  const message = formatNotification(impulse);

  switch (channel) {
    case 'log':
      console.log(`[notification] ${message}`);
      return { sent: true, channel: 'log', message };

    case 'email':
      // Future: integrate with email service
      console.log(`[notification] Would email: ${message}`);
      return { sent: false, channel: 'email', reason: 'not_implemented' };

    case 'webhook':
      // Future: POST to configured URL
      console.log(`[notification] Would webhook: ${message}`);
      return { sent: false, channel: 'webhook', reason: 'not_implemented' };

    default:
      return { sent: false, channel, reason: 'unknown_channel' };
  }
}

function formatNotification(impulse: Impulse): string {
  const payload = impulse.payload;
  switch (impulse.impulseType) {
    case 'tier_changed':
      return `Contact ${impulse.sourceEntityId} moved from ${payload.from} to ${payload.to} tier`;
    case 'persona_assigned':
      return `Contact ${impulse.sourceEntityId} assigned persona: ${payload.to}`;
    case 'score_computed':
      return `Contact ${impulse.sourceEntityId} scored: ${payload.composite} (${payload.tier})`;
    case 'enrichment_complete':
      return `Contact ${impulse.sourceEntityId} enrichment complete: ${payload.fieldsFound} fields`;
    default:
      return `Impulse ${impulse.impulseType} for ${impulse.sourceEntityId}`;
  }
}
