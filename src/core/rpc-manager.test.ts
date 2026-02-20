import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RpcManager } from './rpc-manager.js';

// Use fake URLs — no real RPC calls are made in these unit tests
const PRIMARY_URL = 'https://primary.example.com';
const BACKUP_URL = 'https://backup.example.com';

describe('RpcManager', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns primary connection by default', () => {
    const rpc = new RpcManager(PRIMARY_URL, BACKUP_URL);
    expect(rpc.getState()).toBe('primary');
    // getConnection() returns the primary Connection instance
    const conn = rpc.getConnection();
    expect(conn).toBeDefined();
    rpc.close();
  });

  it('stays on primary after fewer than 3 consecutive failures', () => {
    const rpc = new RpcManager(PRIMARY_URL, BACKUP_URL);

    rpc.recordFailure('timeout');
    rpc.recordFailure('timeout');

    expect(rpc.getState()).toBe('primary');
    rpc.close();
  });

  it('switches to backup after 3 consecutive failures', () => {
    const rpc = new RpcManager(PRIMARY_URL, BACKUP_URL);

    const failoverEvents: Array<{ from: string; to: string; reason: string; consecutiveFailures: number }> = [];
    rpc.on('failover', (data) => failoverEvents.push(data));

    rpc.recordFailure('connection refused');
    rpc.recordFailure('connection refused');
    rpc.recordFailure('connection refused');

    expect(rpc.getState()).toBe('backup');
    expect(failoverEvents).toHaveLength(1);
    expect(failoverEvents[0]).toEqual({
      from: 'primary',
      to: 'backup',
      reason: 'connection refused',
      consecutiveFailures: 3,
    });

    rpc.close();
  });

  it('emits degraded event on each failure with correct consecutiveFailures count', () => {
    const rpc = new RpcManager(PRIMARY_URL, BACKUP_URL);

    const degradedEvents: Array<{ endpoint: string; consecutiveFailures: number }> = [];
    rpc.on('degraded', (data) => degradedEvents.push(data));

    rpc.recordFailure('timeout');

    expect(degradedEvents).toHaveLength(1);
    expect(degradedEvents[0]).toEqual({ endpoint: 'primary', consecutiveFailures: 1 });

    rpc.close();
  });

  it('resets failure count on success — requires 3 consecutive new failures to failover', () => {
    const rpc = new RpcManager(PRIMARY_URL, BACKUP_URL);

    const failoverEvents: Array<unknown> = [];
    rpc.on('failover', (data) => failoverEvents.push(data));

    // 2 failures then a success — counter resets
    rpc.recordFailure('timeout');
    rpc.recordFailure('timeout');
    rpc.recordSuccess();

    // These 3 new failures should trigger failover (consecutive count is now 3)
    rpc.recordFailure('timeout');
    rpc.recordFailure('timeout');
    rpc.recordFailure('timeout');

    // Should have failed over exactly once
    expect(failoverEvents).toHaveLength(1);
    expect(rpc.getState()).toBe('backup');

    rpc.close();
  });

  it('close() stops recovery timer — no lingering intervals', () => {
    const rpc = new RpcManager(PRIMARY_URL, BACKUP_URL);

    // Trigger failover to start recovery polling
    rpc.recordFailure('timeout');
    rpc.recordFailure('timeout');
    rpc.recordFailure('timeout');

    expect(rpc.getState()).toBe('backup');

    // Track how many intervals are running before and after close()
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');

    rpc.close();

    // clearInterval should have been called to stop the recovery timer
    expect(clearIntervalSpy.mock.calls.length).toBeGreaterThanOrEqual(1);

    clearIntervalSpy.mockRestore();
  });
});
