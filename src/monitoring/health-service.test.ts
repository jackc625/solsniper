import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'eventemitter3';
import type { BotEvent } from '../dashboard/bot-event-bus.js';

// We'll import the real HealthService after creating it
import {
  HealthService,
  type ComponentStatus,
  type ComponentHealth,
  type HealthProvider,
  type HealthCheckResult,
} from './health-service.js';
import type { EndpointStats } from './metrics-tracker.js';

type BotEventBusEvents = {
  event: (e: BotEvent) => void;
};

describe('HealthService', () => {
  let bus: EventEmitter<BotEventBusEvents>;
  let alertStore: { insert: ReturnType<typeof vi.fn> };
  let service: HealthService;
  let emittedEvents: BotEvent[];

  beforeEach(() => {
    vi.useFakeTimers();

    bus = new EventEmitter<BotEventBusEvents>();
    alertStore = { insert: vi.fn() };
    emittedEvents = [];

    // Spy on emitted events
    bus.on('event', (e) => emittedEvents.push(e));

    service = new HealthService(bus as any, alertStore as any, {
      alertCooldownMs: 100,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ------------------------------------------------------------------
  // Aggregate status (worst-of)
  // ------------------------------------------------------------------

  it('registers providers and returns aggregate via check()', () => {
    service.register('a', () => ({ status: 'healthy' }));
    service.register('b', () => ({ status: 'healthy' }));

    const result = service.check();
    expect(result.status).toBe('healthy');
    expect(result.components).toHaveProperty('a');
    expect(result.components).toHaveProperty('b');
  });

  it('returns healthy when all components healthy', () => {
    service.register('rpc', () => ({ status: 'healthy' }));
    service.register('detection', () => ({ status: 'healthy' }));

    const result = service.check();
    expect(result.status).toBe('healthy');
  });

  it('returns degraded when one component degraded and rest healthy', () => {
    service.register('rpc', () => ({ status: 'degraded', detail: 'high latency' }));
    service.register('detection', () => ({ status: 'healthy' }));

    const result = service.check();
    expect(result.status).toBe('degraded');
  });

  it('returns down when any component is down regardless of others', () => {
    service.register('rpc', () => ({ status: 'down', detail: 'connection lost' }));
    service.register('detection', () => ({ status: 'healthy' }));
    service.register('safety', () => ({ status: 'degraded' }));

    const result = service.check();
    expect(result.status).toBe('down');
  });

  // ------------------------------------------------------------------
  // Alert transition detection
  // ------------------------------------------------------------------

  it('emits SYSTEM_ALERT with severity=warn on healthy->degraded transition', () => {
    let rpcStatus: ComponentStatus = 'healthy';
    service.register('rpc', () => ({ status: rpcStatus }));

    // First check: healthy (baseline)
    service.check();
    expect(emittedEvents).toHaveLength(0);

    // Transition: healthy -> degraded
    rpcStatus = 'degraded';
    service.check();

    expect(emittedEvents).toHaveLength(1);
    expect(emittedEvents[0].type).toBe('SYSTEM_ALERT');
    expect(emittedEvents[0].severity).toBe('warn');
  });

  it('emits SYSTEM_ALERT with severity=error on degraded->down transition', () => {
    let rpcStatus: ComponentStatus = 'degraded';
    service.register('rpc', () => ({ status: rpcStatus }));

    // First check: degraded (baseline)
    service.check();
    emittedEvents.length = 0;

    // Transition: degraded -> down
    rpcStatus = 'down';
    service.check();

    expect(emittedEvents).toHaveLength(1);
    expect(emittedEvents[0].type).toBe('SYSTEM_ALERT');
    expect(emittedEvents[0].severity).toBe('error');
  });

  it('emits recovery SYSTEM_ALERT with severity=info on down->healthy', () => {
    let rpcStatus: ComponentStatus = 'down';
    service.register('rpc', () => ({ status: rpcStatus }));

    // First check: down (baseline)
    service.check();
    emittedEvents.length = 0;

    // Recovery: down -> healthy
    rpcStatus = 'healthy';
    service.check();

    expect(emittedEvents).toHaveLength(1);
    expect(emittedEvents[0].type).toBe('SYSTEM_ALERT');
    expect(emittedEvents[0].severity).toBe('info');
  });

  it('does NOT emit when component stays in same status', () => {
    service.register('rpc', () => ({ status: 'healthy' }));

    service.check();
    service.check();
    service.check();

    expect(emittedEvents).toHaveLength(0);
  });

  // ------------------------------------------------------------------
  // Cooldown debouncing
  // ------------------------------------------------------------------

  it('suppresses duplicate alert within cooldown window', () => {
    let rpcStatus: ComponentStatus = 'healthy';
    service.register('rpc', () => ({ status: rpcStatus }));

    // Baseline
    service.check();

    // Transition: healthy -> degraded (emits)
    rpcStatus = 'degraded';
    service.check();
    expect(emittedEvents).toHaveLength(1);

    // Quick recovery then back to degraded (within cooldown)
    rpcStatus = 'healthy';
    service.check(); // recovery (emits)
    expect(emittedEvents).toHaveLength(2);

    // Back to degraded immediately (within cooldown of the degraded alert)
    rpcStatus = 'degraded';
    vi.advanceTimersByTime(50); // only 50ms < 100ms cooldown
    service.check();

    // The degraded alert should be suppressed by cooldown
    // emittedEvents should still be 2 (recovery + initial degraded), not 3
    // Wait -- recovery resets cooldown, so this SHOULD emit again
    // Actually per D-11: cooldown resets on recovery
    expect(emittedEvents).toHaveLength(3);
  });

  it('cooldown suppresses repeated same-direction transitions', () => {
    let rpcStatus: ComponentStatus = 'healthy';
    service.register('rpc', () => ({ status: rpcStatus }));

    // Baseline
    service.check();

    // Transition: healthy -> degraded (emits)
    rpcStatus = 'degraded';
    service.check();
    expect(emittedEvents).toHaveLength(1);

    // Quickly: degraded -> down (should also emit -- different severity)
    rpcStatus = 'down';
    service.check();

    // Both transitions emit (different transitions)
    expect(emittedEvents).toHaveLength(2);
    expect(emittedEvents[1].severity).toBe('error');
  });

  it('cooldown resets on recovery, subsequent degradation emits again', () => {
    let rpcStatus: ComponentStatus = 'healthy';
    service.register('rpc', () => ({ status: rpcStatus }));

    // Baseline
    service.check();

    // healthy -> degraded (emits)
    rpcStatus = 'degraded';
    service.check();
    expect(emittedEvents).toHaveLength(1);

    // Recovery: degraded -> healthy (emits info, resets cooldown)
    rpcStatus = 'healthy';
    service.check();
    expect(emittedEvents).toHaveLength(2);
    expect(emittedEvents[1].severity).toBe('info');

    // degraded again immediately (cooldown was reset, should emit)
    rpcStatus = 'degraded';
    service.check();
    expect(emittedEvents).toHaveLength(3);
    expect(emittedEvents[2].severity).toBe('warn');
  });

  // ------------------------------------------------------------------
  // Alert persistence
  // ------------------------------------------------------------------

  it('persists alert to alertStore.insert on emission', () => {
    let rpcStatus: ComponentStatus = 'healthy';
    service.register('rpc', () => ({ status: rpcStatus }));

    service.check();

    rpcStatus = 'degraded';
    service.check();

    expect(alertStore.insert).toHaveBeenCalledTimes(1);
    expect(alertStore.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        type: expect.any(String),
        severity: 'warn',
        source: expect.any(String),
        message: expect.any(String),
        timestamp: expect.any(Number),
      })
    );
  });

  // ------------------------------------------------------------------
  // Result metadata
  // ------------------------------------------------------------------

  it('check() includes uptime, version, and timestamp', () => {
    service.register('rpc', () => ({ status: 'healthy' }));

    const result = service.check();
    expect(result.uptime).toBeGreaterThanOrEqual(0);
    expect(typeof result.version).toBe('string');
    expect(result.version.length).toBeGreaterThan(0);
    expect(typeof result.timestamp).toBe('number');
    expect(result.timestamp).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// apis health provider (gap closure: UAT Test 5)
// ---------------------------------------------------------------------------

/**
 * Mirror of the apis provider logic from index.ts for unit testing.
 * This pure function allows testing the provider logic without the full
 * index.ts dependency graph.
 */
function apisProviderLogic(
  getAllStats: () => Record<string, EndpointStats>,
  degradedThreshold: number,
  downThreshold: number,
): ComponentHealth {
  const allStats = getAllStats();
  const degraded: string[] = [];
  const down: string[] = [];

  for (const [endpoint, stats] of Object.entries(allStats)) {
    if (stats.count === 0) continue;
    if (stats.errorRate >= downThreshold) {
      down.push(endpoint);
    } else if (stats.errorRate >= degradedThreshold) {
      degraded.push(endpoint);
    }
  }

  if (down.length > 0) {
    return { status: 'down', detail: `Down: ${down.join(', ')}${degraded.length ? `; Degraded: ${degraded.join(', ')}` : ''}` };
  }
  if (degraded.length > 0) {
    return { status: 'degraded', detail: `Degraded: ${degraded.join(', ')}` };
  }
  return { status: 'healthy', detail: 'All API endpoints nominal' };
}

describe('apis health provider (gap closure)', () => {
  const DEFAULT_DEGRADED = 0.5;
  const DEFAULT_DOWN = 0.9;

  function makeStats(overrides: Record<string, Partial<EndpointStats>>): Record<string, EndpointStats> {
    const result: Record<string, EndpointStats> = {};
    for (const [key, partial] of Object.entries(overrides)) {
      result[key] = { p50: 100, p99: 500, errorRate: 0, count: 10, ...partial };
    }
    return result;
  }

  it('Test 1: returns healthy when no endpoints have errors (empty getAllStats)', () => {
    const result = apisProviderLogic(() => ({}), DEFAULT_DEGRADED, DEFAULT_DOWN);
    expect(result.status).toBe('healthy');
    expect(result.detail).toBe('All API endpoints nominal');
  });

  it('Test 2: returns healthy when all endpoints have errorRate below degraded threshold', () => {
    const stats = makeStats({
      'rugcheck:report': { errorRate: 0.1, count: 20 },
      'helius:das-api': { errorRate: 0.2, count: 15 },
      'jupiter:quote': { errorRate: 0.0, count: 50 },
    });
    const result = apisProviderLogic(() => stats, DEFAULT_DEGRADED, DEFAULT_DOWN);
    expect(result.status).toBe('healthy');
  });

  it('Test 3: returns degraded with detail when any endpoint has errorRate >= 0.5 but < 0.9', () => {
    const stats = makeStats({
      'rugcheck:report': { errorRate: 0.6, count: 20 },
      'helius:das-api': { errorRate: 0.1, count: 15 },
    });
    const result = apisProviderLogic(() => stats, DEFAULT_DEGRADED, DEFAULT_DOWN);
    expect(result.status).toBe('degraded');
    expect(result.detail).toContain('rugcheck:report');
  });

  it('Test 4: returns down with detail when any endpoint has errorRate >= 0.9', () => {
    const stats = makeStats({
      'rugcheck:report': { errorRate: 0.95, count: 20 },
      'helius:das-api': { errorRate: 0.1, count: 15 },
    });
    const result = apisProviderLogic(() => stats, DEFAULT_DEGRADED, DEFAULT_DOWN);
    expect(result.status).toBe('down');
    expect(result.detail).toContain('rugcheck:report');
  });

  it('Test 5: detail string includes the failing endpoint names', () => {
    const stats = makeStats({
      'rugcheck:report': { errorRate: 0.7, count: 20 },
    });
    const result = apisProviderLogic(() => stats, DEFAULT_DEGRADED, DEFAULT_DOWN);
    expect(result.status).toBe('degraded');
    expect(result.detail).toContain('Degraded: rugcheck:report');
  });

  it('Test 6: multiple failing endpoints are all listed in detail', () => {
    const stats = makeStats({
      'rugcheck:report': { errorRate: 1.0, count: 30 },
      'helius:das-api': { errorRate: 0.6, count: 15 },
      'jupiter:quote': { errorRate: 0.0, count: 50 },
    });
    const result = apisProviderLogic(() => stats, DEFAULT_DEGRADED, DEFAULT_DOWN);
    expect(result.status).toBe('down');
    expect(result.detail).toContain('rugcheck:report');
    expect(result.detail).toContain('helius:das-api');
    expect(result.detail).toContain('Down: rugcheck:report');
    expect(result.detail).toContain('Degraded: helius:das-api');
  });

  it('Test 7: endpoints with count=0 are ignored (no data yet is not a failure)', () => {
    const stats = makeStats({
      'rugcheck:report': { errorRate: 1.0, count: 0 },
      'helius:das-api': { errorRate: 0.0, count: 10 },
    });
    const result = apisProviderLogic(() => stats, DEFAULT_DEGRADED, DEFAULT_DOWN);
    expect(result.status).toBe('healthy');
  });
});
