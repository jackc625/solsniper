import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MetricsTracker, type EndpointStats } from './metrics-tracker.js';

describe('MetricsTracker', () => {
  let tracker: MetricsTracker;

  beforeEach(() => {
    vi.useFakeTimers();
    // 5-minute window (300_000ms)
    tracker = new MetricsTracker(300_000);
  });

  afterEach(() => {
    tracker.close();
    vi.useRealTimers();
  });

  // ------------------------------------------------------------------
  // Basic recording and stats
  // ------------------------------------------------------------------

  it('records entries and getStats returns correct count', () => {
    tracker.record('jupiter-quote', 100, true);
    tracker.record('jupiter-quote', 200, true);
    tracker.record('jupiter-quote', 150, false);

    const stats = tracker.getStats('jupiter-quote');
    expect(stats.count).toBe(3);
  });

  it('computes p50 correctly', () => {
    // Latencies: 10, 20, 30, 40, 50
    tracker.record('rpc', 10, true);
    tracker.record('rpc', 20, true);
    tracker.record('rpc', 30, true);
    tracker.record('rpc', 40, true);
    tracker.record('rpc', 50, true);

    const stats = tracker.getStats('rpc');
    // p50 = latencies[Math.floor(5 * 0.5)] = latencies[2] = 30
    expect(stats.p50).toBe(30);
  });

  it('computes p99 correctly with 100 entries', () => {
    // Latencies 1 through 100
    for (let i = 1; i <= 100; i++) {
      tracker.record('helius', i, true);
    }

    const stats = tracker.getStats('helius');
    // p99 = latencies[Math.floor(100 * 0.99)] = latencies[99] = 100
    expect(stats.p99).toBe(100);
  });

  it('computes errorRate correctly', () => {
    // 8 success + 2 failure = 20% error rate
    for (let i = 0; i < 8; i++) {
      tracker.record('rugcheck', 50, true);
    }
    tracker.record('rugcheck', 50, false);
    tracker.record('rugcheck', 50, false);

    const stats = tracker.getStats('rugcheck');
    expect(stats.errorRate).toBeCloseTo(0.2);
  });

  // ------------------------------------------------------------------
  // Empty endpoint
  // ------------------------------------------------------------------

  it('returns all zeros for empty/unknown endpoint', () => {
    const stats = tracker.getStats('nonexistent');
    expect(stats).toEqual({
      p50: 0,
      p99: 0,
      errorRate: 0,
      count: 0,
    });
  });

  // ------------------------------------------------------------------
  // Sliding window
  // ------------------------------------------------------------------

  it('prunes entries older than windowMs on getStats', () => {
    tracker.record('rpc', 100, true);
    tracker.record('rpc', 200, true);

    // Advance time past the 5-minute window
    vi.advanceTimersByTime(300_001);

    const stats = tracker.getStats('rpc');
    expect(stats.count).toBe(0);
    expect(stats.p50).toBe(0);
  });

  // ------------------------------------------------------------------
  // getAllStats
  // ------------------------------------------------------------------

  it('getAllStats returns stats for all recorded endpoints', () => {
    tracker.record('jupiter', 100, true);
    tracker.record('helius', 200, false);

    const all = tracker.getAllStats();
    expect(all).toHaveProperty('jupiter');
    expect(all).toHaveProperty('helius');
    expect(all['jupiter'].count).toBe(1);
    expect(all['helius'].count).toBe(1);
    expect(all['helius'].errorRate).toBe(1.0);
  });

  it('getAllStats omits endpoints with no entries after prune', () => {
    tracker.record('stale', 50, true);

    // Advance past window
    vi.advanceTimersByTime(300_001);

    // Add a fresh entry on another endpoint
    tracker.record('fresh', 100, true);

    const all = tracker.getAllStats();
    expect(all).not.toHaveProperty('stale');
    expect(all).toHaveProperty('fresh');
  });

  // ------------------------------------------------------------------
  // Periodic pruning
  // ------------------------------------------------------------------

  it('periodic pruneAll clears stale entries after 60s timer tick', () => {
    tracker.record('rpc', 100, true);

    // Advance past the 5-minute window
    vi.advanceTimersByTime(300_001);

    // Trigger periodic prune (60s interval)
    vi.advanceTimersByTime(60_000);

    // getStats should show 0 count since pruneAll already ran
    const stats = tracker.getStats('rpc');
    expect(stats.count).toBe(0);
  });

  // ------------------------------------------------------------------
  // Cleanup
  // ------------------------------------------------------------------

  it('close() stops the prune timer', () => {
    const clearSpy = vi.spyOn(globalThis, 'clearInterval');
    tracker.close();

    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });
});
