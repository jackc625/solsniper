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
const { mockStandardSell, mockGetAssociatedTokenAddress, mockGetAccount } = vi.hoisted(() => ({
  mockStandardSell: vi.fn(),
  mockGetAssociatedTokenAddress: vi.fn(),
  mockGetAccount: vi.fn(),
}));

vi.mock('./standard-seller.js', () => ({
  standardSell: mockStandardSell,
}));

vi.mock('@solana/spl-token', () => ({
  getAssociatedTokenAddress: mockGetAssociatedTokenAddress,
  getAccount: mockGetAccount,
  TOKEN_PROGRAM_ID: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  TOKEN_2022_PROGRAM_ID: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------
import { chunkedSell } from './chunked-seller.js';
import type { TradingConfig } from '../../config/trading.js';
import type { Keypair, Connection } from '@solana/web3.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
// Must be a valid base58 Solana pubkey — PublicKey constructor validates encoding
const MINT = 'So11111111111111111111111111111111111111112'; // WSOL mint (valid pubkey)

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

describe('chunkedSell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns ChunkedSellOutcome with accumulated solReceived across tranches', async () => {
    mockGetAssociatedTokenAddress.mockResolvedValue('ata-address');
    mockGetAccount.mockResolvedValue({ amount: 3000000n });
    mockStandardSell
      .mockResolvedValueOnce({ signature: 'sig-t1', solReceived: 0.3 })
      .mockResolvedValueOnce({ signature: 'sig-t2', solReceived: 0.3 })
      .mockResolvedValueOnce({ signature: 'sig-t3', solReceived: 0.4 });

    const result = await chunkedSell(
      MINT,
      makeTradingConfig(),
      mockWallet,
      mockConnections
    );

    expect(result).toEqual({ confirmedTranches: 3, solReceived: 1.0 });
  });

  it('returns zero confirmedTranches with undefined solReceived on zero balance', async () => {
    mockGetAssociatedTokenAddress.mockResolvedValue('ata-address');
    mockGetAccount.mockResolvedValue({ amount: 0n });

    const result = await chunkedSell(
      MINT,
      makeTradingConfig(),
      mockWallet,
      mockConnections
    );

    expect(result).toEqual({ confirmedTranches: 0, solReceived: undefined });
  });

  it('accumulates partial solReceived even when some tranches fail', async () => {
    mockGetAssociatedTokenAddress.mockResolvedValue('ata-address');
    mockGetAccount.mockResolvedValue({ amount: 3000000n });
    mockStandardSell
      .mockResolvedValueOnce({ signature: 'sig-t1', solReceived: 0.3 })
      .mockRejectedValueOnce(new Error('tranche 2 failed'))
      .mockResolvedValueOnce({ signature: 'sig-t3', solReceived: 0.4 });

    const result = await chunkedSell(
      MINT,
      makeTradingConfig(),
      mockWallet,
      mockConnections
    );

    expect(result.confirmedTranches).toBe(2);
    expect(result.solReceived).toBeCloseTo(0.7);
  });
});
