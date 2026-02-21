import type { Connection } from '@solana/web3.js';
import { EventEmitter } from 'eventemitter3';
import { createModuleLogger } from '../core/logger.js';
import type { TokenEvent, DetectorEvents } from '../types/index.js';
import type { Env } from '../config/env.js';
import type { TradingConfig } from '../config/trading.js';
import { PumpPortalListener } from './pump-portal-listener.js';
import { RaydiumListener } from './raydium-listener.js';
import { preFilter } from './pre-filter.js';

const log = createModuleLogger('detection-manager');

interface DetectionStats {
  detected: number;
  filtered: number;
  dedupDropped: number;
  bySource: Record<string, number>;
}

/**
 * DetectionManager orchestrates all token detection listeners and provides:
 *  - Unified event emission via EventEmitter<DetectorEvents>
 *  - Mint-based deduplication using a Map<string, timestamp> for eviction (research Pitfall 5)
 *  - Pre-filtering of obvious junk tokens before safety pipeline
 *  - One-liner-per-token logging with latency measurement
 *  - Periodic stats every 15 minutes (configurable via tradingConfig.detection.statsIntervalMs)
 *  - Source toggling via PUMPPORTAL_ENABLED and RAYDIUM_ENABLED env vars
 *
 * Usage:
 *   const manager = new DetectionManager(env, tradingConfig, connection);
 *   manager.on('token', (event) => { ... });
 *   manager.start();
 *   // on shutdown:
 *   await manager.stop();
 */
export class DetectionManager extends EventEmitter<DetectorEvents> {
  private readonly env: Env;
  private readonly tradingConfig: TradingConfig;
  private readonly connection: Connection;

  private pumpPortalListener: PumpPortalListener | null = null;
  private raydiumListener: RaydiumListener | null = null;

  // Dedup: Map<mint, timestampMs> — entries evicted after dedupWindowMs
  private readonly seenMints = new Map<string, number>();

  private statsTimer: ReturnType<typeof setInterval> | null = null;

  private readonly stats: DetectionStats = {
    detected: 0,
    filtered: 0,
    dedupDropped: 0,
    bySource: {},
  };

  constructor(env: Env, tradingConfig: TradingConfig, connection: Connection) {
    super();
    this.env = env;
    this.tradingConfig = tradingConfig;
    this.connection = connection;
  }

  /**
   * Starts all enabled detection listeners and the stats timer.
   */
  start(): void {
    const { detection } = this.tradingConfig;

    if (this.env.PUMPPORTAL_ENABLED) {
      this.pumpPortalListener = new PumpPortalListener(
        {
          url: 'wss://pumpportal.fun/api/data',
          name: 'pump-portal',
          baseBackoffMs: detection.wsBaseBackoffMs,
          maxBackoffMs: detection.wsMaxBackoffMs,
          heartbeatIntervalMs: detection.wsHeartbeatIntervalMs,
          excessiveReconnectThreshold: detection.wsExcessiveReconnectThreshold,
          excessiveReconnectWindowMs: detection.wsExcessiveReconnectWindowMs,
        },
        this.handleTokenEvent.bind(this)
      );
      this.pumpPortalListener.connect();
    }

    if (this.env.RAYDIUM_ENABLED) {
      this.raydiumListener = new RaydiumListener(
        this.connection,
        this.handleTokenEvent.bind(this)
      );
      this.raydiumListener.start();
    }

    // Periodic stats logging (default: every 15 minutes)
    this.statsTimer = setInterval(
      () => this.logStats(),
      detection.statsIntervalMs
    );

    log.info(
      {
        pumpPortalEnabled: this.env.PUMPPORTAL_ENABLED,
        raydiumEnabled: this.env.RAYDIUM_ENABLED,
        statsIntervalMs: detection.statsIntervalMs,
      },
      'DetectionManager started'
    );
  }

  /**
   * Stops all detection listeners and the stats timer.
   */
  async stop(): Promise<void> {
    // Stop stats timer first
    if (this.statsTimer !== null) {
      clearInterval(this.statsTimer);
      this.statsTimer = null;
    }

    // Stop PumpPortal (WebSocket)
    if (this.pumpPortalListener !== null) {
      this.pumpPortalListener.close();
      this.pumpPortalListener = null;
    }

    // Stop Raydium (onLogs subscriptions)
    if (this.raydiumListener !== null) {
      await this.raydiumListener.stop();
      this.raydiumListener = null;
    }

    log.debug('DetectionManager stopped');
  }

  // ---------------------------------------------------------------------------
  // Token event processing
  // ---------------------------------------------------------------------------

  /**
   * Central handler for all token events from all sources.
   * Applies dedup, pre-filter, logging, and emission.
   */
  handleTokenEvent(event: TokenEvent): void {
    // Dedup check: skip if we've seen this mint recently
    if (this.seenMints.has(event.mint)) {
      this.stats.dedupDropped++;
      log.debug({ mint: event.mint, source: event.source }, 'Duplicate token event skipped');
      return;
    }

    // Add to dedup set with timestamp for eviction
    this.seenMints.set(event.mint, Date.now());

    // Increment total detected counter
    this.stats.detected++;
    this.stats.bySource[event.source] = (this.stats.bySource[event.source] ?? 0) + 1;

    // Apply pre-filter
    const filterResult = preFilter(event);
    const latencyMs = Date.now() - event.detectedAt;

    // One-liner log per user spec: mint, source, latency, pre-filter result (info level)
    log.info(
      { mint: event.mint, source: event.source, latencyMs, preFilter: filterResult },
      'Token detected'
    );

    if (!filterResult.pass) {
      // Filtered-out tokens logged at debug level per user spec
      log.debug(
        { mint: event.mint, source: event.source, reason: filterResult.reason },
        'Token filtered out by pre-filter'
      );
      this.stats.filtered++;
      return;
    }

    // Emit to downstream consumers (Phase 3: safety pipeline)
    this.emit('token', event);
  }

  // ---------------------------------------------------------------------------
  // Stats logging with dedup eviction
  // ---------------------------------------------------------------------------

  logStats(): void {
    // Log periodic stats at info level
    log.info(
      {
        total: this.stats.detected,
        filtered: this.stats.filtered,
        dedupDropped: this.stats.dedupDropped,
        bySource: this.stats.bySource,
        seenMintsSize: this.seenMints.size,
      },
      'Detection stats (15m)'
    );

    // Dedup eviction: prune entries older than dedupWindowMs (research Pitfall 5)
    // Prevents unbounded memory growth — pump.fun creates thousands of tokens daily
    const now = Date.now();
    const cutoffMs = now - this.tradingConfig.detection.dedupWindowMs;
    let evicted = 0;

    for (const [mint, timestamp] of this.seenMints) {
      if (timestamp < cutoffMs) {
        this.seenMints.delete(mint);
        evicted++;
      }
    }

    if (evicted > 0) {
      log.debug({ evicted, remainingSize: this.seenMints.size }, 'Dedup entries evicted');
    }
  }
}
