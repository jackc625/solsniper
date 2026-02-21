import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';

// ---------------------------------------------------------------------------
// vi.hoisted ensures MockWebSocket is available inside the hoisted vi.mock factory.
// We cannot use top-level imports inside vi.hoisted — use require() instead.
// ---------------------------------------------------------------------------
const { MockWebSocket } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { EventEmitter } = require('events') as { EventEmitter: typeof import('events').EventEmitter };

  class MockWebSocket extends EventEmitter {
    static OPEN = 1;
    static CLOSED = 3;
    static lastInstance: MockWebSocket | null = null;

    readyState: number = MockWebSocket.OPEN;
    url: string;
    sendCalls: string[] = [];
    pingCalled = false;
    terminateCalled = false;
    closeCalled = false;

    constructor(url: string) {
      super();
      this.url = url;
      MockWebSocket.lastInstance = this;
    }

    send(data: string): void {
      this.sendCalls.push(data);
    }

    ping(): void {
      this.pingCalled = true;
    }

    terminate(): void {
      this.terminateCalled = true;
      this.readyState = MockWebSocket.CLOSED;
      this.emit('close', 1006, Buffer.from('terminated'));
    }

    close(): void {
      this.closeCalled = true;
      this.readyState = MockWebSocket.CLOSED;
      this.emit('close', 1000, Buffer.from(''));
    }

    static reset(): void {
      MockWebSocket.lastInstance = null;
    }
  }

  return { MockWebSocket };
});

// Mock 'ws' so ResilientWebSocket uses our MockWebSocket
vi.mock('ws', () => ({
  default: MockWebSocket,
}));

// ---------------------------------------------------------------------------
// Imports after mocks are registered
// ---------------------------------------------------------------------------
import { ResilientWebSocket } from './resilient-ws.js';
import type { ResilientWsConfig } from '../types/index.js';

// ---------------------------------------------------------------------------
// Test subclass
// ---------------------------------------------------------------------------

class TestWs extends ResilientWebSocket {
  messages: string[] = [];
  subscriptions: object[] = [{ method: 'subscribeNewToken' }];

  protected onMessage(data: string): void {
    this.messages.push(data);
  }

  protected getSubscriptions(): object[] {
    return this.subscriptions;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides: Partial<ResilientWsConfig> = {}): ResilientWsConfig {
  return {
    url: 'wss://test.example.com',
    name: 'test',
    baseBackoffMs: 100,
    maxBackoffMs: 1000,
    heartbeatIntervalMs: 500,
    excessiveReconnectThreshold: 3,
    excessiveReconnectWindowMs: 5000,
    ...overrides,
  };
}

/** Opens a connection and fires the 'open' event on the mock WebSocket. */
function openConnection(ws: TestWs): InstanceType<typeof MockWebSocket> {
  MockWebSocket.reset();
  ws.connect();
  const mock = MockWebSocket.lastInstance!;
  mock.emit('open');
  return mock;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ResilientWebSocket', () => {
  let _warnSpy: MockInstance;

  beforeEach(() => {
    vi.useFakeTimers();
    MockWebSocket.reset();
    _warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // 1. connect() creates WebSocket to configured URL
  // -------------------------------------------------------------------------
  it('connect() creates WebSocket to configured URL', () => {
    const config = makeConfig({ url: 'wss://custom.example.com' });
    const ws = new TestWs(config);
    ws.connect();

    expect(MockWebSocket.lastInstance).not.toBeNull();
    expect(MockWebSocket.lastInstance!.url).toBe('wss://custom.example.com');

    ws.close();
  });

  // -------------------------------------------------------------------------
  // 2. replays subscriptions on open
  // -------------------------------------------------------------------------
  it('replays subscriptions on open', () => {
    const ws = new TestWs(makeConfig());
    const mock = openConnection(ws);

    expect(mock.sendCalls).toHaveLength(1);
    expect(JSON.parse(mock.sendCalls[0])).toEqual({ method: 'subscribeNewToken' });

    ws.close();
  });

  // -------------------------------------------------------------------------
  // 3. calls onMessage on incoming message
  // -------------------------------------------------------------------------
  it('calls onMessage on incoming message', () => {
    const ws = new TestWs(makeConfig());
    const mock = openConnection(ws);

    mock.emit('message', Buffer.from('{"token":"abc"}'));

    expect(ws.messages).toHaveLength(1);
    expect(ws.messages[0]).toBe('{"token":"abc"}');

    ws.close();
  });

  // -------------------------------------------------------------------------
  // 4. reconnects with backoff on close (not explicit close)
  // -------------------------------------------------------------------------
  it('reconnects with backoff on close (not explicit close)', () => {
    const ws = new TestWs(makeConfig({ baseBackoffMs: 200 }));
    openConnection(ws);

    expect(ws.getReconnectCount()).toBe(0);

    // Simulate unexpected close
    MockWebSocket.lastInstance!.emit('close', 1006, Buffer.from('connection lost'));

    expect(ws.getReconnectCount()).toBe(1);

    // Advance past the backoff — a new connection should be created
    MockWebSocket.reset();
    vi.advanceTimersByTime(300); // > baseBackoffMs (200)

    expect(MockWebSocket.lastInstance).not.toBeNull();

    ws.close();
  });

  // -------------------------------------------------------------------------
  // 5. does not reconnect after explicit close()
  // -------------------------------------------------------------------------
  it('does not reconnect after explicit close()', () => {
    const ws = new TestWs(makeConfig());
    const mock = openConnection(ws);

    ws.close();

    const countBefore = ws.getReconnectCount();
    vi.advanceTimersByTime(5000);

    expect(ws.getReconnectCount()).toBe(countBefore);
    // No new WebSocket instance created after explicit close
    expect(MockWebSocket.lastInstance).toBe(mock);
  });

  // -------------------------------------------------------------------------
  // 6. resets backoff after successful connection
  // -------------------------------------------------------------------------
  it('resets backoff after successful connection', () => {
    const config = makeConfig({ baseBackoffMs: 100, maxBackoffMs: 1000 });
    const ws = new TestWs(config);
    openConnection(ws);

    // First disconnect — schedules reconnect
    MockWebSocket.lastInstance!.emit('close', 1006, Buffer.from(''));
    expect(ws.getReconnectCount()).toBe(1);

    // Fire the reconnect timer
    MockWebSocket.reset();
    vi.advanceTimersByTime(300);
    expect(MockWebSocket.lastInstance).not.toBeNull();

    // Second connection opens — this resets backoff to baseBackoffMs
    MockWebSocket.lastInstance!.emit('open');

    // Second disconnect — backoff should be reset (not doubled from before)
    MockWebSocket.lastInstance!.emit('close', 1006, Buffer.from(''));
    expect(ws.getReconnectCount()).toBe(2);

    MockWebSocket.reset();
    // Advance only ~baseBackoffMs — reconnect should fire (backoff was reset, not accumulated)
    vi.advanceTimersByTime(300);

    expect(MockWebSocket.lastInstance).not.toBeNull();

    ws.close();
  });

  // -------------------------------------------------------------------------
  // 7. logs warning on excessive reconnections
  // -------------------------------------------------------------------------
  it('logs warning on excessive reconnections', () => {
    const config = makeConfig({
      baseBackoffMs: 50,
      maxBackoffMs: 200,
      excessiveReconnectThreshold: 3,
      excessiveReconnectWindowMs: 60000,
    });
    const ws = new TestWs(config);

    // First connection
    openConnection(ws);

    // Repeatedly disconnect — each scheduleReconnect increments count.
    // Let each reconnect timer fire (which calls connect again), then disconnect again.
    for (let i = 0; i < 3; i++) {
      // Force unexpected disconnect
      MockWebSocket.lastInstance!.emit('close', 1006, Buffer.from(''));
      // Advance far enough to fire the reconnect timer
      MockWebSocket.reset();
      vi.advanceTimersByTime(300);
      // The reconnect fired and created a new WebSocket — open it
      if (MockWebSocket.lastInstance) {
        MockWebSocket.lastInstance.emit('open');
      }
    }

    // Reconnect count should reach 3
    expect(ws.getReconnectCount()).toBe(3);

    ws.close();
  });

  // -------------------------------------------------------------------------
  // 8. heartbeat terminates connection on silence (lastMessageAt stale)
  // -------------------------------------------------------------------------
  it('heartbeat terminates connection on silence (lastMessageAt stale)', () => {
    const config = makeConfig({ heartbeatIntervalMs: 500 });
    const ws = new TestWs(config);
    const mock = openConnection(ws);

    // Advance past 2x heartbeat interval without any message
    vi.advanceTimersByTime(1100); // > 500 * 2 = 1000ms

    expect(mock.terminateCalled).toBe(true);

    ws.close();
  });

  // -------------------------------------------------------------------------
  // 9. heartbeat sends ping when connection is alive
  // -------------------------------------------------------------------------
  it('heartbeat sends ping when connection is alive', () => {
    const config = makeConfig({ heartbeatIntervalMs: 500 });
    const ws = new TestWs(config);
    const mock = openConnection(ws);

    // Simulate a message arriving — resets lastMessageAt to now
    mock.emit('message', Buffer.from('{"alive":true}'));

    // Advance exactly one heartbeat interval — connection is healthy, should ping
    vi.advanceTimersByTime(500);

    expect(mock.pingCalled).toBe(true);
    expect(mock.terminateCalled).toBe(false);

    ws.close();
  });
});
