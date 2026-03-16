// WebSocket push event constructors

import type { WsPushEvent } from './ws-server';
import type { ExtensionSettings } from '@/types/extension-auth';

export function createCaptureConfirmedEvent(
  captureId: string,
  url: string,
  pageType: string
): WsPushEvent {
  return {
    type: 'CAPTURE_CONFIRMED',
    payload: { captureId, url, pageType },
    timestamp: new Date().toISOString(),
  };
}

export function createTaskCreatedEvent(task: {
  id: string;
  title: string;
  type: string;
  priority: string;
  targetUrl: string | null;
}): WsPushEvent {
  return {
    type: 'TASK_CREATED',
    payload: { task },
    timestamp: new Date().toISOString(),
  };
}

export function createTaskUpdatedEvent(
  taskId: string,
  status: string
): WsPushEvent {
  return {
    type: 'TASK_UPDATED',
    payload: { taskId, status },
    timestamp: new Date().toISOString(),
  };
}

export function createGoalProgressEvent(
  goalId: string,
  progress: number
): WsPushEvent {
  return {
    type: 'GOAL_PROGRESS',
    payload: { goalId, progress },
    timestamp: new Date().toISOString(),
  };
}

export function createTemplateReadyEvent(
  contactUrl: string,
  template: string
): WsPushEvent {
  return {
    type: 'TEMPLATE_READY',
    payload: { contactUrl, template },
    timestamp: new Date().toISOString(),
  };
}

export function createEnrichmentCompleteEvent(
  contactId: string
): WsPushEvent {
  return {
    type: 'ENRICHMENT_COMPLETE',
    payload: { contactId },
    timestamp: new Date().toISOString(),
  };
}

export function createSettingsUpdatedEvent(
  settings: ExtensionSettings
): WsPushEvent {
  return {
    type: 'SETTINGS_UPDATED',
    payload: { settings },
    timestamp: new Date().toISOString(),
  };
}

export function createParseCompleteEvent(
  captureId: string,
  contactId: string | null,
  fieldsExtracted: number
): WsPushEvent {
  return {
    type: 'PARSE_COMPLETE',
    payload: { captureId, contactId, fieldsExtracted },
    timestamp: new Date().toISOString(),
  };
}
