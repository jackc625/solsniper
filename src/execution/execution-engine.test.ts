import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Connection, Keypair } from '@solana/web3.js';
import type { TokenEvent } from '../types/index.js';
import type { TradingConfig } from '../config/trading.js';
import type { FeeEstimator } from '../core/fee-estimator.js';

// ---------------------------------------------------------------------------
// Hoisted mocks — declared before imports so vi.mock factories can reference them.
// ---------------------------------------------------------------------------
const { mockPumpPortalBuy, mockJupiterBuy, mockJupiterClientQuote, mockGetRuntimeConfig, defaultRuntimeConfig } = vi.hoisted(() => {
  const mockPumpPortalBuy = vi.fn();
  const mockJupiterBuy = vi.fn();
  const mockJupiterClientQuote = vi.fn();
  const defaultRuntimeConfig = {
    dryRun: false,
    buyAmountSol: 0.1,
    maxSlippageBps: 1000,
    maxConcurrentPositions: 3,
    stopLossPct: -50,
    takeProfitPct: 300,
    minSafetyScore: 60,
    minBalanceBufferSol: 0.01,
    detection: {
      wsHeartbeatIntervalMs: 30000, wsBaseBackoffMs: 3000, wsMaxBackoffMs: 60000,
      wsExcessiveReconnectThreshold: 5, wsExcessiveReconnectWindowMs: 600000,
      statsIntervalMs: 900000, dedupWindowMs: 3600000,
    },
    safety: {
      tier2TimeoutMs: 2000, tier3TimeoutMs: 5000, cacheTtlMs: 300000,
      weights: { rugCheck: 40, holder: 30, creator: 30 },
      holder: { top1SoftBlockThreshold: 0.25, top10SoftBlockThreshold: 0.50, minUserHolders: 2 },
      rugCheckScoreInverted: true, blocklistPath: './data/creator-blocklist.json',
      minLiquiditySol: 1.0, lpLockScorePenalty: 30, metadataMutablePenalty: 15,
    },
    execution: {
      buy: { slippageBps: 1000, priorityFeeBaseLamports: 100000, priorityFeeMultiplier: 1, maxPriorityFeeCapLamports: 500000 },
      sell: {
        standardSlippageBps: 500, emergencySlippageBps: 4900, standardTimeoutMs: 30000,
        highFeeTimeoutMs: 20000, highFeeMultiplier: 3, jitoTimeoutMs: 30000,
        jitoTipLamports: 100000, chunkedTimeoutMs: 60000, emergencyTimeoutMs: 30000,
        emergencyPriorityMultiplier: 10,
      },
    },
    positionManagement: {
      pollIntervalMs: 5000, stopLossPct: -50,
      tieredTp: [{ at: 2, pct: 33 }, { at: 5, pct: 33 }, { at: 10, pct: 34 }],
      trailingStopPct: 0, maxHoldTimeMs: 120000,
    },
    monitoring: { alertCooldownMs: 60000, apiFailureThreshold: 5, logRotation: { sizeMb: 50, retentionDays: 7 } },
  };
  const mockGetRuntimeConfig = vi.fn().mockReturnValue(defaultRuntimeConfig);
  return { mockPumpPortalBuy, mockJupiterBuy, mockJupiterClientQuote, mockGetRuntimeConfig, defaultRuntimeConfig };
});

vi.mock('./buy/pump-portal-buyer.js', () => ({
  pumpPortalBuy: mockPumpPortalBuy,
}));

vi.mock('./buy/jupiter-buyer.js', () => ({
  jupiterBuy: mockJupiterBuy,
}));

vi.mock('./jupiter-client.js', () => ({
  jupiterClient: {
    quote: mockJupiterClientQuote,
  },
}));

vi.mock('../config/trading.js', () => ({
  getRuntimeConfig: mockGetRuntimeConfig,
}));

// ---------------------------------------------------------------------------
// Imports (after mocks are registered)
// ---------------------------------------------------------------------------
import { ExecutionEngine } from './execution-engine.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const mockWallet = {} as unknown as Keypair;
const mockConnections = [{} as unknown as Connection];
const mockFeeEstimator = { getEstimate: vi.fn().mockResolvedValue({ maxLamports: 150000, priorityFeeSol: 0.00015, source: 'helius' as const }) } as unknown as FeeEstimator;

function makeTradingConfig(): TradingConfig {
  return {
    buyAmountSol: 0.1,
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
      buy: {
        slippageBps: 1000,
        priorityFeeBaseLamports: 100000,
        priorityFeeMultiplier: 1,
        maxPriorityFeeCapLamports: 500000,
      },
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
    monitoring: { alertCooldownMs: 60000, apiFailureThreshold: 5, logRotation: { sizeMb: 50, retentionDays: 7 } },
  };
}

function makeEvent(source: TokenEvent['source']): TokenEvent {
  return {
    mint: 'TestMint111111111111111111111111111111111111',
    source,
    detectedAt: Date.now(),
  };
}

function makeTradeStore() {
  return { transition: vi.fn() };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ExecutionEngine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockGetRuntimeConfig.mockReturnValue(defaultRuntimeConfig);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('routes to PumpPortal when source is pumpportal', async () => {
    mockPumpPortalBuy.mockResolvedValue({ success: true, signature: 'pump-sig' });
    mockJupiterClientQuote.mockResolvedValue({});

    const tradeStore = makeTradeStore();
    const engine = new ExecutionEngine(mockWallet, mockConnections, makeTradingConfig(), tradeStore as never, mockFeeEstimator);

    const buyPromise = engine.buy(makeEvent('pumpportal'));
    await vi.runAllTimersAsync();
    await buyPromise;

    expect(mockPumpPortalBuy).toHaveBeenCalledOnce();
    expect(mockJupiterBuy).not.toHaveBeenCalled();
  });

  it('routes to Jupiter when source is raydium', async () => {
    mockJupiterBuy.mockResolvedValue({ success: true, signature: 'jup-sig' });

    const tradeStore = makeTradeStore();
    const engine = new ExecutionEngine(mockWallet, mockConnections, makeTradingConfig(), tradeStore as never, mockFeeEstimator);

    const buyPromise = engine.buy(makeEvent('raydium'));
    await vi.runAllTimersAsync();
    await buyPromise;

    expect(mockJupiterBuy).toHaveBeenCalledOnce();
    expect(mockPumpPortalBuy).not.toHaveBeenCalled();
  });

  it('routes to Jupiter when source is pumpswap', async () => {
    mockJupiterBuy.mockResolvedValue({ success: true, signature: 'jup-sig' });

    const tradeStore = makeTradeStore();
    const engine = new ExecutionEngine(mockWallet, mockConnections, makeTradingConfig(), tradeStore as never, mockFeeEstimator);

    const buyPromise = engine.buy(makeEvent('pumpswap'));
    await vi.runAllTimersAsync();
    await buyPromise;

    expect(mockJupiterBuy).toHaveBeenCalledOnce();
    expect(mockPumpPortalBuy).not.toHaveBeenCalled();
  });

  it('success path — transitions BUYING → MONITORING with buySignature', async () => {
    mockPumpPortalBuy.mockResolvedValue({
      success: true,
      signature: 'sig123',
      amountTokens: 5000000,
    });
    mockJupiterClientQuote.mockResolvedValue({});

    const tradeStore = makeTradeStore();
    const engine = new ExecutionEngine(mockWallet, mockConnections, makeTradingConfig(), tradeStore as never, mockFeeEstimator);

    const buyPromise = engine.buy(makeEvent('pumpportal'));
    await vi.runAllTimersAsync();
    await buyPromise;

    expect(tradeStore.transition).toHaveBeenCalledWith(
      'TestMint111111111111111111111111111111111111',
      'BUYING',
      'MONITORING',
      expect.objectContaining({ buySignature: 'sig123' })
    );
  });

  it('failure path (buy returns false) — transitions BUYING → FAILED with BUY_FAILED message', async () => {
    mockPumpPortalBuy.mockResolvedValue({
      success: false,
      errorMessage: 'PumpPortal HTTP 400',
    });

    const tradeStore = makeTradeStore();
    const engine = new ExecutionEngine(mockWallet, mockConnections, makeTradingConfig(), tradeStore as never, mockFeeEstimator);

    const buyPromise = engine.buy(makeEvent('pumpportal'));
    await vi.runAllTimersAsync();
    await buyPromise;

    expect(tradeStore.transition).toHaveBeenCalledWith(
      'TestMint111111111111111111111111111111111111',
      'BUYING',
      'FAILED',
      expect.objectContaining({ errorMessage: 'BUY_FAILED: PumpPortal HTTP 400' })
    );
  });

  it('failure path (buy throws) — transitions BUYING → FAILED with BUY_FAILED message', async () => {
    mockPumpPortalBuy.mockRejectedValue(new Error('Network timeout'));

    const tradeStore = makeTradeStore();
    const engine = new ExecutionEngine(mockWallet, mockConnections, makeTradingConfig(), tradeStore as never, mockFeeEstimator);

    const buyPromise = engine.buy(makeEvent('pumpportal'));
    await vi.runAllTimersAsync();
    await buyPromise;

    expect(tradeStore.transition).toHaveBeenCalledWith(
      'TestMint111111111111111111111111111111111111',
      'BUYING',
      'FAILED',
      expect.objectContaining({ errorMessage: 'BUY_FAILED: Network timeout' })
    );
  });

  // ---------------------------------------------------------------------------
  // Post-buy sell-route verification tests
  // ---------------------------------------------------------------------------

  it('post-buy verification runs for pumpportal source — calls jupiterClient.quote with retries', async () => {
    mockPumpPortalBuy.mockResolvedValue({ success: true, signature: 'pump-sig' });
    // First 2 attempts fail, 3rd succeeds
    mockJupiterClientQuote
      .mockRejectedValueOnce(new Error('route not found'))
      .mockRejectedValueOnce(new Error('route not found'))
      .mockResolvedValueOnce({});

    const tradeStore = makeTradeStore();
    const engine = new ExecutionEngine(mockWallet, mockConnections, makeTradingConfig(), tradeStore as never, mockFeeEstimator);

    const buyPromise = engine.buy(makeEvent('pumpportal'));
    // buy() returns immediately (fire-and-forget verification)
    await buyPromise;

    // Advance timers for all 3 retry delays: 10s + 15s + 20s = 45s total
    await vi.advanceTimersByTimeAsync(10001);  // first retry
    await vi.advanceTimersByTimeAsync(15001);  // second retry
    await vi.advanceTimersByTimeAsync(20001);  // third retry
    await vi.runAllTimersAsync();

    expect(mockJupiterClientQuote).toHaveBeenCalledTimes(3);
    const params = mockJupiterClientQuote.mock.calls[0][0] as URLSearchParams;
    expect(params.get('inputMint')).toBe('TestMint111111111111111111111111111111111111');
    expect(params.get('outputMint')).toBe('So11111111111111111111111111111111111111112');
  });

  it('post-buy verification does NOT run for raydium source', async () => {
    mockJupiterBuy.mockResolvedValue({ success: true, signature: 'jup-sig' });

    const tradeStore = makeTradeStore();
    const engine = new ExecutionEngine(mockWallet, mockConnections, makeTradingConfig(), tradeStore as never, mockFeeEstimator);

    const buyPromise = engine.buy(makeEvent('raydium'));
    await buyPromise;
    await vi.advanceTimersByTimeAsync(60000);
    await vi.runAllTimersAsync();

    expect(mockJupiterClientQuote).not.toHaveBeenCalled();
  });

  it('post-buy verification does NOT run for pumpswap source', async () => {
    mockJupiterBuy.mockResolvedValue({ success: true, signature: 'jup-sig' });

    const tradeStore = makeTradeStore();
    const engine = new ExecutionEngine(mockWallet, mockConnections, makeTradingConfig(), tradeStore as never, mockFeeEstimator);

    const buyPromise = engine.buy(makeEvent('pumpswap'));
    await buyPromise;
    await vi.advanceTimersByTimeAsync(60000);
    await vi.runAllTimersAsync();

    expect(mockJupiterClientQuote).not.toHaveBeenCalled();
  });

  it('post-buy verification does NOT run when buy fails', async () => {
    mockPumpPortalBuy.mockResolvedValue({ success: false, errorMessage: 'HTTP 400' });

    const tradeStore = makeTradeStore();
    const engine = new ExecutionEngine(mockWallet, mockConnections, makeTradingConfig(), tradeStore as never, mockFeeEstimator);

    const buyPromise = engine.buy(makeEvent('pumpportal'));
    await buyPromise;
    await vi.advanceTimersByTimeAsync(60000);
    await vi.runAllTimersAsync();

    expect(mockJupiterClientQuote).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Dry-run PumpPortal bonding curve estimation
  // ---------------------------------------------------------------------------

  it('dry-run PumpPortal buy with bonding curve data — estimates amountTokens', async () => {
    mockGetRuntimeConfig.mockReturnValue({ ...defaultRuntimeConfig, dryRun: true, buyAmountSol: 0.01 });
    mockPumpPortalBuy.mockResolvedValue({
      success: true,
      signature: 'dry-run-sig',
      amountTokens: undefined,
    });
    mockJupiterClientQuote.mockResolvedValue({});

    const tradeStore = makeTradeStore();
    const config = makeTradingConfig();
    config.buyAmountSol = 0.01;
    const engine = new ExecutionEngine(mockWallet, mockConnections, config, tradeStore as never, mockFeeEstimator);

    const event = makeEvent('pumpportal');
    event.vSolInBondingCurve = 30;
    event.vTokensInBondingCurve = 1_073_000_000;

    const buyPromise = engine.buy(event);
    await vi.runAllTimersAsync();
    await buyPromise;

    // Verify transition was called with estimated amountTokens
    expect(tradeStore.transition).toHaveBeenCalledWith(
      event.mint,
      'BUYING',
      'MONITORING',
      expect.objectContaining({
        buySignature: 'dry-run-sig',
        amountSol: 0.01,
      }),
    );

    // Extract the actual amountTokens from the call
    const transitionArgs = tradeStore.transition.mock.calls[0][3];
    // Expected: tokensHuman = 1_073_000_000 * (0.01 * 0.9875) / (30 + 0.01 * 0.9875)
    //         = 1_073_000_000 * 0.009875 / 30.009875 ≈ 353,008
    // amountTokens = Math.round(353,008 * 1e6) ≈ 353,008,000,000 (raw, 6 decimals)
    expect(transitionArgs.amountTokens).toBeGreaterThan(0);
    expect(transitionArgs.amountTokens).toBeTypeOf('number');
    // buyPriceSol should be populated (not undefined)
    expect(transitionArgs.buyPriceSol).toBeTypeOf('number');
    expect(transitionArgs.buyPriceSol).toBeGreaterThan(0);
  });

  it('dry-run PumpPortal buy without bonding curve data — amountTokens stays undefined', async () => {
    mockGetRuntimeConfig.mockReturnValue({ ...defaultRuntimeConfig, dryRun: true });
    mockPumpPortalBuy.mockResolvedValue({
      success: true,
      signature: 'dry-run-sig',
      amountTokens: undefined,
    });
    mockJupiterClientQuote.mockResolvedValue({});

    const tradeStore = makeTradeStore();
    const engine = new ExecutionEngine(mockWallet, mockConnections, makeTradingConfig(), tradeStore as never, mockFeeEstimator);

    // Event without bonding curve data
    const event = makeEvent('pumpportal');

    const buyPromise = engine.buy(event);
    await vi.runAllTimersAsync();
    await buyPromise;

    // amountTokens should remain undefined (no estimation possible)
    const transitionArgs = tradeStore.transition.mock.calls[0][3];
    expect(transitionArgs.amountTokens).toBeUndefined();
    // buyPriceSol should be undefined when amountTokens is missing
    expect(transitionArgs.buyPriceSol).toBeUndefined();
  });

  it('post-buy verification buy() returns without waiting for verification (fire-and-forget)', async () => {
    mockPumpPortalBuy.mockResolvedValue({ success: true, signature: 'pump-sig' });
    // Never resolves — route not found
    mockJupiterClientQuote.mockImplementation(() => new Promise(() => {}));

    const tradeStore = makeTradeStore();
    const engine = new ExecutionEngine(mockWallet, mockConnections, makeTradingConfig(), tradeStore as never, mockFeeEstimator);

    // buy() should return without waiting for all 3 retries
    const buyPromise = engine.buy(makeEvent('pumpportal'));
    // Should resolve before timer advances (buy itself is done, verification is fire-and-forget)
    await buyPromise;

    // buy() resolved — verification is still pending in background
    // (we just verify buy() didn't block)
    expect(tradeStore.transition).toHaveBeenCalledWith(
      'TestMint111111111111111111111111111111111111',
      'BUYING',
      'MONITORING',
      expect.objectContaining({ buySignature: 'pump-sig' })
    );
  });
});
