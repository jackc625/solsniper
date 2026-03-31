/**
 * MetricsTracker -- Sliding window latency and error rate tracking per endpoint (REL-03).
 *
 * Records per-endpoint latency and success/failure entries in a 5-minute sliding window.
 * Computes p50, p99 percentiles and error rate on demand via sorted array (exact, not
 * approximate) per research recommendation. Prunes stale entries both on access and
 * via a periodic 60-second timer to prevent memory growth (Pitfall 5).
 */
import { createModuleLogger } from '../core/logger.js';

const log = createModuleLogger('metrics-tracker');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MetricEntry {
  latencyMs: number;
  success: boolean;
  ts: number;
}

export interface EndpointStats {
  p50: number;
  p99: number;
  errorRate: number;
  count: number;
}

// ---------------------------------------------------------------------------
// MetricsTracker
// ---------------------------------------------------------------------------

export class MetricsTracker {
  private readonly windows = new Map<string, MetricEntry[]>();
  private readonly windowMs: number;
  private readonly pruneTimer: ReturnType<typeof setInterval>;

  constructor(windowMs: number = 300_000) {
    this.windowMs = windowMs;

    // Periodic prune every 60 seconds to prevent memory growth
    this.pruneTimer = setInterval(() => this.pruneAll(), 60_000);

    log.debug({ windowMs }, 'MetricsTracker initialized');
  }

  /**
   * Records a latency entry for a given endpoint.
   */
  record(endpoint: string, latencyMs: number, success: boolean): void {
    let entries = this.windows.get(endpoint);
    if (!entries) {
      entries = [];
      this.windows.set(endpoint, entries);
    }

    entries.push({ latencyMs, success, ts: Date.now() });
  }

  /**
   * Returns computed stats for a specific endpoint within the sliding window.
   * Also prunes stale entries for this endpoint (in-place).
   */
  getStats(endpoint: string): EndpointStats {
    const cutoff = Date.now() - this.windowMs;
    let entries = this.windows.get(endpoint);

    if (!entries) {
      return { p50: 0, p99: 0, errorRate: 0, count: 0 };
    }

    // In-place prune: filter to entries within window
    entries = entries.filter((e) => e.ts >= cutoff);
    this.windows.set(endpoint, entries);

    if (entries.length === 0) {
      return { p50: 0, p99: 0, errorRate: 0, count: 0 };
    }

    // Sort latencies ascending for percentile computation
    const latencies = entries.map((e) => e.latencyMs).sort((a, b) => a - b);
    const total = latencies.length;

    const p50 = latencies[Math.floor(total * 0.5)];
    const p99 = latencies[Math.floor(total * 0.99)];
    const errors = entries.filter((e) => !e.success).length;
    const errorRate = errors / total;

    return { p50, p99, errorRate, count: total };
  }

  /**
   * Returns stats for all tracked endpoints. Omits endpoints with count=0 after prune.
   */
  getAllStats(): Record<string, EndpointStats> {
    const result: Record<string, EndpointStats> = {};

    for (const endpoint of this.windows.keys()) {
      const stats = this.getStats(endpoint);
      if (stats.count > 0) {
        result[endpoint] = stats;
      }
    }

    return result;
  }

  /**
   * Stops the periodic prune timer. Called on shutdown.
   */
  close(): void {
    clearInterval(this.pruneTimer);
    log.debug('MetricsTracker closed');
  }

  /**
   * Prunes all endpoints: removes entries older than windowMs.
   * Deletes endpoint key entirely if array is empty after prune.
   */
  private pruneAll(): void {
    const cutoff = Date.now() - this.windowMs;

    for (const [endpoint, entries] of this.windows) {
      const fresh = entries.filter((e) => e.ts >= cutoff);
      if (fresh.length === 0) {
        this.windows.delete(endpoint);
      } else {
        this.windows.set(endpoint, fresh);
      }
    }
  }
}
