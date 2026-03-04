import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Connection, Keypair } from '@solana/web3.js';
import type { TradingConfig } from '../../config/trading.js';

// ---------------------------------------------------------------------------
// Mock env.js first — logger.ts imports env for LOG_LEVEL/NODE_ENV, and
// env.ts calls process.exit(1) on validation failure if SOLSNIPER_JUPITER_API_KEY
// is not set. Mock prevents that during tests.
// ---------------------------------------------------------------------------
vi.mock('../../config/env.js', () => ({
  env: {
    SOLSNIPER_JUPITER_API_KEY: 'test-api-key',
    LOG_LEVEL: 'error',
    NODE_ENV: 'development',
  },
}));

// ---------------------------------------------------------------------------
// Hoisted mocks — declared before imports so vi.mock factories can reference them.
// ---------------------------------------------------------------------------
const { mockBroadcastWithRetry, mockDeserialize, mockJupiterQuote, mockJupiterSwap } = vi.hoisted(() => {
  const mockBroadcastWithRetry = vi.fn().mockResolvedValue({
    signature: 'test-sig-jupiter',
    blockhash: 'test-blockhash',
    lastValidBlockHeight: 1000,
  });

  const mockDeserialize = vi.fn().mockReturnValue({
    message: { recentBlockhash: '' },
    sign: vi.fn(),
    serialize: vi.fn().mockReturnValue(new Uint8Array([1, 2, 3])),
  });

  const mockJupiterQuote = vi.fn();
  const mockJupiterSwap = vi.fn();

  return { mockBroadcastWithRetry, mockDeserialize, mockJupiterQuote, mockJupiterSwap };
});

vi.mock('../broadcaster.js', () => ({
  broadcastWithRetry: mockBroadcastWithRetry,
}));

vi.mock('@solana/web3.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@solana/web3.js')>();
  return {
    ...actual,
    VersionedTransaction: {
      ...actual.VersionedTransaction,
      deserialize: mockDeserialize,
    },
  };
});

// Mock jupiter-client so env.ts validation doesn't trigger process.exit(1)
vi.mock('../jupiter-client.js', () => ({
  jupiterClient: { quote: mockJupiterQuote, swap: mockJupiterSwap },
}));

// ---------------------------------------------------------------------------
// Imports (after mocks are registered)
// ---------------------------------------------------------------------------
import { jupiterBuy } from './jupiter-buyer.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const mockWallet = {
  publicKey: { toBase58: () => 'TestPublicKey111111111111111111111111111111' },
} as unknown as Keypair;

const mockConnections = [{} as unknown as Connection];

function makeTradingConfig(overrides: Partial<TradingConfig['execution']['buy']> = {}): TradingConfig {
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
        ...overrides,
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

// Fake base64 transaction bytes (just needs to be decodeable as Buffer)
const FAKE_BASE64_TX = Buffer.from(new Uint8Array([10, 20, 30])).toString('base64');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('jupiterBuy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Re-establish default mock behavior after clearAllMocks
    mockBroadcastWithRetry.mockResolvedValue({
      signature: 'test-sig-jupiter',
      blockhash: 'test-blockhash',
      lastValidBlockHeight: 1000,
    });
    mockDeserialize.mockReturnValue({
      message: { recentBlockhash: '' },
      sign: vi.fn(),
      serialize: vi.fn().mockReturnValue(new Uint8Array([1, 2, 3])),
    });
  });

  it('happy path — quote + swap succeed — returns success with amountTokens', async () => {
    mockJupiterQuote.mockResolvedValueOnce({ outAmount: '1000000' });
    mockJupiterSwap.mockResolvedValueOnce({ swapTransaction: FAKE_BASE64_TX });

    const config = makeTradingConfig();
    const result = await jupiterBuy('TestMint111111111111111', config, mockWallet, mockConnections);

    expect(result.success).toBe(true);
    expect(result.signature).toBe('test-sig-jupiter');
    expect(result.amountTokens).toBe(1000000);
    expect(mockDeserialize).toHaveBeenCalledOnce();
    expect(mockBroadcastWithRetry).toHaveBeenCalledOnce();
  });

  it('quote HTTP error — jupiterClient.quote throws — propagates error', async () => {
    mockJupiterQuote.mockRejectedValueOnce(new Error('Jupiter quote HTTP 400'));

    const config = makeTradingConfig();
    await expect(
      jupiterBuy('TestMint111111111111111', config, mockWallet, mockConnections)
    ).rejects.toThrow('Jupiter quote HTTP 400');
  });

  it('swap HTTP error — quote succeeds, swap throws — propagates error', async () => {
    mockJupiterQuote.mockResolvedValueOnce({ outAmount: '1000000' });
    mockJupiterSwap.mockRejectedValueOnce(new Error('Jupiter swap HTTP 500'));

    const config = makeTradingConfig();
    await expect(
      jupiterBuy('TestMint111111111111111', config, mockWallet, mockConnections)
    ).rejects.toThrow('Jupiter swap HTTP 500');
  });

  it('dynamicSlippage false — swap body contains dynamicSlippage: false', async () => {
    mockJupiterQuote.mockResolvedValueOnce({ outAmount: '1000000' });
    mockJupiterSwap.mockResolvedValueOnce({ swapTransaction: FAKE_BASE64_TX });

    const config = makeTradingConfig();
    await jupiterBuy('TestMint111111111111111', config, mockWallet, mockConnections);

    const swapCallArgs = mockJupiterSwap.mock.calls[0];
    const body = swapCallArgs[0] as Record<string, unknown>;
    expect(body.dynamicSlippage).toBe(false);
  });

  it('no outAmount — quoteResponse missing outAmount — amountTokens is undefined', async () => {
    mockJupiterQuote.mockResolvedValueOnce({});
    mockJupiterSwap.mockResolvedValueOnce({ swapTransaction: FAKE_BASE64_TX });

    const config = makeTradingConfig();
    const result = await jupiterBuy('TestMint111111111111111', config, mockWallet, mockConnections);

    expect(result.success).toBe(true);
    expect(result.amountTokens).toBeUndefined();
  });
});
