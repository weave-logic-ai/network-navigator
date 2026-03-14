// WebSocket message protocol between extension and app
import type { ExtensionTask } from './task';
import type { CaptureResult } from './capture';
import type { ExtensionSettings } from './settings';

export type WsMessage =
  | { type: 'TASK_PUSH'; tasks: ExtensionTask[] }
  | { type: 'TASK_UPDATE'; taskId: string; status: string }
  | { type: 'SETTINGS_UPDATE'; settings: Partial<ExtensionSettings> }
  | { type: 'CAPTURE_ACK'; captureId: string; result: CaptureResult }
  | { type: 'PING' }
  | { type: 'PONG' };
