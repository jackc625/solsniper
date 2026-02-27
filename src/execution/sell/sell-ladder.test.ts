import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Connection, Keypair } from '@solana/web3.js';
import type { TradingConfig } from '../../config/trading.js';

// ---------------------------------------------------------------------------
// Hoisted mocks — declared before imports so vi.mock factories can reference them.
// ---------------------------------------------------------------------------
const { mockStandardSell, mockJitoSell, mockChunkedSell } = vi.hoisted(() => {
  const mockStandardSell = vi.fn();
  const mockJitoSell = vi.fn();
  const mockChunkedSell = vi.fn();
  return { mockStandardSell, mockJitoSell, mockChunkedSell };
});

vi.mock('./standard-seller.js', () => ({
  standardSell: mockStandardSell,
}));

vi.mock('./jito-seller.js', () => ({
  jitoSell: mockJitoSell,
}));

vi.mock('./chunked-seller.js', () => ({
  chunkedSell: mockChunkedSell,
}));

// ---------------------------------------------------------------------------
// Imports (after mocks are registered)
// ---------------------------------------------------------------------------
import { SellLadder } from './sell-ladder.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MINT = 'TestMint111111111111111111111111111111111111';
const TOKEN_AMOUNT = 1_000_000n;

const mockWallet = {} as unknown as Keypair;
const mockConnections = [{} as unknown as Connection];

function makeTradingConfig(): TradingConfig {
  return {
    buyAmountSol: 0.1,
    maxSlippageBps: 1000,
    maxConcurrentPositions: 3,
    stopLossPct: -50,
    takeProfitPct: 300,
    minSafetyScore: 60,
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
      holder: { top1SoftBlockThreshold: 0.25, top10SoftBlockThreshold: 0.50 },
      rugCheckScoreInverted: true,
      blocklistPath: './data/creator-blocklist.json',
    },
    execution: {
      buy: {
        slippageBps: 1000,
        priorityFeeBaseLamports: 100000,
        priorityFeeMultiplier: 1,
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
    },
  };
}

function makeTradeStore() {
  return { transition: vi.fn().mockReturnValue(1) };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SellLadder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('STANDARD succeeds — returns success result and completes MONITORING→SELLING→COMPLETED transitions', async () => {
    mockStandardSell.mockResolvedValue('sig1');

    const tradeStore = makeTradeStore();
    const ladder = new SellLadder(mockWallet, mockConnections, makeTradingConfig(), tradeStore as never);

    const resultPromise = ladder.sell(MINT, TOKEN_AMOUNT);
    // Advance timers to resolve any pending microtasks
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toEqual({ success: true, step: 'STANDARD', signature: 'sig1' });
    // First transition: MONITORING → SELLING (at start)
    expect(tradeStore.transition).toHaveBeenNthCalledWith(1, MINT, 'MONITORING', 'SELLING');
    // Second transition: SELLING → COMPLETED
    expect(tradeStore.transition).toHaveBeenNthCalledWith(
      2,
      MINT,
      'SELLING',
      'COMPLETED',
      expect.objectContaining({ sellSignature: 'sig1' })
    );
    expect(tradeStore.transition).toHaveBeenCalledTimes(2);
  });

  it('STANDARD times out, HIGH_FEE succeeds — returns HIGH_FEE step result', async () => {
    // STANDARD: never resolves (simulates timeout)
    mockStandardSell
      .mockImplementationOnce(() => new Promise<string>(() => {}))  // STANDARD: hangs forever
      .mockResolvedValueOnce('sig-high-fee');                        // HIGH_FEE: resolves

    const tradeStore = makeTradeStore();
    const ladder = new SellLadder(mockWallet, mockConnections, makeTradingConfig(), tradeStore as never);

    const resultPromise = ladder.sell(MINT, TOKEN_AMOUNT);
    // Advance past STANDARD timeout (30000ms) and HIGH_FEE processing
    await vi.advanceTimersByTimeAsync(30001);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toEqual({ success: true, step: 'HIGH_FEE', signature: 'sig-high-fee' });
    expect(mockStandardSell).toHaveBeenCalledTimes(2);
  });

  it('all steps exhaust — returns failure and transitions SELLING→FAILED', async () => {
    // All steps never resolve (timeout-based advancement)
    mockStandardSell.mockImplementation(() => new Promise<string>(() => {}));
    mockJitoSell.mockImplementation(() => new Promise<string>(() => {}));
    mockChunkedSell.mockImplementation(() => new Promise<number>(() => {}));

    const tradeStore = makeTradeStore();
    const ladder = new SellLadder(mockWallet, mockConnections, makeTradingConfig(), tradeStore as never);

    const resultPromise = ladder.sell(MINT, TOKEN_AMOUNT);
    // Advance past all timeouts: standard(30s) + highFee(20s) + jito(30s) + chunked(60s) + emergency(30s)
    await vi.advanceTimersByTimeAsync(30001 + 20001 + 30001 + 60001 + 30001);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toEqual({
      success: false,
      errorMessage: 'SELL_FAILED: all ladder steps exhausted',
    });
    // MONITORING→SELLING at start, SELLING→FAILED at end
    expect(tradeStore.transition).toHaveBeenNthCalledWith(1, MINT, 'MONITORING', 'SELLING');
    expect(tradeStore.transition).toHaveBeenLastCalledWith(
      MINT,
      'SELLING',
      'FAILED',
      expect.objectContaining({ errorMessage: 'SELL_FAILED: all ladder steps exhausted' })
    );
  });

  it('JITO_BUNDLE step called third after STANDARD and HIGH_FEE fail', async () => {
    // STANDARD and HIGH_FEE time out; JITO succeeds
    mockStandardSell.mockImplementation(() => new Promise<string>(() => {}));
    mockJitoSell.mockResolvedValue('sig-jito');

    const tradeStore = makeTradeStore();
    const ladder = new SellLadder(mockWallet, mockConnections, makeTradingConfig(), tradeStore as never);

    const resultPromise = ladder.sell(MINT, TOKEN_AMOUNT);
    // Advance past STANDARD (30s) and HIGH_FEE (20s) timeouts
    await vi.advanceTimersByTimeAsync(30001 + 20001);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toEqual({ success: true, step: 'JITO_BUNDLE', signature: 'sig-jito' });
    expect(mockJitoSell).toHaveBeenCalledOnce();
    expect(mockStandardSell).toHaveBeenCalledTimes(2);  // STANDARD + HIGH_FEE
  });

  it('CHUNKED returns 0 tranches — advances to EMERGENCY step', async () => {
    mockStandardSell.mockImplementation(() => new Promise<string>(() => {}));  // STANDARD: timeout
    mockJitoSell.mockImplementation(() => new Promise<string>(() => {}));      // HIGH_FEE: timeout (uses standardSell), JITO: timeout
    mockChunkedSell.mockResolvedValue(0);  // CHUNKED: returns 0 tranches = not success

    // For STANDARD and HIGH_FEE (both use standardSell) — hang
    // For EMERGENCY (uses standardSell) — succeed
    mockStandardSell
      .mockImplementationOnce(() => new Promise<string>(() => {}))  // STANDARD: hang
      .mockImplementationOnce(() => new Promise<string>(() => {}))  // HIGH_FEE: hang
      .mockResolvedValueOnce('sig-emergency');                       // EMERGENCY: succeed

    mockJitoSell.mockImplementation(() => new Promise<string>(() => {}));  // JITO: hang
    mockChunkedSell.mockResolvedValue(0);  // CHUNKED: 0 tranches

    const tradeStore = makeTradeStore();
    const ladder = new SellLadder(mockWallet, mockConnections, makeTradingConfig(), tradeStore as never);

    const resultPromise = ladder.sell(MINT, TOKEN_AMOUNT);
    // Advance past STANDARD(30s) + HIGH_FEE(20s) + JITO(30s) timeouts, then CHUNKED resolves
    await vi.advanceTimersByTimeAsync(30001 + 20001 + 30001);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toEqual({ success: true, step: 'EMERGENCY', signature: 'sig-emergency' });
    expect(mockChunkedSell).toHaveBeenCalledOnce();
  });

  it('CHUNKED returns 2 tranches — succeeds and transitions SELLING→COMPLETED without signature', async () => {
    mockStandardSell.mockImplementation(() => new Promise<string>(() => {}));  // STANDARD: hang
    mockJitoSell.mockImplementation(() => new Promise<string>(() => {}));      // HIGH_FEE: hang — but HIGH_FEE uses standardSell

    // STANDARD hangs, HIGH_FEE hangs, JITO hangs, CHUNKED returns 2
    mockStandardSell
      .mockImplementationOnce(() => new Promise<string>(() => {}))  // STANDARD: hang
      .mockImplementationOnce(() => new Promise<string>(() => {})); // HIGH_FEE: hang
    mockJitoSell.mockImplementation(() => new Promise<string>(() => {}));  // JITO: hang
    mockChunkedSell.mockResolvedValue(2);  // CHUNKED: 2 tranches confirmed

    const tradeStore = makeTradeStore();
    const ladder = new SellLadder(mockWallet, mockConnections, makeTradingConfig(), tradeStore as never);

    const resultPromise = ladder.sell(MINT, TOKEN_AMOUNT);
    await vi.advanceTimersByTimeAsync(30001 + 20001 + 30001);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toEqual({ success: true, step: 'CHUNKED', signature: undefined });
    expect(tradeStore.transition).toHaveBeenLastCalledWith(
      MINT,
      'SELLING',
      'COMPLETED',
      expect.objectContaining({ sellSignature: undefined })
    );
  });

  it('EMERGENCY step uses emergencySlippageBps (4900 bps = 49%) — verify standardSell called with correct options', async () => {
    // All steps fail except EMERGENCY
    mockStandardSell
      .mockImplementationOnce(() => new Promise<string>(() => {}))  // STANDARD: hang
      .mockImplementationOnce(() => new Promise<string>(() => {}))  // HIGH_FEE: hang
      .mockResolvedValueOnce('sig-emergency');                       // EMERGENCY: succeed
    mockJitoSell.mockImplementation(() => new Promise<string>(() => {}));   // JITO: hang
    mockChunkedSell.mockResolvedValue(0);  // CHUNKED: 0 tranches

    const tradeStore = makeTradeStore();
    const config = makeTradingConfig();
    const ladder = new SellLadder(mockWallet, mockConnections, config, tradeStore as never);

    const resultPromise = ladder.sell(MINT, TOKEN_AMOUNT);
    await vi.advanceTimersByTimeAsync(30001 + 20001 + 30001);
    await vi.runAllTimersAsync();
    await resultPromise;

    // Third call to standardSell is EMERGENCY — check it used emergencySlippageBps
    const emergencyCall = mockStandardSell.mock.calls[2];
    expect(emergencyCall[2]).toEqual({
      slippageBps: 4900,
      feeMultiplier: 10,
    });
  });
});
