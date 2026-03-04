import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Connection, Keypair } from '@solana/web3.js';
import type { TradingConfig } from '../../config/trading.js';

// ---------------------------------------------------------------------------
// Hoisted mocks — declared before imports so vi.mock factories can reference them.
// ---------------------------------------------------------------------------
const { mockBroadcastWithRetry, mockDeserialize } = vi.hoisted(() => {
  const mockBroadcastWithRetry = vi.fn().mockResolvedValue({
    signature: 'test-sig-pump',
    blockhash: 'test-blockhash',
    lastValidBlockHeight: 1000,
  });

  const mockDeserialize = vi.fn().mockReturnValue({
    message: { recentBlockhash: '' },
    sign: vi.fn(),
    serialize: vi.fn().mockReturnValue(new Uint8Array([1, 2, 3])),
  });

  return { mockBroadcastWithRetry, mockDeserialize };
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

// ---------------------------------------------------------------------------
// Imports (after mocks are registered)
// ---------------------------------------------------------------------------
import { pumpPortalBuy } from './pump-portal-buyer.js';

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

function makeMockFetch(status: number, arrayBufferData: Uint8Array = new Uint8Array([1, 2, 3])) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    arrayBuffer: vi.fn().mockResolvedValue(arrayBufferData.buffer),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('pumpPortalBuy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Re-establish default mock behavior after clearAllMocks
    mockBroadcastWithRetry.mockResolvedValue({
      signature: 'test-sig-pump',
      blockhash: 'test-blockhash',
      lastValidBlockHeight: 1000,
    });
    mockDeserialize.mockReturnValue({
      message: { recentBlockhash: '' },
      sign: vi.fn(),
      serialize: vi.fn().mockReturnValue(new Uint8Array([1, 2, 3])),
    });
  });

  it('happy path — fetch returns 200 + bytes — broadcastAndConfirm called — returns success', async () => {
    const txBytes = new Uint8Array([10, 20, 30]);
    vi.stubGlobal('fetch', makeMockFetch(200, txBytes));

    const config = makeTradingConfig();
    const result = await pumpPortalBuy('TestMint111111111111111', config, mockWallet, mockConnections);

    expect(result.success).toBe(true);
    expect(result.signature).toBe('test-sig-pump');
    expect(mockDeserialize).toHaveBeenCalledOnce();
    expect(mockBroadcastWithRetry).toHaveBeenCalledOnce();

    vi.unstubAllGlobals();
  });

  it('HTTP error — fetch returns 400 — returns failure without calling broadcastAndConfirm', async () => {
    vi.stubGlobal('fetch', makeMockFetch(400));

    const config = makeTradingConfig();
    const result = await pumpPortalBuy('TestMint111111111111111', config, mockWallet, mockConnections);

    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('PumpPortal HTTP 400');
    expect(mockBroadcastWithRetry).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it('slippage conversion — slippageBps: 1000 → slippage: 10 (percent) in fetch body', async () => {
    const mockFetch = makeMockFetch(200);
    vi.stubGlobal('fetch', mockFetch);

    const config = makeTradingConfig({ slippageBps: 1000 });
    await pumpPortalBuy('TestMint111111111111111', config, mockWallet, mockConnections);

    const callArgs = mockFetch.mock.calls[0];
    const body = JSON.parse(callArgs[1].body as string);
    // 1000 bps / 100 = 10 percent
    expect(body.slippage).toBe(10);

    vi.unstubAllGlobals();
  });

  it('pool field — fetch body contains pool: "pump"', async () => {
    const mockFetch = makeMockFetch(200);
    vi.stubGlobal('fetch', mockFetch);

    const config = makeTradingConfig();
    await pumpPortalBuy('TestMint111111111111111', config, mockWallet, mockConnections);

    const callArgs = mockFetch.mock.calls[0];
    const body = JSON.parse(callArgs[1].body as string);
    expect(body.pool).toBe('pump');

    vi.unstubAllGlobals();
  });
});
