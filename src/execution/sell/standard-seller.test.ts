import { describe, it, expect, vi, beforeEach } from 'vitest';

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
const { mockQuote, mockSwap, mockBroadcast } = vi.hoisted(() => ({
  mockQuote: vi.fn(),
  mockSwap: vi.fn(),
  mockBroadcast: vi.fn(),
}));

vi.mock('../jupiter-client.js', () => ({
  jupiterClient: { quote: mockQuote, swap: mockSwap },
}));

vi.mock('../broadcaster.js', () => ({
  broadcastAndConfirm: mockBroadcast,
}));

// Mock VersionedTransaction.deserialize so it doesn't fail on fake bytes
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
// Imports (after mocks)
// ---------------------------------------------------------------------------
import { standardSell } from './standard-seller.js';
import type { TradingConfig } from '../../config/trading.js';
import type { Keypair, Connection } from '@solana/web3.js';

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

describe('standardSell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns SellOutcome with signature and solReceived from quoteResponse.outAmount', async () => {
    mockQuote.mockResolvedValue({ outAmount: '500000000' }); // 0.5 SOL in lamports
    mockSwap.mockResolvedValue({ swapTransaction: Buffer.from(new Uint8Array(200)).toString('base64') });
    mockBroadcast.mockResolvedValue({ signature: 'test-sig-1', blockhash: 'bh', lastValidBlockHeight: 100 });

    const result = await standardSell(
      MINT,
      TOKEN_AMOUNT,
      { slippageBps: 500, feeMultiplier: 1 },
      makeTradingConfig(),
      mockWallet,
      mockConnections
    );

    expect(result).toEqual({ signature: 'test-sig-1', solReceived: 0.5 });
  });

  it('solReceived is derived from outAmount / 1e9 (lamport to SOL conversion)', async () => {
    mockQuote.mockResolvedValue({ outAmount: '1000000000' }); // 1.0 SOL
    mockSwap.mockResolvedValue({ swapTransaction: Buffer.from(new Uint8Array(200)).toString('base64') });
    mockBroadcast.mockResolvedValue({ signature: 'test-sig-2', blockhash: 'bh', lastValidBlockHeight: 100 });

    const result = await standardSell(
      MINT,
      TOKEN_AMOUNT,
      { slippageBps: 500, feeMultiplier: 1 },
      makeTradingConfig(),
      mockWallet,
      mockConnections
    );

    expect(result).toEqual({ signature: 'test-sig-2', solReceived: 1.0 });
  });

  it('throws on broadcastAndConfirm failure', async () => {
    mockQuote.mockResolvedValue({ outAmount: '500000000' });
    mockSwap.mockResolvedValue({ swapTransaction: Buffer.from(new Uint8Array(200)).toString('base64') });
    mockBroadcast.mockRejectedValue(new Error('RPC timeout'));

    await expect(
      standardSell(MINT, TOKEN_AMOUNT, { slippageBps: 500, feeMultiplier: 1 }, makeTradingConfig(), mockWallet, mockConnections)
    ).rejects.toThrow('RPC timeout');
  });
});
