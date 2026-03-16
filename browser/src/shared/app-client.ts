// HTTP + WebSocket client for communicating with the Next.js app

import type {
  CapturePayload,
  CaptureResponse,
  TasksResponse,
  TemplateResponse,
  HealthResponse,
  ExtensionSettings,
  ContactLookupResponse,
  WsMessage,
  WsOutMessage,
  AppConnectionState,
} from '../types';
import {
  WS_RECONNECT_INITIAL_MS,
  WS_RECONNECT_MAX_MS,
  WS_RECONNECT_MULTIPLIER,
} from './constants';
import { getToken, setConnectionState } from '../utils/storage';

export type WsEventHandler = (event: WsMessage) => void;

export class AppClient {
  private appUrl: string;
  private ws: WebSocket | null = null;
  private wsReconnectDelay: number = WS_RECONNECT_INITIAL_MS;
  private wsReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private wsEventHandlers: Map<string, WsEventHandler[]> = new Map();
  private _connectionState: AppConnectionState = 'disconnected';

  constructor(appUrl: string) {
    this.appUrl = appUrl;
  }

  // ---- HTTP Methods ----

  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const token = await getToken();
    if (!token) throw new Error('No extension token configured');

    const response = await fetch(`${this.appUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Extension-Token': token,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ message: response.statusText }));
      throw new Error(
        `API error ${response.status}: ${error.message || response.statusText}`
      );
    }

    return response.json() as Promise<T>;
  }

  async submitCapture(payload: CapturePayload): Promise<CaptureResponse> {
    return this.request<CaptureResponse>(
      'POST',
      '/api/extension/capture',
      payload
    );
  }

  async fetchTasks(status?: string, limit?: number): Promise<TasksResponse> {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (limit) params.set('limit', String(limit));
    const qs = params.toString();
    return this.request<TasksResponse>(
      'GET',
      `/api/extension/tasks${qs ? '?' + qs : ''}`
    );
  }

  async updateTask(
    taskId: string,
    status: 'completed' | 'skipped' | 'in_progress'
  ): Promise<unknown> {
    return this.request('PATCH', `/api/extension/tasks/${taskId}`, { status });
  }

  async checkHealth(): Promise<HealthResponse> {
    return this.request<HealthResponse>('GET', '/api/extension/health');
  }

  async fetchSettings(): Promise<{ settings: ExtensionSettings }> {
    return this.request<{ settings: ExtensionSettings }>(
      'GET',
      '/api/extension/settings'
    );
  }

  async lookupContact(linkedinUrl: string): Promise<ContactLookupResponse> {
    // The catch-all route expects URL segments, not an encoded URL
    const urlWithoutProtocol = linkedinUrl
      .replace('https://', '')
      .replace('http://', '');
    return this.request<ContactLookupResponse>(
      'GET',
      `/api/extension/contact/${urlWithoutProtocol}`
    );
  }

  async renderMessage(
    contactUrl: string,
    templateType?: string
  ): Promise<TemplateResponse> {
    return this.request<TemplateResponse>(
      'POST',
      '/api/extension/message-render',
      {
        contactUrl,
        templateType,
      }
    );
  }

  async register(
    displayToken: string
  ): Promise<{ success: boolean; extensionId: string; settings: ExtensionSettings }> {
    const response = await fetch(`${this.appUrl}/api/extension/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayToken }),
    });
    if (!response.ok) throw new Error('Registration failed');
    return response.json() as Promise<{
      success: boolean;
      extensionId: string;
      settings: ExtensionSettings;
    }>;
  }

  // ---- WebSocket Methods ----

  async connectWebSocket(): Promise<void> {
    const token = await getToken();
    if (!token) {
      this._connectionState = 'disconnected';
      await setConnectionState('disconnected');
      return;
    }

    this._connectionState = 'connecting';
    await setConnectionState('connecting');

    const wsUrl =
      this.appUrl.replace(/^http/, 'ws') +
      `/ws/extension?token=${encodeURIComponent(token)}`;

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = async () => {
        this._connectionState = 'connected';
        await setConnectionState('connected');
        this.wsReconnectDelay = WS_RECONNECT_INITIAL_MS;
        console.log('[AppClient] WebSocket connected');
      };

      this.ws.onmessage = (event: MessageEvent) => {
        try {
          const msg: WsMessage = JSON.parse(event.data as string);
          const handlers = this.wsEventHandlers.get(msg.type) || [];
          for (const handler of handlers) {
            handler(msg);
          }
          // Wildcard handlers
          const wildcardHandlers = this.wsEventHandlers.get('*') || [];
          for (const handler of wildcardHandlers) {
            handler(msg);
          }
        } catch {
          console.error('[AppClient] Failed to parse WS message');
        }
      };

      this.ws.onclose = async () => {
        this.ws = null;
        this._connectionState = 'disconnected';
        await setConnectionState('disconnected');
        console.log('[AppClient] WebSocket disconnected');
        this.scheduleReconnect();
      };

      this.ws.onerror = async () => {
        // WebSocket failure is non-fatal — HTTP polling still works
        this._connectionState = 'disconnected';
        await setConnectionState('disconnected');
      };
    } catch {
      // WebSocket unavailable — fall back to HTTP-only mode
      this._connectionState = 'disconnected';
      await setConnectionState('disconnected');
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.wsReconnectTimer) clearTimeout(this.wsReconnectTimer);
    this.wsReconnectTimer = setTimeout(() => {
      this.connectWebSocket();
    }, this.wsReconnectDelay);
    this.wsReconnectDelay = Math.min(
      this.wsReconnectDelay * WS_RECONNECT_MULTIPLIER,
      WS_RECONNECT_MAX_MS
    );
  }

  sendWsMessage(msg: WsOutMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  onWsEvent(eventType: string, handler: WsEventHandler): void {
    const handlers = this.wsEventHandlers.get(eventType) || [];
    handlers.push(handler);
    this.wsEventHandlers.set(eventType, handlers);
  }

  get connectionState(): AppConnectionState {
    return this._connectionState;
  }

  disconnectWebSocket(): void {
    if (this.wsReconnectTimer) clearTimeout(this.wsReconnectTimer);
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
