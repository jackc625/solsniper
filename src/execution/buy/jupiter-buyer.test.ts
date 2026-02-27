import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Connection, Keypair } from '@solana/web3.js';
import type { TradingConfig } from '../../config/trading.js';

// ---------------------------------------------------------------------------
// Hoisted mocks — declared before imports so vi.mock factories can reference them.
// ---------------------------------------------------------------------------
const { mockBroadcastAndConfirm, mockDeserialize } = vi.hoisted(() => {
  const mockBroadcastAndConfirm = vi.fn().mockResolvedValue({
    signature: 'test-sig-jupiter',
    blockhash: 'test-blockhash',
    lastValidBlockHeight: 1000,
  });

  const mockDeserialize = vi.fn().mockReturnValue({
    message: { recentBlockhash: '' },
    sign: vi.fn(),
    serialize: vi.fn().mockReturnValue(new Uint8Array([1, 2, 3])),
  });

  return { mockBroadcastAndConfirm, mockDeserialize };
});

vi.mock('../broadcaster.js', () => ({
  broadcastAndConfirm: mockBroadcastAndConfirm,
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
  };
}

// Fake base64 transaction bytes (just needs to be decodeable as Buffer)
const FAKE_BASE64_TX = Buffer.from(new Uint8Array([10, 20, 30])).toString('base64');

function makeSuccessFetch(quoteResponse: Record<string, unknown> = { outAmount: '1000000' }) {
  return vi.fn()
    .mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue(quoteResponse),
    })
    .mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ swapTransaction: FAKE_BASE64_TX }),
    });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('jupiterBuy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Re-establish default mock behavior after clearAllMocks
    mockBroadcastAndConfirm.mockResolvedValue({
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
    vi.stubGlobal('fetch', makeSuccessFetch({ outAmount: '1000000' }));

    const config = makeTradingConfig();
    const result = await jupiterBuy('TestMint111111111111111', config, mockWallet, mockConnections);

    expect(result.success).toBe(true);
    expect(result.signature).toBe('test-sig-jupiter');
    expect(result.amountTokens).toBe(1000000);
    expect(mockDeserialize).toHaveBeenCalledOnce();
    expect(mockBroadcastAndConfirm).toHaveBeenCalledOnce();

    vi.unstubAllGlobals();
  });

  it('quote HTTP error — fetch returns 400 — throws error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
    }));

    const config = makeTradingConfig();
    await expect(
      jupiterBuy('TestMint111111111111111', config, mockWallet, mockConnections)
    ).rejects.toThrow('Jupiter quote HTTP 400');

    vi.unstubAllGlobals();
  });

  it('swap HTTP error — quote succeeds, swap returns 500 — throws error', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ outAmount: '1000000' }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
      })
    );

    const config = makeTradingConfig();
    await expect(
      jupiterBuy('TestMint111111111111111', config, mockWallet, mockConnections)
    ).rejects.toThrow('Jupiter swap HTTP 500');

    vi.unstubAllGlobals();
  });

  it('dynamicSlippage false — swap body contains dynamicSlippage: false', async () => {
    const mockFetch = makeSuccessFetch();
    vi.stubGlobal('fetch', mockFetch);

    const config = makeTradingConfig();
    await jupiterBuy('TestMint111111111111111', config, mockWallet, mockConnections);

    // The second fetch call is the swap POST
    const swapCallArgs = mockFetch.mock.calls[1];
    const body = JSON.parse(swapCallArgs[1].body as string);
    expect(body.dynamicSlippage).toBe(false);

    vi.unstubAllGlobals();
  });

  it('no outAmount — quoteResponse missing outAmount — amountTokens is undefined', async () => {
    vi.stubGlobal('fetch', makeSuccessFetch({}));

    const config = makeTradingConfig();
    const result = await jupiterBuy('TestMint111111111111111', config, mockWallet, mockConnections);

    expect(result.success).toBe(true);
    expect(result.amountTokens).toBeUndefined();

    vi.unstubAllGlobals();
  });
});
