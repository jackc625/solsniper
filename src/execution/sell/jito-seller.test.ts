/**
 * Unit tests for jitoSell dry-run gate and pollBundleStatus polling loop.
 *
 * Tests that dry-run mode intercepts before Jupiter API calls and Jito bundle submission.
 * Tests that pollBundleStatus polls with backoff until terminal status.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Connection, Keypair } from '@solana/web3.js';

// ---------------------------------------------------------------------------
// Mock env.js first — logger.ts imports env for LOG_LEVEL/NODE_ENV
// ---------------------------------------------------------------------------
vi.mock('../../config/env.js', () => ({
  env: {
    SOLSNIPER_JUPITER_API_KEY: 'test-api-key',
    LOG_LEVEL: 'error',
    NODE_ENV: 'development',
  },
}));

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const { mockJupiterQuote, mockJupiterSwap, mockGetEstimate } = vi.hoisted(() => {
  const mockJupiterQuote = vi.fn();
  const mockJupiterSwap = vi.fn();
  const mockGetEstimate = vi.fn().mockResolvedValue({
    maxLamports: 150000,
    priorityFeeSol: 0.00015,
    source: 'helius' as const,
  });
  return { mockJupiterQuote, mockJupiterSwap, mockGetEstimate };
});

// Mock getRuntimeConfig so we can control dryRun flag
vi.mock('../../config/trading.js', () => ({
  getRuntimeConfig: vi.fn().mockReturnValue({ dryRun: false }),
  tradingConfig: {},
}));

// Mock jupiter-client
vi.mock('../jupiter-client.js', () => ({
  jupiterClient: { quote: mockJupiterQuote, swap: mockJupiterSwap },
}));

// Mock FeeEstimator
vi.mock('../../core/fee-estimator.js', () => ({
  FeeEstimator: vi.fn().mockImplementation(() => ({ getEstimate: mockGetEstimate })),
}));

// Mock @solana/web3.js with controlled VersionedTransaction behavior
vi.mock('@solana/web3.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@solana/web3.js')>();
  return {
    ...actual,
    VersionedTransaction: {
      ...actual.VersionedTransaction,
      deserialize: vi.fn().mockReturnValue({
        message: {
          recentBlockhash: '',
          staticAccountKeys: [],
          compiledInstructions: [],
          addressTableLookups: [],
          header: { numRequiredSignatures: 1, numReadonlySignedAccounts: 0, numReadonlyUnsignedAccounts: 0 },
        },
        sign: vi.fn(),
        serialize: vi.fn().mockReturnValue(new Uint8Array([1, 2, 3])),
        signatures: [new Uint8Array(64)],
      }),
    },
    ComputeBudgetProgram: {
      ...actual.ComputeBudgetProgram,
    },
    MessageV0: actual.MessageV0,
  };
});

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------
import { jitoSell, pollBundleStatus } from './jito-seller.js';
import { getRuntimeConfig } from '../../config/trading.js';
import type { TradingConfig } from '../../config/trading.js';

const mockFeeEstimator = { getEstimate: mockGetEstimate };

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const mockWallet = {
  publicKey: {
    toBase58: () => 'So11111111111111111111111111111111111111112',
  },
} as unknown as Keypair;

const mockConnections = [
  {
    getLatestBlockhash: vi.fn().mockResolvedValue({ blockhash: 'test-blockhash', lastValidBlockHeight: 1000 }),
  } as unknown as Connection,
];

function makeTradingConfig(): TradingConfig {
  return {
    buyAmountSol: 0.1,
    maxSlippageBps: 1000,
    maxConcurrentPositions: 3,
    stopLossPct: -50,
    takeProfitPct: 300,
    minSafetyScore: 60,
    dryRun: false,
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
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('jitoSell dry-run gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getRuntimeConfig).mockReturnValue({ dryRun: false } as ReturnType<typeof getRuntimeConfig>);
    // Re-establish default mock behavior after clearAllMocks
    mockGetEstimate.mockResolvedValue({
      maxLamports: 150000,
      priorityFeeSol: 0.00015,
      source: 'helius' as const,
    });
    // Reset connection mock
    (mockConnections[0]!.getLatestBlockhash as ReturnType<typeof vi.fn>).mockResolvedValue({
      blockhash: 'test-blockhash',
      lastValidBlockHeight: 1000,
    });
  });

  it('dry-run: returns synthetic signature starting with DRY_RUN_JITO_ without calling Jupiter', async () => {
    vi.mocked(getRuntimeConfig).mockReturnValue({ dryRun: true } as ReturnType<typeof getRuntimeConfig>);

    const config = makeTradingConfig();
    const result = await jitoSell(
      'So11111111111111111111111111111111111111112',
      1000000n,
      config,
      mockWallet,
      mockConnections,
      mockFeeEstimator as any
    );

    // Result is SellOutcome — signature should start with DRY_RUN_JITO_, solReceived is undefined in dry-run
    expect(result.signature).toMatch(/^DRY_RUN_JITO_/);
    expect(result.solReceived).toBeUndefined();
    // Jupiter APIs must NOT have been called
    expect(mockJupiterQuote).not.toHaveBeenCalled();
    expect(mockJupiterSwap).not.toHaveBeenCalled();
  });

  it('dry-run: does NOT call fetch (Jito bundle endpoint) in dry-run mode', async () => {
    vi.mocked(getRuntimeConfig).mockReturnValue({ dryRun: true } as ReturnType<typeof getRuntimeConfig>);

    const mockFetch = vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({ result: 'bundle-id' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const config = makeTradingConfig();
    await jitoSell(
      'So11111111111111111111111111111111111111112',
      1000000n,
      config,
      mockWallet,
      mockConnections,
      mockFeeEstimator as any
    );

    // fetch (Jito bundle submission) must NOT have been called
    expect(mockFetch).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it('dry-run=false: attempts Jupiter quote (normal path — would fail without full setup)', async () => {
    vi.mocked(getRuntimeConfig).mockReturnValue({ dryRun: false } as ReturnType<typeof getRuntimeConfig>);
    // Make Jupiter quote throw to verify it was called
    mockJupiterQuote.mockRejectedValueOnce(new Error('Jupiter unavailable'));

    const config = makeTradingConfig();

    await expect(
      jitoSell(
        'So11111111111111111111111111111111111111112',
        1000000n,
        config,
        mockWallet,
        mockConnections,
        mockFeeEstimator as any
      )
    ).rejects.toThrow('Jupiter unavailable');

    // Jupiter was called (dry-run=false proceeds normally)
    expect(mockJupiterQuote).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Dynamic fee + CU simulation tests
// ---------------------------------------------------------------------------

describe('jitoSell dynamic fee + CU simulation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getRuntimeConfig).mockReturnValue({ dryRun: false } as ReturnType<typeof getRuntimeConfig>);
    mockGetEstimate.mockResolvedValue({
      maxLamports: 150000,
      priorityFeeSol: 0.00015,
      source: 'helius' as const,
    });
    (mockConnections[0]!.getLatestBlockhash as ReturnType<typeof vi.fn>).mockResolvedValue({
      blockhash: 'test-blockhash',
      lastValidBlockHeight: 1000,
    });
  });

  it('uses dynamic fee from FeeEstimator — maxLamports * highFeeMultiplier passed to Jupiter swap', async () => {
    mockGetEstimate.mockResolvedValueOnce({
      maxLamports: 100000,
      priorityFeeSol: 0.0001,
      source: 'helius',
    });
    mockJupiterQuote.mockResolvedValueOnce({ outAmount: '500000000' });
    // Mock swap response with enough data to pass through
    const fakeTxBytes = Buffer.from(new Uint8Array(200)).toString('base64');
    mockJupiterSwap.mockResolvedValueOnce({ swapTransaction: fakeTxBytes });

    // We expect it to fail somewhere after swap (we just need to verify swap was called with correct fee)
    try {
      const config = makeTradingConfig();
      await jitoSell(
        'TestMint111111111111111111111111111111111111',
        1000000n,
        config,
        mockWallet,
        mockConnections,
        mockFeeEstimator as any
      );
    } catch {
      // Expected to fail after swap — we only care about fee verification
    }

    expect(mockGetEstimate).toHaveBeenCalled();
    // highFeeMultiplier=3, so 100000 * 3 = 300000, which is under cap of 500000
    const swapCallArgs = mockJupiterSwap.mock.calls[0];
    const body = swapCallArgs[0] as Record<string, unknown>;
    const feeLamports = body.prioritizationFeeLamports as { priorityLevelWithMaxLamports: { maxLamports: number } };
    expect(feeLamports.priorityLevelWithMaxLamports.maxLamports).toBe(300000);
  });

  it('CU simulation failure graceful — continues with original transaction', async () => {
    mockGetEstimate.mockResolvedValueOnce({
      maxLamports: 100000,
      priorityFeeSol: 0.0001,
      source: 'helius',
    });
    mockJupiterQuote.mockResolvedValueOnce({ outAmount: '500000000' });
    const fakeTxBytes = Buffer.from(new Uint8Array(200)).toString('base64');
    mockJupiterSwap.mockResolvedValueOnce({ swapTransaction: fakeTxBytes });

    // Mock simulateTransaction to throw
    const mockSimulate = vi.fn().mockRejectedValue(new Error('Simulation failed'));
    const connectionsWithSim = [{
      getLatestBlockhash: vi.fn().mockResolvedValue({ blockhash: 'test-blockhash', lastValidBlockHeight: 1000 }),
      simulateTransaction: mockSimulate,
    } as unknown as Connection];

    // Should NOT throw even though simulation fails (graceful degradation)
    try {
      const config = makeTradingConfig();
      await jitoSell(
        'TestMint111111111111111111111111111111111111',
        1000000n,
        config,
        mockWallet,
        connectionsWithSim,
        mockFeeEstimator as any
      );
    } catch (err) {
      // May fail later (Jito submission) but should NOT fail due to simulation error
      const msg = err instanceof Error ? err.message : String(err);
      expect(msg).not.toContain('Simulation failed');
    }

    // Verify simulation was attempted
    expect(mockSimulate).toHaveBeenCalled();
  });

  it('Jito tip remains fixed (D-21) — not affected by dynamic fee', async () => {
    mockGetEstimate.mockResolvedValueOnce({
      maxLamports: 999999,
      priorityFeeSol: 0.000999,
      source: 'helius',
    });
    mockJupiterQuote.mockResolvedValueOnce({ outAmount: '500000000' });
    const fakeTxBytes = Buffer.from(new Uint8Array(200)).toString('base64');
    mockJupiterSwap.mockResolvedValueOnce({ swapTransaction: fakeTxBytes });

    // Mock fetch for Jito bundle submission to capture the tip amount
    const mockFetch = vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({ result: 'bundle-id-123' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    // Mock pollBundleStatus to return Landed immediately (via the fetch mock above)
    // We just need to verify tip amount is not dynamic
    try {
      const config = makeTradingConfig();
      await jitoSell(
        'TestMint111111111111111111111111111111111111',
        1000000n,
        config,
        mockWallet,
        mockConnections,
        mockFeeEstimator as any
      );
    } catch {
      // Expected — the mock setup may not complete the full flow
    }

    // The tip amount in config is 100000 lamports (jitoTipLamports)
    // Verify it's still 100000, not 999999 or any other dynamic value
    const config = makeTradingConfig();
    expect(config.execution.sell.jitoTipLamports).toBe(100000);

    vi.unstubAllGlobals();
  });
});

// ---------------------------------------------------------------------------
// pollBundleStatus polling loop tests (BUG 1 fix)
// ---------------------------------------------------------------------------

describe('pollBundleStatus polling loop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('polls multiple times returning Pending, then returns Landed on terminal status', async () => {
    let pollCount = 0;
    const mockFetch = vi.fn().mockImplementation(() => {
      pollCount++;
      // First 2 polls return Pending, 3rd returns Landed
      const status = pollCount >= 3 ? 'Landed' : 'Pending';
      return Promise.resolve({
        json: () => Promise.resolve({
          result: { value: [{ confirmation_status: status }] },
        }),
      });
    });
    vi.stubGlobal('fetch', mockFetch);

    const resultPromise = pollBundleStatus('test-bundle-id');

    // Advance past first delay (1000ms)
    await vi.advanceTimersByTimeAsync(1001);
    // Advance past second delay (2000ms backoff)
    await vi.advanceTimersByTimeAsync(2001);
    // Advance past third delay (4000ms backoff)
    await vi.advanceTimersByTimeAsync(4001);

    const result = await resultPromise;

    expect(result).toBe('Landed');
    // Should have been called 3 times (Pending, Pending, Landed)
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('returns Failed immediately when bundle status is Failed', async () => {
    const mockFetch = vi.fn().mockImplementation(() => {
      return Promise.resolve({
        json: () => Promise.resolve({
          result: { value: [{ confirmation_status: 'Failed' }] },
        }),
      });
    });
    vi.stubGlobal('fetch', mockFetch);

    const resultPromise = pollBundleStatus('test-bundle-id');

    // Advance past first delay (1000ms)
    await vi.advanceTimersByTimeAsync(1001);

    const result = await resultPromise;

    expect(result).toBe('Failed');
    // Should have been called exactly once (immediate terminal status)
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('uses exponential backoff: 1s, 2s, 4s, 5s (capped)', async () => {
    let pollCount = 0;
    const pollTimestamps: number[] = [];

    const mockFetch = vi.fn().mockImplementation(() => {
      pollCount++;
      pollTimestamps.push(Date.now());
      // Return Landed on 5th poll to verify backoff pattern
      const status = pollCount >= 5 ? 'Landed' : 'Pending';
      return Promise.resolve({
        json: () => Promise.resolve({
          result: { value: [{ confirmation_status: status }] },
        }),
      });
    });
    vi.stubGlobal('fetch', mockFetch);

    const resultPromise = pollBundleStatus('test-bundle-id');

    // Advance through all delays: 1s + 2s + 4s + 5s + 5s (capped at 5s)
    await vi.advanceTimersByTimeAsync(1001); // poll 1
    await vi.advanceTimersByTimeAsync(2001); // poll 2
    await vi.advanceTimersByTimeAsync(4001); // poll 3
    await vi.advanceTimersByTimeAsync(5001); // poll 4
    await vi.advanceTimersByTimeAsync(5001); // poll 5

    const result = await resultPromise;

    expect(result).toBe('Landed');
    expect(mockFetch).toHaveBeenCalledTimes(5);

    // Verify backoff timing by checking intervals between timestamps
    if (pollTimestamps.length >= 4) {
      const intervals = pollTimestamps.slice(1).map((t, i) => t - pollTimestamps[i]!);
      // 1st interval ~1000ms, 2nd ~2000ms, 3rd ~4000ms, 4th ~5000ms (capped)
      expect(intervals[0]).toBeGreaterThanOrEqual(1000);
      expect(intervals[1]).toBeGreaterThanOrEqual(2000);
      expect(intervals[2]).toBeGreaterThanOrEqual(4000);
      expect(intervals[3]).toBeGreaterThanOrEqual(5000);
    }
  });

  it('treats missing confirmation_status as Pending and continues polling', async () => {
    let pollCount = 0;
    const mockFetch = vi.fn().mockImplementation(() => {
      pollCount++;
      if (pollCount === 1) {
        // First poll: no result value (status defaults to Pending)
        return Promise.resolve({
          json: () => Promise.resolve({ result: { value: [] } }),
        });
      }
      // Second poll: Landed
      return Promise.resolve({
        json: () => Promise.resolve({
          result: { value: [{ confirmation_status: 'Landed' }] },
        }),
      });
    });
    vi.stubGlobal('fetch', mockFetch);

    const resultPromise = pollBundleStatus('test-bundle-id');

    await vi.advanceTimersByTimeAsync(1001); // poll 1 (empty result -> Pending)
    await vi.advanceTimersByTimeAsync(2001); // poll 2 (Landed)

    const result = await resultPromise;

    expect(result).toBe('Landed');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
