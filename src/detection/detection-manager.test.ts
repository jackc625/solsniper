import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks — must be declared before imports so vi.mock() factories can
// reference them (vitest hoists vi.mock() calls before module imports, which
// causes TDZ errors if classes are declared at module scope).
// ---------------------------------------------------------------------------
const { MockPumpPortalListener, MockRaydiumListener, mockConnectFn, mockRaydiumStartFn } = vi.hoisted(() => {
  // Shared spy functions so tests can assert on them by name
  const mockConnectFn = vi.fn();
  const mockRaydiumStartFn = vi.fn();

  class MockPumpPortalListener {
    connect = mockConnectFn;
    close = vi.fn();
  }

  class MockRaydiumListener {
    start = mockRaydiumStartFn;
    stop = vi.fn().mockResolvedValue(undefined);
  }

  return { MockPumpPortalListener, MockRaydiumListener, mockConnectFn, mockRaydiumStartFn };
});

vi.mock('./pump-portal-listener.js', () => ({
  PumpPortalListener: MockPumpPortalListener,
}));

vi.mock('./raydium-listener.js', () => ({
  RaydiumListener: MockRaydiumListener,
}));

// ---------------------------------------------------------------------------
// Imports (after mocks are registered)
// ---------------------------------------------------------------------------
import { DetectionManager } from './detection-manager.js';
import type { TokenEvent } from '../types/index.js';
import type { Env } from '../config/env.js';
import type { TradingConfig } from '../config/trading.js';
import type { Connection } from '@solana/web3.js';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    SOLSNIPER_RPC_URL: 'https://api.mainnet-beta.solana.com',
    SOLSNIPER_RPC_BACKUP_URL: 'https://api.mainnet-beta.solana.com',
    SOLSNIPER_PRIVATE_KEY: 'deadbeef'.repeat(8),
    NODE_ENV: 'development',
    LOG_LEVEL: 'debug',
    PUMPPORTAL_ENABLED: true,
    RAYDIUM_ENABLED: true,
    DASHBOARD_PORT: 3001,
    SOLSNIPER_JUPITER_API_KEY: 'test-jupiter-key',
    ...overrides,
  };
}

function makeTradingConfig(overrides: Partial<TradingConfig['detection']> = {}): TradingConfig {
  return {
    buyAmountSol: 0.01,
    maxSlippageBps: 1000,
    maxConcurrentPositions: 3,
    stopLossPct: -50,
    takeProfitPct: 300,
    minSafetyScore: 60,
    dryRun: false,
    minBalanceBufferSol: 0.01,
    detection: {
      wsHeartbeatIntervalMs: 30000,
      wsBaseBackoffMs: 3000,
      wsMaxBackoffMs: 60000,
      wsExcessiveReconnectThreshold: 5,
      wsExcessiveReconnectWindowMs: 600000,
      statsIntervalMs: 900000,
      dedupWindowMs: 3600000,
      ...overrides,
    },
    safety: {
      tier2TimeoutMs: 2000,
      tier3TimeoutMs: 5000,
      cacheTtlMs: 300000,
      weights: { rugCheck: 40, holder: 30, creator: 30 },
      holder: { top1SoftBlockThreshold: 0.25, top10SoftBlockThreshold: 0.50, minUserHolders: 2 },
      rugCheckScoreInverted: true,
      blocklistPath: './data/creator-blocklist.json',
      minLiquiditySol: 1.0,
      lpLockScorePenalty: 30,
      metadataMutablePenalty: 15,
    },
    execution: {
      buy: { slippageBps: 1000, priorityFeeBaseLamports: 100000, priorityFeeMultiplier: 1, maxPriorityFeeCapLamports: 500000 },
      sell: {
        standardSlippageBps: 500,
        emergencySlippageBps: 4900,
        standardTimeoutMs: 30000,
        highFeeTimeoutMs: 20000,
        highFeeMultiplier: 3,
        jitoTimeoutMs: 30000,
        jitoTipLamports: 100000,
        chunkedTimeoutMs: 60000,
        emergencyTimeoutMs: 30000,
        emergencyPriorityMultiplier: 10,
      },
    },
    positionManagement: {
      pollIntervalMs: 5000,
      stopLossPct: -50,
      tieredTp: [{ at: 2, pct: 33 }, { at: 5, pct: 33 }, { at: 10, pct: 34 }],
      trailingStopPct: 0,
      maxHoldTimeMs: 120000,
    },
    monitoring: { alertCooldownMs: 60000, apiFailureThreshold: 5, apiErrorRateDegraded: 0.5, apiErrorRateDown: 0.9, logRotation: { sizeMb: 50, retentionDays: 7 } },
  };
}

function makeTokenEvent(overrides: Partial<TokenEvent> = {}): TokenEvent {
  return {
    mint: 'TestMint111111111111111111111111111111111111',
    source: 'pumpportal',
    detectedAt: Date.now(),
    name: 'TestToken',
    symbol: 'TEST',
    ...overrides,
  };
}

const mockConnection = {} as Connection;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DetectionManager', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Reset shared mock functions between tests so call counts start at zero
    mockConnectFn.mockClear();
    mockRaydiumStartFn.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // 1. Token event emission
  // -------------------------------------------------------------------------
  it('emits token event for new mint', () => {
    const manager = new DetectionManager(makeEnv(), makeTradingConfig(), mockConnection);
    manager.start();

    const tokenHandler = vi.fn();
    manager.on('token', tokenHandler);

    const event = makeTokenEvent();
    manager.handleTokenEvent(event);

    expect(tokenHandler).toHaveBeenCalledOnce();
    expect(tokenHandler).toHaveBeenCalledWith(event);
  });

  // -------------------------------------------------------------------------
  // 2. Deduplication
  // -------------------------------------------------------------------------
  it('deduplicates same mint from both sources', () => {
    const manager = new DetectionManager(makeEnv(), makeTradingConfig(), mockConnection);
    manager.start();

    const tokenHandler = vi.fn();
    manager.on('token', tokenHandler);

    const mint = 'DupMint11111111111111111111111111111111111111';
    manager.handleTokenEvent(makeTokenEvent({ mint, source: 'pumpportal' }));
    manager.handleTokenEvent(makeTokenEvent({ mint, source: 'raydium' }));

    // Only first event should be emitted
    expect(tokenHandler).toHaveBeenCalledOnce();
  });

  // -------------------------------------------------------------------------
  // 3. Pre-filter: junk rejection
  // -------------------------------------------------------------------------
  it('pre-filter rejects junk tokens with spam keywords', () => {
    const manager = new DetectionManager(makeEnv(), makeTradingConfig(), mockConnection);
    manager.start();

    const tokenHandler = vi.fn();
    manager.on('token', tokenHandler);

    // "FREE AIRDROP" should be caught by pre-filter
    const junkEvent = makeTokenEvent({ name: 'FREE AIRDROP TOKEN', symbol: 'SCAM' });
    manager.handleTokenEvent(junkEvent);

    // Event should NOT be emitted downstream
    expect(tokenHandler).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 4. Pre-filter: pass tokens without name/symbol
  // -------------------------------------------------------------------------
  it('pre-filter passes tokens without name (PumpPortal medium-confidence field)', () => {
    const manager = new DetectionManager(makeEnv(), makeTradingConfig(), mockConnection);
    manager.start();

    const tokenHandler = vi.fn();
    manager.on('token', tokenHandler);

    // No name or symbol — should pass through (can't evaluate junk)
    const noNameEvent = makeTokenEvent({ name: undefined, symbol: undefined });
    manager.handleTokenEvent(noNameEvent);

    expect(tokenHandler).toHaveBeenCalledOnce();
  });

  // -------------------------------------------------------------------------
  // 5. Periodic stats logging
  // -------------------------------------------------------------------------
  it('logs periodic stats when stats interval elapses', () => {
    const manager = new DetectionManager(
      makeEnv(),
      makeTradingConfig({ statsIntervalMs: 900000 }),
      mockConnection
    );
    manager.start();

    // Emit an event to populate stats
    manager.handleTokenEvent(makeTokenEvent());

    // Spy on logStats
    const logStatsSpy = vi.spyOn(manager, 'logStats');

    // Advance time past stats interval
    vi.advanceTimersByTime(900001);

    expect(logStatsSpy).toHaveBeenCalledOnce();
  });

  // -------------------------------------------------------------------------
  // 6. PUMPPORTAL_ENABLED=false — no PumpPortalListener created
  // -------------------------------------------------------------------------
  it('respects PUMPPORTAL_ENABLED=false — does not create PumpPortalListener', () => {
    const manager = new DetectionManager(
      makeEnv({ PUMPPORTAL_ENABLED: false }),
      makeTradingConfig(),
      mockConnection
    );
    manager.start();

    // When PUMPPORTAL_ENABLED=false, the listener is never created, so connect is never called
    expect(mockConnectFn).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 7. RAYDIUM_ENABLED=false — no RaydiumListener created
  // -------------------------------------------------------------------------
  it('respects RAYDIUM_ENABLED=false — does not create RaydiumListener', () => {
    const manager = new DetectionManager(
      makeEnv({ RAYDIUM_ENABLED: false }),
      makeTradingConfig(),
      mockConnection
    );
    manager.start();

    // When RAYDIUM_ENABLED=false, the listener is never created, so start is never called
    expect(mockRaydiumStartFn).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 8. Dedup eviction on stats interval
  // -------------------------------------------------------------------------
  it('prunes old dedup entries on stats interval', () => {
    const dedupWindowMs = 3600000; // 1 hour
    const manager = new DetectionManager(
      makeEnv(),
      makeTradingConfig({ dedupWindowMs, statsIntervalMs: 900000 }),
      mockConnection
    );
    manager.start();

    // Add a token event — this enters the dedup map with current timestamp
    const oldMint = 'OldMint1111111111111111111111111111111111111';
    manager.handleTokenEvent(makeTokenEvent({ mint: oldMint }));

    // Verify it was added to dedup
    // Advance time past dedup window so the entry is old
    vi.advanceTimersByTime(dedupWindowMs + 1);

    // Now trigger stats (which performs eviction)
    manager.logStats();

    // After eviction, the same mint should be allowed through again
    const tokenHandler = vi.fn();
    manager.on('token', tokenHandler);
    manager.handleTokenEvent(makeTokenEvent({ mint: oldMint }));

    expect(tokenHandler).toHaveBeenCalledOnce();
  });
});
