// WebSocket server for real-time extension communication
// Provides push events from server to connected extensions

import { WebSocketServer, WebSocket } from 'ws';
import { createHash } from 'crypto';
import type { IncomingMessage } from 'http';
import { validateExtensionToken } from '@/lib/auth/extension-auth';
import { isAllowedExtensionOrigin, trustedLoopbackHost } from '@/lib/auth/local-request-boundary';

export interface WsPushEvent {
  type:
    | 'CAPTURE_CONFIRMED'
    | 'TASK_CREATED'
    | 'TASK_UPDATED'
    | 'GOAL_PROGRESS'
    | 'TEMPLATE_READY'
    | 'ENRICHMENT_COMPLETE'
    | 'SETTINGS_UPDATED'
    | 'PARSE_COMPLETE';
  payload: Record<string, unknown>;
  timestamp: string;
}

export interface WsReceiveEvent {
  type: 'PAGE_NAVIGATED' | 'TASK_VIEWED';
  payload: Record<string, unknown>;
}

export interface AuthenticatedSocket extends WebSocket {
  extensionId: string;
  isAlive: boolean;
  connectedAt: Date;
  expiresAt: number;
  /** Timestamp (ms) of the last ping we sent and are awaiting a pong for. */
  lastPingAt?: number;
}

const HEARTBEAT_INTERVAL_MS = 30_000;
// Pong timeout: if a ping is not answered within this window, terminate the
// socket. Previously this constant was defined but never wired up (see
// `stub-inventory.md:25`); the heartbeat below now tracks each ping it emits
// and enforces the timeout on the next tick.
const PONG_TIMEOUT_MS = 10_000;

class ExtensionWebSocketServer {
  private wss: WebSocketServer | null = null;
  private clients: Map<string, AuthenticatedSocket> = new Map();
  // A snapshot taken before a DELETE must never install a socket afterward.
  // Keep generations for this process lifetime because an in-flight DB lookup
  // can return a pre-revocation row after DELETE has committed.
  private tokenGenerations = new Map<string, number>();
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private _isRunning = false;

  get isRunning(): boolean {
    return this._isRunning;
  }

  /**
   * Initialize the WebSocket server attached to an HTTP server.
   * Handles upgrade requests on the /ws/extension path.
   */
  init(server: import('http').Server): void {
    this.wss = new WebSocketServer({ noServer: true });

    server.on('upgrade', async (request, socket, head) => {
      const localOrigin = trustedLoopbackHost(request.headers.host);
      if (!localOrigin || !request.headers.origin || !isAllowedExtensionOrigin(request.headers.origin)) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
      }
      let url: URL;
      try {
        url = new URL(request.url ?? '', localOrigin);
      } catch {
        socket.destroy();
        return;
      }

      if (url.pathname !== '/ws/extension') {
        socket.destroy();
        return;
      }

      const token = url.searchParams.get('token');
      if (!token) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      const tokenHash = createHash('sha256').update(token).digest('hex');
      const generation = this.tokenGenerations.get(tokenHash) ?? 0;

      try {
        const validation = await validateExtensionToken(token);
        if (!validation.valid || !validation.extensionId || generation !== 0 ||
          (this.tokenGenerations.get(tokenHash) ?? 0) !== generation) {
          const code = validation.error === 'REVOKED_TOKEN' ? 4002 : 4001;
          socket.write(`HTTP/1.1 401 Unauthorized\r\nX-Close-Code: ${code}\r\n\r\n`);
          socket.destroy();
          return;
        }

        this.wss!.handleUpgrade(request, socket, head, (ws) => {
          // The operator may revoke between the first DB check and handshake.
          // Recheck before installing the socket; no await follows that check.
          void validateExtensionToken(token).then((latest) => {
            if (!latest.valid || !latest.extensionId || !latest.expiresAt || generation !== 0 ||
              (this.tokenGenerations.get(tokenHash) ?? 0) !== generation) {
              ws.close(4002, 'Token revoked or expired');
              return;
            }
            const authWs = ws as AuthenticatedSocket;
            authWs.extensionId = latest.extensionId;
            authWs.expiresAt = latest.expiresAt;
            authWs.isAlive = true;
            authWs.connectedAt = new Date();
            this.wss!.emit('connection', authWs, request);
          }).catch(() => ws.close(1011, 'Token validation unavailable'));
        });
      } catch {
        socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
        socket.destroy();
      }
    });

    this.wss.on('connection', (ws: AuthenticatedSocket, _req: IncomingMessage) => {
      this.handleConnection(ws);
    });

    this.startHeartbeat();
    this._isRunning = true;
    console.log('[WS] Extension WebSocket server initialized on /ws/extension');
  }

  private handleConnection(ws: AuthenticatedSocket): void {
    console.log(`[WS] Extension connected: ${ws.extensionId}`);

    // Close existing connection for this extension (single connection per extension)
    const existing = this.clients.get(ws.extensionId);
    if (existing) {
      existing.close(4003, 'Replaced by new connection');
      this.clients.delete(ws.extensionId);
    }

    this.clients.set(ws.extensionId, ws);

    ws.on('pong', () => {
      ws.isAlive = true;
      ws.lastPingAt = undefined;
    });

    ws.on('message', (data: Buffer | string) => {
      this.handleMessage(ws, data.toString());
    });

    ws.on('close', () => {
      console.log(`[WS] Extension disconnected: ${ws.extensionId}`);
      if (this.clients.get(ws.extensionId) === ws) {
        this.clients.delete(ws.extensionId);
      }
    });

    ws.on('error', (err) => {
      console.error(`[WS] Error from ${ws.extensionId}:`, err.message);
    });
  }

  private handleMessage(ws: AuthenticatedSocket, data: string): void {
    if (this.closeIfExpired(ws)) return;
    try {
      const event = JSON.parse(data) as WsReceiveEvent;

      switch (event.type) {
        case 'PAGE_NAVIGATED':
          console.log(
            `[WS] Page navigated by ${ws.extensionId}:`,
            event.payload
          );
          break;
        case 'TASK_VIEWED':
          console.log(
            `[WS] Task viewed by ${ws.extensionId}:`,
            event.payload
          );
          break;
        default:
          console.log(`[WS] Unknown message type from ${ws.extensionId}:`, data);
      }
    } catch {
      console.error(`[WS] Invalid message from ${ws.extensionId}:`, data);
    }
  }

  /**
   * Push an event to a specific extension.
   */
  pushToExtension(extensionId: string, event: WsPushEvent): boolean {
    const client = this.clients.get(extensionId);
    if (!client || this.closeIfExpired(client) || client.readyState !== WebSocket.OPEN) {
      return false;
    }
    client.send(JSON.stringify(event));
    return true;
  }

  /**
   * Push an event to all connected extensions.
   */
  pushToAll(event: WsPushEvent): void {
    const message = JSON.stringify(event);
    for (const client of this.clients.values()) {
      if (!this.closeIfExpired(client) && client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    }
  }

  /**
   * Get list of connected extension IDs.
   */
  getConnectedClients(): string[] {
    return Array.from(this.clients.values())
      .filter(client => !this.closeIfExpired(client))
      .map(client => client.extensionId);
  }

  /**
   * Check if a specific extension is connected.
   */
  isClientConnected(extensionId: string): boolean {
    const client = this.clients.get(extensionId);
    return !!client && !this.closeIfExpired(client) && client.readyState === WebSocket.OPEN;
  }

  /** Stop an active session immediately when the operator revokes its token. */
  disconnectExtension(extensionId: string, tokenHash: string): void {
    this.tokenGenerations.set(tokenHash, (this.tokenGenerations.get(tokenHash) ?? 0) + 1);
    const client = this.clients.get(extensionId);
    if (!client) return;
    this.clients.delete(extensionId);
    client.close(4002, 'Token revoked');
  }

  private closeIfExpired(client: AuthenticatedSocket): boolean {
    if (Date.now() < client.expiresAt) return false;
    if (this.clients.get(client.extensionId) === client) {
      this.clients.delete(client.extensionId);
    }
    client.close(4002, 'Token expired');
    return true;
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      const now = Date.now();
      for (const [id, client] of this.clients) {
        if (this.closeIfExpired(client)) continue;
        // If a ping is outstanding beyond PONG_TIMEOUT_MS, the peer is gone.
        if (
          client.lastPingAt !== undefined &&
          now - client.lastPingAt >= PONG_TIMEOUT_MS
        ) {
          console.log(`[WS] Terminating dead connection (pong timeout): ${id}`);
          client.terminate();
          this.clients.delete(id);
          continue;
        }
        // Backstop: if the prior heartbeat cycle flagged this client dead.
        if (!client.isAlive) {
          console.log(`[WS] Terminating dead connection: ${id}`);
          client.terminate();
          this.clients.delete(id);
          continue;
        }
        client.isAlive = false;
        client.lastPingAt = now;
        client.ping();
      }
    }, HEARTBEAT_INTERVAL_MS);

    if (this.heartbeatInterval && typeof this.heartbeatInterval === 'object' && 'unref' in this.heartbeatInterval) {
      this.heartbeatInterval.unref();
    }
  }

  /**
   * Shut down the WebSocket server.
   */
  shutdown(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    for (const client of this.clients.values()) {
      client.close(1001, 'Server shutting down');
    }
    this.clients.clear();

    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }

    this._isRunning = false;
    console.log('[WS] Extension WebSocket server shut down');
  }
}

// Singleton instance
export const wsServer = new ExtensionWebSocketServer();
