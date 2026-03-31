import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Connection, Keypair } from '@solana/web3.js';
import type { TradingConfig } from '../../config/trading.js';
import type { FeeEstimator } from '../../core/fee-estimator.js';
import type { Trade } from '../../types/index.js';
import { PublicKey } from '@solana/web3.js';

// ---------------------------------------------------------------------------
// Hoisted mocks — declared before imports so vi.mock factories can reference them.
// ---------------------------------------------------------------------------
const { mockStandardSell, mockJitoSell, mockChunkedSell, mockPumpPortalSell, mockGetRuntimeConfig } = vi.hoisted(() => {
  const mockStandardSell = vi.fn();
  const mockJitoSell = vi.fn();
  const mockChunkedSell = vi.fn();
  const mockPumpPortalSell = vi.fn();
  const mockGetRuntimeConfig = vi.fn();
  return { mockStandardSell, mockJitoSell, mockChunkedSell, mockPumpPortalSell, mockGetRuntimeConfig };
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

vi.mock('./pump-portal-seller.js', () => ({
  pumpPortalSell: mockPumpPortalSell,
}));

vi.mock('../../utils/parse-sol-received.js', () => ({
  parseSolReceived: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../config/trading.js', () => ({
  getRuntimeConfig: mockGetRuntimeConfig,
}));

// ---------------------------------------------------------------------------
// Imports (after mocks are registered)
// ---------------------------------------------------------------------------
import { SellLadder } from './sell-ladder.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// Valid Solana mainnet mint address (USDC) -- PublicKey constructor validates base58
const MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const TOKEN_AMOUNT = 1_000_000n;

// Valid Solana mainnet address for wallet public key in tests
const WALLET_PUBKEY = new PublicKey('So11111111111111111111111111111111111111112');

// mockGetParsedTokenAccountsByOwner is shared across all tests; reset in beforeEach.
// Default: returns TOKEN_AMOUNT tokens (matching the passed amount -- no mismatch)
const mockGetParsedTokenAccountsByOwner = vi.fn();

const mockWallet = {
  publicKey: WALLET_PUBKEY,
} as unknown as Keypair;

const mockConnection = {
  getParsedTokenAccountsByOwner: mockGetParsedTokenAccountsByOwner,
} as unknown as Connection;

const mockConnections = [mockConnection];
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

function makeTradeStore(overrides?: { getTradeByMintResult?: Partial<Trade> | undefined }) {
  return {
    transition: vi.fn().mockReturnValue(1),
    getTradeByMint: vi.fn().mockReturnValue(overrides?.getTradeByMintResult),
    addSellPrice: vi.fn().mockReturnValue(1),
    decrementTokenAmount: vi.fn().mockReturnValue(1),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SellLadder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockGetRuntimeConfig.mockReturnValue(makeTradingConfig());
    // Default: wallet has TOKEN_AMOUNT tokens on-chain (matches passed amount -- no stale mismatch)
    mockGetParsedTokenAccountsByOwner.mockResolvedValue({
      value: [{
        account: {
          data: {
            parsed: {
              info: {
                mint: MINT,
                tokenAmount: { amount: TOKEN_AMOUNT.toString() },
              },
            },
          },
        },
      }],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('STANDARD succeeds — returns success result and completes MONITORING→SELLING→COMPLETED transitions', async () => {
    mockStandardSell.mockResolvedValue({ signature: 'sig1', solReceived: 0.5 });

    const tradeStore = makeTradeStore();
    const ladder = new SellLadder(mockWallet, mockConnections, makeTradingConfig(), tradeStore as never, mockFeeEstimator);

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
      .mockImplementationOnce(() => new Promise<never>(() => {}))                                  // STANDARD: hangs forever
      .mockResolvedValueOnce({ signature: 'sig-high-fee', solReceived: 0.5 });                    // HIGH_FEE: resolves

    const tradeStore = makeTradeStore();
    const ladder = new SellLadder(mockWallet, mockConnections, makeTradingConfig(), tradeStore as never, mockFeeEstimator);

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
    mockStandardSell.mockImplementation(() => new Promise<never>(() => {}));
    mockJitoSell.mockImplementation(() => new Promise<never>(() => {}));
    mockChunkedSell.mockImplementation(() => new Promise<never>(() => {}));
    mockPumpPortalSell.mockImplementation(() => new Promise<never>(() => {}));

    const tradeStore = makeTradeStore({ getTradeByMintResult: { source: 'pumpportal' } });
    const ladder = new SellLadder(mockWallet, mockConnections, makeTradingConfig(), tradeStore as never, mockFeeEstimator);

    const resultPromise = ladder.sell(MINT, TOKEN_AMOUNT);
    // Advance past all timeouts: standard(30s) + highFee(20s) + jito(30s) + chunked(60s) + pumpportal(30s) + emergency(30s)
    await vi.advanceTimersByTimeAsync(30001 + 20001 + 30001 + 60001 + 30001 + 30001);
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
    mockStandardSell.mockImplementation(() => new Promise<never>(() => {}));
    mockJitoSell.mockResolvedValue({ signature: 'sig-jito', solReceived: 0.5 });

    const tradeStore = makeTradeStore();
    const ladder = new SellLadder(mockWallet, mockConnections, makeTradingConfig(), tradeStore as never, mockFeeEstimator);

    const resultPromise = ladder.sell(MINT, TOKEN_AMOUNT);
    // Advance past STANDARD (30s) and HIGH_FEE (20s) timeouts
    await vi.advanceTimersByTimeAsync(30001 + 20001);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toEqual({ success: true, step: 'JITO_BUNDLE', signature: 'sig-jito' });
    expect(mockJitoSell).toHaveBeenCalledOnce();
    expect(mockStandardSell).toHaveBeenCalledTimes(2);  // STANDARD + HIGH_FEE
  });

  it('CHUNKED returns 0 tranches — advances to PUMPPORTAL step', async () => {
    // STANDARD, HIGH_FEE, JITO hang, CHUNKED returns 0
    // PUMPPORTAL skips (no JupiterRouteError in lastError — timed out instead)
    // EMERGENCY succeeds
    mockStandardSell
      .mockImplementationOnce(() => new Promise<never>(() => {}))                     // STANDARD: hang
      .mockImplementationOnce(() => new Promise<never>(() => {}))                     // HIGH_FEE: hang
      .mockResolvedValueOnce({ signature: 'sig-emergency', solReceived: 0.5 });       // EMERGENCY: succeed

    mockJitoSell.mockImplementation(() => new Promise<never>(() => {}));  // JITO: hang
    mockChunkedSell.mockResolvedValue({ confirmedTranches: 0 });  // CHUNKED: 0 tranches

    const tradeStore = makeTradeStore();  // no source set — PUMPPORTAL will skip
    const ladder = new SellLadder(mockWallet, mockConnections, makeTradingConfig(), tradeStore as never, mockFeeEstimator);

    const resultPromise = ladder.sell(MINT, TOKEN_AMOUNT);
    // Advance past STANDARD(30s) + HIGH_FEE(20s) + JITO(30s) timeouts, then CHUNKED resolves
    await vi.advanceTimersByTimeAsync(30001 + 20001 + 30001);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toEqual({ success: true, step: 'EMERGENCY', signature: 'sig-emergency' });
    expect(mockChunkedSell).toHaveBeenCalledOnce();
  });

  it('CHUNKED returns 2 tranches — succeeds and transitions SELLING→COMPLETED without signature', async () => {
    mockStandardSell
      .mockImplementationOnce(() => new Promise<never>(() => {}))  // STANDARD: hang
      .mockImplementationOnce(() => new Promise<never>(() => {})); // HIGH_FEE: hang
    mockJitoSell.mockImplementation(() => new Promise<never>(() => {}));  // JITO: hang
    mockChunkedSell.mockResolvedValue({ confirmedTranches: 2, solReceived: 1.0 });  // CHUNKED: 2 tranches confirmed

    const tradeStore = makeTradeStore();
    const ladder = new SellLadder(mockWallet, mockConnections, makeTradingConfig(), tradeStore as never, mockFeeEstimator);

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
      .mockImplementationOnce(() => new Promise<never>(() => {}))                      // STANDARD: hang
      .mockImplementationOnce(() => new Promise<never>(() => {}))                      // HIGH_FEE: hang
      .mockResolvedValueOnce({ signature: 'sig-emergency', solReceived: 0.5 });        // EMERGENCY: succeed
    mockJitoSell.mockImplementation(() => new Promise<never>(() => {}));   // JITO: hang
    mockChunkedSell.mockResolvedValue({ confirmedTranches: 0 });  // CHUNKED: 0 tranches

    const tradeStore = makeTradeStore();  // no pumpportal source — PUMPPORTAL skips
    const config = makeTradingConfig();
    const ladder = new SellLadder(mockWallet, mockConnections, config, tradeStore as never, mockFeeEstimator);

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

  // ---------------------------------------------------------------------------
  // New PUMPPORTAL step tests
  // ---------------------------------------------------------------------------

  it('PUMPPORTAL step fires for pumpportal token after JupiterRouteError (TOKEN_NOT_TRADABLE)', async () => {
    // Import JupiterRouteError for the test
    const { JupiterRouteError } = await import('../jupiter-client.js');

    // STANDARD throws a JupiterRouteError with TOKEN_NOT_TRADABLE code
    mockStandardSell.mockRejectedValue(new JupiterRouteError('Jupiter quote HTTP 400: TOKEN_NOT_TRADABLE', 'TOKEN_NOT_TRADABLE'));
    // HIGH_FEE also throws JupiterRouteError
    mockStandardSell
      .mockRejectedValueOnce(new JupiterRouteError('Jupiter quote HTTP 400: TOKEN_NOT_TRADABLE', 'TOKEN_NOT_TRADABLE'))  // STANDARD
      .mockRejectedValueOnce(new JupiterRouteError('Jupiter quote HTTP 400: TOKEN_NOT_TRADABLE', 'TOKEN_NOT_TRADABLE'));  // HIGH_FEE
    // JITO throws JupiterRouteError
    mockJitoSell.mockRejectedValue(new JupiterRouteError('Jupiter quote HTTP 400: TOKEN_NOT_TRADABLE', 'TOKEN_NOT_TRADABLE'));
    // CHUNKED returns 0 (no route)
    mockChunkedSell.mockResolvedValue({ confirmedTranches: 0 });
    // PUMPPORTAL succeeds
    mockPumpPortalSell.mockResolvedValue({ signature: 'pump-sell-sig', solReceived: 0.3 });

    const tradeStore = makeTradeStore({ getTradeByMintResult: { source: 'pumpportal' } });
    const ladder = new SellLadder(mockWallet, mockConnections, makeTradingConfig(), tradeStore as never, mockFeeEstimator);

    const resultPromise = ladder.sell(MINT, TOKEN_AMOUNT);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toEqual({ success: true, step: 'PUMPPORTAL', signature: 'pump-sell-sig' });
    expect(mockPumpPortalSell).toHaveBeenCalledOnce();
  });

  it('PUMPPORTAL step skipped for raydium token — falls through to EMERGENCY', async () => {
    const { JupiterRouteError } = await import('../jupiter-client.js');

    // All Jupiter steps fail with route error
    mockStandardSell
      .mockRejectedValueOnce(new JupiterRouteError('no route', 'TOKEN_NOT_TRADABLE'))                 // STANDARD
      .mockRejectedValueOnce(new JupiterRouteError('no route', 'TOKEN_NOT_TRADABLE'))                 // HIGH_FEE
      .mockResolvedValueOnce({ signature: 'sig-emergency', solReceived: 0.5 });                       // EMERGENCY
    mockJitoSell.mockRejectedValue(new JupiterRouteError('no route', 'TOKEN_NOT_TRADABLE'));
    mockChunkedSell.mockResolvedValue({ confirmedTranches: 0 });

    // source is raydium, not pumpportal — PUMPPORTAL step should skip
    const tradeStore = makeTradeStore({ getTradeByMintResult: { source: 'raydium' } });
    const ladder = new SellLadder(mockWallet, mockConnections, makeTradingConfig(), tradeStore as never, mockFeeEstimator);

    const resultPromise = ladder.sell(MINT, TOKEN_AMOUNT);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toEqual({ success: true, step: 'EMERGENCY', signature: 'sig-emergency' });
    expect(mockPumpPortalSell).not.toHaveBeenCalled();
  });

  it('PUMPPORTAL step skipped when last error is not a JupiterRouteError', async () => {
    // STANDARD fails with a generic error
    mockStandardSell
      .mockRejectedValueOnce(new Error('Network timeout'))                              // STANDARD
      .mockRejectedValueOnce(new Error('Network timeout'))                              // HIGH_FEE
      .mockResolvedValueOnce({ signature: 'sig-emergency', solReceived: 0.5 });        // EMERGENCY
    mockJitoSell.mockRejectedValue(new Error('Jito error'));
    mockChunkedSell.mockResolvedValue({ confirmedTranches: 0 });

    // pumpportal token, but last error is generic (not JupiterRouteError)
    const tradeStore = makeTradeStore({ getTradeByMintResult: { source: 'pumpportal' } });
    const ladder = new SellLadder(mockWallet, mockConnections, makeTradingConfig(), tradeStore as never, mockFeeEstimator);

    const resultPromise = ladder.sell(MINT, TOKEN_AMOUNT);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toEqual({ success: true, step: 'EMERGENCY', signature: 'sig-emergency' });
    expect(mockPumpPortalSell).not.toHaveBeenCalled();
  });

  it('CHUNKED step passes tradeStore to chunkedSell', async () => {
    // All steps before CHUNKED hang, CHUNKED resolves with 1
    mockStandardSell.mockImplementation(() => new Promise<never>(() => {}));
    mockJitoSell.mockImplementation(() => new Promise<never>(() => {}));
    mockChunkedSell.mockResolvedValue({ confirmedTranches: 1, solReceived: 0.5 });

    const tradeStore = makeTradeStore({ getTradeByMintResult: { source: 'pumpportal', tokenProgramId: 'SomeToken22ProgramId' } });
    const ladder = new SellLadder(mockWallet, mockConnections, makeTradingConfig(), tradeStore as never, mockFeeEstimator);

    const resultPromise = ladder.sell(MINT, TOKEN_AMOUNT);
    await vi.advanceTimersByTimeAsync(30001 + 20001 + 30001);
    await vi.runAllTimersAsync();
    await resultPromise;

    // chunkedSell should be called with tradeStore as 5th argument
    expect(mockChunkedSell).toHaveBeenCalledOnce();
    const chunkedArgs = mockChunkedSell.mock.calls[0];
    expect(chunkedArgs[4]).toBe(tradeStore);  // 5th arg = tradeStore
  });

  // ---------------------------------------------------------------------------
  // New Plan 02 tests: solReceived threading, pnlSol formula, fallback
  // ---------------------------------------------------------------------------

  it('STANDARD succeeds -- passes sellPriceSol to tradeStore.transition()', async () => {
    mockStandardSell.mockResolvedValue({ signature: 'sig1', solReceived: 0.42 });

    const tradeStore = makeTradeStore();
    const ladder = new SellLadder(mockWallet, mockConnections, makeTradingConfig(), tradeStore as never, mockFeeEstimator);

    const resultPromise = ladder.sell(MINT, TOKEN_AMOUNT);
    await vi.runAllTimersAsync();
    await resultPromise;

    // Verify sellPriceSol is passed in the SELLING->COMPLETED transition
    expect(tradeStore.transition).toHaveBeenNthCalledWith(
      2,
      MINT,
      'SELLING',
      'COMPLETED',
      expect.objectContaining({ sellSignature: 'sig1', sellPriceSol: 0.42 })
    );
  });

  it('pnlSol is computed as sellPriceSol - amountSol (not buyPriceSol)', async () => {
    mockStandardSell.mockResolvedValue({ signature: 'sig-pnl', solReceived: 0.15 });

    const tradeStore = makeTradeStore({
      getTradeByMintResult: {
        sellPriceSol: 0.15,
        amountSol: 0.10,
        buyPriceSol: 0.000001,  // buyPriceSol is per-token unit -- NOT used for P&L
      }
    });
    const ladder = new SellLadder(mockWallet, mockConnections, makeTradingConfig(), tradeStore as never, mockFeeEstimator);

    // Capture emitted events
    const { botEventBus } = await import('../../dashboard/bot-event-bus.js');
    const events: Array<{ type: string; pnlSol?: number }> = [];
    const handler = (e: { type: string; pnlSol?: number }) => events.push(e);
    botEventBus.on('event', handler);

    const resultPromise = ladder.sell(MINT, TOKEN_AMOUNT);
    await vi.runAllTimersAsync();
    await resultPromise;

    const confirmed = events.find(e => e.type === 'SELL_CONFIRMED');
    // pnlSol = 0.15 - 0.10 = 0.05 (NOT 0.15 - 0.000001)
    expect(confirmed?.pnlSol).toBeCloseTo(0.05, 6);

    botEventBus.removeListener('event', handler);
  });

  it('CHUNKED succeeds -- passes accumulated solReceived as sellPriceSol', async () => {
    mockStandardSell.mockImplementation(() => new Promise<never>(() => {}));
    mockJitoSell.mockImplementation(() => new Promise<never>(() => {}));
    mockChunkedSell.mockResolvedValue({ confirmedTranches: 2, solReceived: 0.88 });

    const tradeStore = makeTradeStore();
    const ladder = new SellLadder(mockWallet, mockConnections, makeTradingConfig(), tradeStore as never, mockFeeEstimator);

    const resultPromise = ladder.sell(MINT, TOKEN_AMOUNT);
    await vi.advanceTimersByTimeAsync(30001 + 20001 + 30001);
    await vi.runAllTimersAsync();
    await resultPromise;

    expect(tradeStore.transition).toHaveBeenLastCalledWith(
      MINT,
      'SELLING',
      'COMPLETED',
      expect.objectContaining({ sellPriceSol: 0.88 })
    );
  });

  it('uses fallbackSolReceived when solReceived is undefined', async () => {
    mockStandardSell.mockResolvedValue({ signature: 'sig-fb', solReceived: undefined });

    const tradeStore = makeTradeStore();
    const ladder = new SellLadder(mockWallet, mockConnections, makeTradingConfig(), tradeStore as never, mockFeeEstimator);

    const resultPromise = ladder.sell(MINT, TOKEN_AMOUNT, 0.25);  // fallback = 0.25 SOL
    await vi.runAllTimersAsync();
    await resultPromise;

    expect(tradeStore.transition).toHaveBeenLastCalledWith(
      MINT,
      'SELLING',
      'COMPLETED',
      expect.objectContaining({ sellPriceSol: 0.25 })
    );
  });

  // ---------------------------------------------------------------------------
  // Quick-5 partial sell tests: tiered TP SELLING->MONITORING cycling
  // ---------------------------------------------------------------------------

  it('partial=true sell succeeds -- transitions SELLING->MONITORING and decrements tokens', async () => {
    mockStandardSell.mockResolvedValue({ signature: 'sig-partial', solReceived: 0.3 });

    const tradeStore = makeTradeStore();
    const ladder = new SellLadder(mockWallet, mockConnections, makeTradingConfig(), tradeStore as never, mockFeeEstimator);

    const resultPromise = ladder.sell(MINT, TOKEN_AMOUNT, undefined, true);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toEqual({ success: true, step: 'STANDARD', signature: 'sig-partial' });
    // addSellPrice accumulates the tier's SOL
    expect(tradeStore.addSellPrice).toHaveBeenCalledWith(MINT, 0.3);
    // Transition to MONITORING (not COMPLETED)
    expect(tradeStore.transition).toHaveBeenLastCalledWith(
      MINT,
      'SELLING',
      'MONITORING',
      expect.objectContaining({ sellSignature: 'sig-partial' })
    );
    // Decrement amount_tokens by sold amount
    expect(tradeStore.decrementTokenAmount).toHaveBeenCalledWith(MINT, Number(TOKEN_AMOUNT));
    // COMPLETED transition must NOT be called
    const calls = tradeStore.transition.mock.calls;
    const completedCall = calls.find((c: unknown[]) => c[2] === 'COMPLETED');
    expect(completedCall).toBeUndefined();
  });

  it('partial=false sell succeeds -- transitions SELLING->COMPLETED (default behavior preserved)', async () => {
    mockStandardSell.mockResolvedValue({ signature: 'sig-full', solReceived: 0.5 });

    const tradeStore = makeTradeStore();
    const ladder = new SellLadder(mockWallet, mockConnections, makeTradingConfig(), tradeStore as never, mockFeeEstimator);

    const resultPromise = ladder.sell(MINT, TOKEN_AMOUNT);  // no partial flag (defaults false)
    await vi.runAllTimersAsync();
    await resultPromise;

    // Transitions to COMPLETED
    expect(tradeStore.transition).toHaveBeenLastCalledWith(
      MINT,
      'SELLING',
      'COMPLETED',
      expect.anything()
    );
    // decrementTokenAmount must NOT be called
    expect(tradeStore.decrementTokenAmount).not.toHaveBeenCalled();
  });

  it('partial=true all steps exhaust -- still transitions SELLING->FAILED', async () => {
    mockStandardSell.mockImplementation(() => new Promise<never>(() => {}));
    mockJitoSell.mockImplementation(() => new Promise<never>(() => {}));
    mockChunkedSell.mockImplementation(() => new Promise<never>(() => {}));
    mockPumpPortalSell.mockImplementation(() => new Promise<never>(() => {}));

    const tradeStore = makeTradeStore({ getTradeByMintResult: { source: 'pumpportal' } });
    const ladder = new SellLadder(mockWallet, mockConnections, makeTradingConfig(), tradeStore as never, mockFeeEstimator);

    const resultPromise = ladder.sell(MINT, TOKEN_AMOUNT, undefined, true);
    await vi.advanceTimersByTimeAsync(30001 + 20001 + 30001 + 60001 + 30001 + 30001);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toEqual({ success: false, errorMessage: 'SELL_FAILED: all ladder steps exhausted' });
    expect(tradeStore.transition).toHaveBeenLastCalledWith(
      MINT,
      'SELLING',
      'FAILED',
      expect.objectContaining({ errorMessage: 'SELL_FAILED: all ladder steps exhausted' })
    );
    expect(tradeStore.decrementTokenAmount).not.toHaveBeenCalled();
  });

  it('partial=true SELL_PARTIAL event emitted with correct SOL detail', async () => {
    mockStandardSell.mockResolvedValue({ signature: 'sig-p', solReceived: 0.2 });

    const tradeStore = makeTradeStore();
    const ladder = new SellLadder(mockWallet, mockConnections, makeTradingConfig(), tradeStore as never, mockFeeEstimator);

    const { botEventBus } = await import('../../dashboard/bot-event-bus.js');
    const events: Array<{ type: string }> = [];
    const handler = (e: { type: string }) => events.push(e);
    botEventBus.on('event', handler);

    const resultPromise = ladder.sell(MINT, TOKEN_AMOUNT, undefined, true);
    await vi.runAllTimersAsync();
    await resultPromise;

    const partialEvent = events.find(e => e.type === 'SELL_PARTIAL');
    expect(partialEvent).toBeDefined();
    // SELL_CONFIRMED must NOT be emitted for partial sells
    const confirmedEvent = events.find(e => e.type === 'SELL_CONFIRMED');
    expect(confirmedEvent).toBeUndefined();

    botEventBus.removeListener('event', handler);
  });

  // ---------------------------------------------------------------------------
  // Quick-6 fresh balance re-query tests
  // ---------------------------------------------------------------------------

  it('sell() re-queries on-chain balance before steps -- uses fresh balance when lower than passed amount', async () => {
    // Passed tokenAmount = 1_000_000n but wallet only has 500_000 (stale DB value)
    const FRESH_BALANCE = 500_000n;
    mockGetParsedTokenAccountsByOwner.mockResolvedValue({
      value: [{
        account: {
          data: {
            parsed: {
              info: {
                mint: MINT,
                tokenAmount: { amount: FRESH_BALANCE.toString() },
              },
            },
          },
        },
      }],
    });

    mockStandardSell.mockResolvedValue({ signature: 'sig-fresh', solReceived: 0.25 });

    const tradeStore = makeTradeStore();
    const ladder = new SellLadder(mockWallet, mockConnections, makeTradingConfig(), tradeStore as never, mockFeeEstimator);

    const resultPromise = ladder.sell(MINT, TOKEN_AMOUNT); // TOKEN_AMOUNT = 1_000_000n (stale)
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toEqual({ success: true, step: 'STANDARD', signature: 'sig-fresh' });

    // standardSell must receive fresh balance (500_000n), not stale TOKEN_AMOUNT (1_000_000n)
    const standardArgs = mockStandardSell.mock.calls[0];
    expect(standardArgs[1]).toBe(FRESH_BALANCE); // 2nd arg is tokenAmount
  });

  it('sell() uses fresh balance for all sell steps when stale amount was higher', async () => {
    // Wallet has 300_000 tokens; STANDARD and HIGH_FEE hang; JITO succeeds.
    // All steps must use 300_000n (fresh), not TOKEN_AMOUNT (1_000_000n, stale).
    const FRESH_BALANCE = 300_000n;
    mockGetParsedTokenAccountsByOwner.mockResolvedValue({
      value: [{
        account: {
          data: {
            parsed: {
              info: {
                mint: MINT,
                tokenAmount: { amount: FRESH_BALANCE.toString() },
              },
            },
          },
        },
      }],
    });

    mockStandardSell.mockImplementation(() => new Promise<never>(() => {}));
    mockJitoSell.mockResolvedValue({ signature: 'sig-jito', solReceived: 0.15 });

    const tradeStore = makeTradeStore();
    const ladder = new SellLadder(mockWallet, mockConnections, makeTradingConfig(), tradeStore as never, mockFeeEstimator);

    const resultPromise = ladder.sell(MINT, TOKEN_AMOUNT); // stale 1_000_000n passed
    await vi.advanceTimersByTimeAsync(30001 + 20001); // STANDARD + HIGH_FEE timeout
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toEqual({ success: true, step: 'JITO_BUNDLE', signature: 'sig-jito' });

    // STANDARD was called with fresh balance
    expect(mockStandardSell.mock.calls[0][1]).toBe(FRESH_BALANCE);
    expect(mockStandardSell.mock.calls[1][1]).toBe(FRESH_BALANCE); // HIGH_FEE call
    // JITO was called with fresh balance
    expect(mockJitoSell.mock.calls[0][1]).toBe(FRESH_BALANCE);
  });

  it('sell() transitions to COMPLETED when fresh balance is 0 (wallet already empty)', async () => {
    // Fresh balance = 0 means wallet is already empty (sell previously landed or tokens consumed)
    mockGetParsedTokenAccountsByOwner.mockResolvedValue({ value: [] }); // no accounts = 0 balance

    const tradeStore = makeTradeStore();
    const ladder = new SellLadder(mockWallet, mockConnections, makeTradingConfig(), tradeStore as never, mockFeeEstimator);

    const resultPromise = ladder.sell(MINT, TOKEN_AMOUNT);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toEqual({ success: true, step: 'STANDARD', signature: undefined });
    // No sell step functions should have been called -- returned early
    expect(mockStandardSell).not.toHaveBeenCalled();
    // Transition: MONITORING->SELLING (at start), SELLING->COMPLETED (wallet empty)
    expect(tradeStore.transition).toHaveBeenNthCalledWith(1, MINT, 'MONITORING', 'SELLING');
    expect(tradeStore.transition).toHaveBeenNthCalledWith(2, MINT, 'SELLING', 'COMPLETED', expect.anything());
  });

  it('partial sell decrements by fresh balance amount (not stale passed amount)', async () => {
    // Stale amount = 1_000_000n, fresh balance = 400_000n.
    // decrementTokenAmount must use 400_000 (fresh), not 1_000_000 (stale).
    const FRESH_BALANCE = 400_000n;
    mockGetParsedTokenAccountsByOwner.mockResolvedValue({
      value: [{
        account: {
          data: {
            parsed: {
              info: {
                mint: MINT,
                tokenAmount: { amount: FRESH_BALANCE.toString() },
              },
            },
          },
        },
      }],
    });

    mockStandardSell.mockResolvedValue({ signature: 'sig-partial', solReceived: 0.2 });

    const tradeStore = makeTradeStore();
    const ladder = new SellLadder(mockWallet, mockConnections, makeTradingConfig(), tradeStore as never, mockFeeEstimator);

    const resultPromise = ladder.sell(MINT, TOKEN_AMOUNT, undefined, true); // partial=true, stale amount
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toEqual({ success: true, step: 'STANDARD', signature: 'sig-partial' });

    // decrementTokenAmount must use fresh balance (400_000), not stale (1_000_000)
    expect(tradeStore.decrementTokenAmount).toHaveBeenCalledWith(MINT, Number(FRESH_BALANCE));
    expect(tradeStore.decrementTokenAmount).not.toHaveBeenCalledWith(MINT, Number(TOKEN_AMOUNT));
  });
});
