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
const { mockJupiterQuote, mockJupiterSwap } = vi.hoisted(() => {
  const mockJupiterQuote = vi.fn();
  const mockJupiterSwap = vi.fn();
  return { mockJupiterQuote, mockJupiterSwap };
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

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------
import { jitoSell, pollBundleStatus } from './jito-seller.js';
import { getRuntimeConfig } from '../../config/trading.js';
import type { TradingConfig } from '../../config/trading.js';

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
      mockConnections
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
      mockConnections
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
        mockConnections
      )
    ).rejects.toThrow('Jupiter unavailable');

    // Jupiter was called (dry-run=false proceeds normally)
    expect(mockJupiterQuote).toHaveBeenCalledOnce();
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
