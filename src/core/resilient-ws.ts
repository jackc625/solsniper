import WebSocket from 'ws';
import { createModuleLogger } from './logger.js';
import type { ResilientWsConfig } from '../types/index.js';

/**
 * Abstract base class for WebSocket connections with:
 *  - Exponential backoff reconnection (DET-03): 2-5s base, 60s max, 15% jitter
 *  - Heartbeat-based silent-connection detection (DET-04): 30s interval, 2x window stale check
 *  - Excessive reconnect alerting (DET-05): sliding window threshold warning
 *
 * Subclasses must implement:
 *  - onMessage(data: string): handle incoming WebSocket messages
 *  - getSubscriptions(): return subscription payload objects sent on each open
 */
export abstract class ResilientWebSocket {
  private readonly config: ResilientWsConfig;
  private readonly log: ReturnType<typeof createModuleLogger>;

  private ws: WebSocket | null = null;
  private closed = false;

  // Reconnection state
  private reconnectCount = 0;
  private reconnectTimestamps: number[] = [];
  private currentBackoffMs: number;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  // Heartbeat state
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private lastMessageAt: number = 0;

  constructor(config: ResilientWsConfig) {
    this.config = config;
    this.currentBackoffMs = config.baseBackoffMs;
    this.log = createModuleLogger(`resilient-ws:${config.name}`);
  }

  /**
   * Called on each incoming WebSocket message.
   * Subclasses parse the message and emit domain events.
   */
  protected abstract onMessage(data: string): void;

  /**
   * Returns the list of subscription payloads to send after each (re)connect.
   * Subclasses return the JSON-serializable subscription objects for their protocol.
   */
  protected abstract getSubscriptions(): object[];

  /**
   * Opens the WebSocket connection. Safe to call from constructor or externally.
   */
  connect(): void {
    if (this.closed) return;

    this.log.info({ url: this.config.url }, 'Connecting');
    const ws = new WebSocket(this.config.url);
    this.ws = ws;

    ws.on('open', () => {
      this.log.info('Connected');
      this.resetBackoff();
      this.startHeartbeat();
      this.replaySubscriptions();
    });

    ws.on('message', (data: WebSocket.RawData) => {
      this.lastMessageAt = Date.now();
      this.onMessage(data.toString());
    });

    ws.on('close', (code: number, reason: Buffer) => {
      this.log.info({ code, reason: reason.toString() }, 'Disconnected');
      this.stopHeartbeat();
      this.scheduleReconnect();
    });

    ws.on('error', (err: Error) => {
      this.log.warn({ err: err.message }, 'WebSocket error');
      // 'error' is always followed by 'close', so reconnect is handled there
    });
  }

  /**
   * Closes the connection permanently. No further reconnection attempts.
   */
  close(): void {
    this.closed = true;
    this.stopHeartbeat();
    this.clearReconnectTimer();

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.log.debug('Connection closed');
  }

  /**
   * Returns total lifetime reconnection count (for monitoring).
   */
  getReconnectCount(): number {
    return this.reconnectCount;
  }

  /**
   * Returns the timestamp of the last received WebSocket message (Unix ms).
   * Used by HealthService to detect silence/inactivity.
   */
  getLastMessageAt(): number {
    return this.lastMessageAt;
  }

  /**
   * Returns true if close() has been called (graceful shutdown in progress).
   */
  isClosed(): boolean {
    return this.closed;
  }

  // ---------------------------------------------------------------------------
  // Private internals
  // ---------------------------------------------------------------------------

  /**
   * Sends all subscription payloads over the current WebSocket.
   */
  private replaySubscriptions(): void {
    const subscriptions = this.getSubscriptions();
    for (const sub of subscriptions) {
      this.send(JSON.stringify(sub));
    }
  }

  /**
   * Sends a raw string over the WebSocket. Silently drops if not open.
   */
  private send(data: string): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(data);
    }
  }

  /**
   * Schedules a reconnect attempt with exponential backoff + jitter.
   * No-ops if closed or a reconnect is already pending.
   */
  private scheduleReconnect(): void {
    if (this.closed) return;
    if (this.reconnectTimer !== null) return;

    const jitter = 1 + (Math.random() * 0.15); // 1.0 – 1.15x
    const backoffMs = Math.min(this.currentBackoffMs * jitter, this.config.maxBackoffMs);

    this.reconnectCount++;
    this.recordReconnectTimestamp();

    this.log.info(
      { reconnectCount: this.reconnectCount, backoffMs: Math.round(backoffMs) },
      'Scheduling reconnect'
    );

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      // Double backoff for next attempt (capped at maxBackoffMs)
      this.currentBackoffMs = Math.min(this.currentBackoffMs * 2, this.config.maxBackoffMs);
      this.connect();
    }, backoffMs);
  }

  /**
   * Tracks reconnect timestamp in the sliding window and warns on excessive reconnects.
   */
  private recordReconnectTimestamp(): void {
    const now = Date.now();
    this.reconnectTimestamps.push(now);

    // Prune entries outside the sliding window
    const windowStart = now - this.config.excessiveReconnectWindowMs;
    this.reconnectTimestamps = this.reconnectTimestamps.filter((ts) => ts >= windowStart);

    if (this.reconnectTimestamps.length >= this.config.excessiveReconnectThreshold) {
      this.log.warn(
        {
          reconnectsInWindow: this.reconnectTimestamps.length,
          windowMs: this.config.excessiveReconnectWindowMs,
          threshold: this.config.excessiveReconnectThreshold,
        },
        'Excessive reconnections detected -- WebSocket may be unstable'
      );
    }
  }

  /**
   * Resets backoff to base after a successful connection.
   */
  private resetBackoff(): void {
    this.currentBackoffMs = this.config.baseBackoffMs;
  }

  /**
   * Starts the heartbeat interval. Sends a ping every heartbeatIntervalMs.
   * If no message has been received within 2x the interval, terminates the connection
   * (which triggers reconnect via the close handler).
   */
  private startHeartbeat(): void {
    this.stopHeartbeat(); // Defensive: clear any existing timer
    this.lastMessageAt = Date.now(); // Treat connect itself as "alive"

    this.heartbeatTimer = setInterval(() => {
      const silenceMs = Date.now() - this.lastMessageAt;
      const maxSilenceMs = this.config.heartbeatIntervalMs * 2;

      if (silenceMs >= maxSilenceMs) {
        this.log.warn(
          { silenceMs, maxSilenceMs },
          'Heartbeat: no message received -- terminating stale connection'
        );
        // terminate() forces close without the WebSocket closing handshake,
        // ensuring the close event fires and triggers reconnect
        this.ws?.terminate();
        return;
      }

      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.ping();
      }
    }, this.config.heartbeatIntervalMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}
