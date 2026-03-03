import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Keypair, Connection } from '@solana/web3.js';
import type { TradingConfig } from '../../config/trading.js';

// ---------------------------------------------------------------------------
// Hoisted mocks — declared before imports so vi.mock factories can reference them.
// ---------------------------------------------------------------------------
const { mockBroadcastAndConfirm } = vi.hoisted(() => {
  const mockBroadcastAndConfirm = vi.fn();
  return { mockBroadcastAndConfirm };
});

vi.mock('../broadcaster.js', () => ({
  broadcastAndConfirm: mockBroadcastAndConfirm,
}));

// VersionedTransaction.deserialize is a static method — mock at module level
vi.mock('@solana/web3.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@solana/web3.js')>();
  return {
    ...actual,
    VersionedTransaction: {
      ...actual.VersionedTransaction,
      deserialize: vi.fn().mockReturnValue({ message: {}, signatures: [] }),
    },
  };
});

// ---------------------------------------------------------------------------
// Imports (after mocks are registered)
// ---------------------------------------------------------------------------
import { pumpPortalSell } from './pump-portal-seller.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MINT = 'TestMint111111111111111111111111111111111111';
const TOKEN_AMOUNT = 1_000_000n;

const mockWallet = {
  publicKey: {
    toBase58: () => 'WalletPub1111111111111111111111111111111111111',
  },
} as unknown as Keypair;

const mockConnections = [{} as unknown as Connection];

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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('pumpPortalSell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
  });

  it('successful sell — returns signature from broadcastAndConfirm', async () => {
    const txBytes = new Uint8Array([1, 2, 3, 4]);
    const mockResponse = {
      ok: true,
      status: 200,
      arrayBuffer: vi.fn().mockResolvedValue(txBytes.buffer),
    };
    vi.mocked(fetch).mockResolvedValue(mockResponse as unknown as Response);
    mockBroadcastAndConfirm.mockResolvedValue({ signature: 'pump-sell-sig' });

    const result = await pumpPortalSell(MINT, TOKEN_AMOUNT, makeTradingConfig(), mockWallet, mockConnections);

    expect(result).toBe('pump-sell-sig');
    expect(mockBroadcastAndConfirm).toHaveBeenCalledOnce();
  });

  it('HTTP error — throws with status code', async () => {
    const mockResponse = {
      ok: false,
      status: 500,
      arrayBuffer: vi.fn(),
    };
    vi.mocked(fetch).mockResolvedValue(mockResponse as unknown as Response);

    await expect(
      pumpPortalSell(MINT, TOKEN_AMOUNT, makeTradingConfig(), mockWallet, mockConnections)
    ).rejects.toThrow('PumpPortal sell HTTP 500');
  });

  it('POST body has action=sell, pool=auto, amount as string', async () => {
    const txBytes = new Uint8Array([1, 2, 3]);
    const mockResponse = {
      ok: true,
      status: 200,
      arrayBuffer: vi.fn().mockResolvedValue(txBytes.buffer),
    };
    vi.mocked(fetch).mockResolvedValue(mockResponse as unknown as Response);
    mockBroadcastAndConfirm.mockResolvedValue({ signature: 'sig-abc' });

    await pumpPortalSell(MINT, TOKEN_AMOUNT, makeTradingConfig(), mockWallet, mockConnections);

    const [url, options] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toContain('pumpportal.fun');
    const body = JSON.parse(options.body as string);
    expect(body.action).toBe('sell');
    expect(body.pool).toBe('auto');
    expect(body.amount).toBe(TOKEN_AMOUNT.toString());  // string, not bigint
    expect(body.mint).toBe(MINT);
  });

  it('slippage is percent not bps (standardSlippageBps / 100)', async () => {
    const txBytes = new Uint8Array([1, 2, 3]);
    const mockResponse = {
      ok: true,
      status: 200,
      arrayBuffer: vi.fn().mockResolvedValue(txBytes.buffer),
    };
    vi.mocked(fetch).mockResolvedValue(mockResponse as unknown as Response);
    mockBroadcastAndConfirm.mockResolvedValue({ signature: 'sig-abc' });

    const config = makeTradingConfig();
    config.execution.sell.standardSlippageBps = 1000;  // 1000 bps = 10%

    await pumpPortalSell(MINT, TOKEN_AMOUNT, config, mockWallet, mockConnections);

    const [, options] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string);
    // 1000 bps / 100 = 10 percent
    expect(body.slippage).toBe(10);
  });
});
