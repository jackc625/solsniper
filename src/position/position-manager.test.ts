/**
 * Unit tests for PositionManager.
 *
 * Mocks: TradeStore, SellLadder, Solana Connection, JupiterClient.
 * No real SQLite, Solana connections, or Jupiter API calls used.
 *
 * tick() is called directly (not through the timer) for deterministic testing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PublicKey } from '@solana/web3.js';

// ---------------------------------------------------------------------------
// Mock env.js first — logger.ts imports env for LOG_LEVEL/NODE_ENV, and
// env.ts calls process.exit(1) on validation failure if SOLSNIPER_JUPITER_API_KEY
// is not set. Mock prevents that during tests.
// ---------------------------------------------------------------------------
vi.mock('../config/env.js', () => ({
  env: {
    SOLSNIPER_JUPITER_API_KEY: 'test-api-key',
    LOG_LEVEL: 'error',
    NODE_ENV: 'development',
  },
}));

import { PositionManager } from './position-manager.js';
import type { Trade } from '../types/index.js';
import type { TradingConfig } from '../config/trading.js';

// ---------------------------------------------------------------------------
// Valid mainnet pubkey used as wallet address in tests.
// PublicKey constructor validates base58 — invalid strings throw at runtime.
// ---------------------------------------------------------------------------
const WALLET_PUBKEY = new PublicKey('So11111111111111111111111111111111111111112');

// Valid Solana mainnet mint addresses for test fixtures.
const MINT_A = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'; // USDC
const MINT_B = '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs'; // ETH (Wormhole)

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

const mockJupiterClient = {
  quote: vi.fn(),
  swap: vi.fn(),
  isRateLimited: vi.fn().mockReturnValue(false),
  cooldownRemainingMs: vi.fn().mockReturnValue(0),
};

/**
 * Configures mockJupiterClient.quote to return a successful Jupiter quote.
 * outAmountLamports is the raw lamport amount (divide by 1e9 for SOL).
 */
function mockJupiterQuote(outAmountLamports: number) {
  mockJupiterClient.quote.mockResolvedValue({
    outAmount: String(outAmountLamports),
  });
}

/**
 * Configures mockJupiterClient.quote to simulate a failure.
 */
function mockJupiterFailure() {
  mockJupiterClient.quote.mockRejectedValue(new Error('Jupiter quote HTTP 500'));
}

const mockTradeStore = {
  getMonitoringTrades: vi.fn(),
  updateMonitoringAmount: vi.fn().mockReturnValue(1),
  transition: vi.fn().mockReturnValue(1),
};

const mockSellLadder = {
  sell: vi.fn().mockResolvedValue({ success: true, step: 'STANDARD' }),
};

const mockConnection = {
  getParsedTokenAccountsByOwner: vi.fn().mockResolvedValue({ value: [] }),
};

/**
 * Builds a full TradingConfig fixture.
 * Override positionManagement to test specific exit strategies.
 */
function makeConfig(
  overrides: Partial<TradingConfig['positionManagement']> = {},
): TradingConfig {
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
      tieredTp: [
        { at: 2, pct: 33 },
        { at: 5, pct: 33 },
        { at: 10, pct: 34 },
      ],
      trailingStopPct: 0,
      maxHoldTimeMs: 120000,
      ...overrides,
    },
  };
}

/**
 * Builds a Trade fixture in MONITORING state.
 */
function makeTrade(overrides: Partial<Trade> = {}): Trade {
  return {
    id: 1,
    mint: MINT_A,
    state: 'MONITORING',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    amountSol: 1.0,          // 1 SOL entry price
    amountTokens: 1_000_000, // 1M raw tokens
    ...overrides,
  };
}

/**
 * Creates a PositionManager with mockJupiterClient as 6th param.
 * Exposes tick() via type cast for direct testing.
 */
function makePositionManager(config: TradingConfig = makeConfig()) {
  const pm = new PositionManager(
    mockTradeStore as any,
    mockSellLadder as any,
    mockConnection as any,
    WALLET_PUBKEY,
    config,
    mockJupiterClient as any,
  );
  return pm as PositionManager & { tick: () => Promise<void> };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PositionManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockJupiterClient.quote.mockReset();
    mockJupiterClient.isRateLimited.mockReturnValue(false);
    mockJupiterClient.cooldownRemainingMs.mockReturnValue(0);
    mockSellLadder.sell.mockResolvedValue({ success: true, step: 'STANDARD' });
    mockTradeStore.updateMonitoringAmount.mockReturnValue(1);
    mockConnection.getParsedTokenAccountsByOwner.mockResolvedValue({ value: [] });
  });

  // -------------------------------------------------------------------------
  describe('stop-loss', () => {
    it('fires sell when position value drops below stop-loss threshold', async () => {
      // amountSol=1.0, Jupiter returns 0.4 SOL → ratio=0.4 < 0.5 (-50% SL)
      mockJupiterQuote(0.4 * 1e9); // 0.4 SOL in lamports
      mockTradeStore.getMonitoringTrades.mockReturnValue([
        makeTrade({ mint: MINT_A, amountSol: 1.0, amountTokens: 1_000_000 }),
      ]);

      const pm = makePositionManager();
      await pm.tick();

      expect(mockSellLadder.sell).toHaveBeenCalledOnce();
      // 3rd arg is lastKnownQuoteSol fallback (0.4 SOL from the quote above)
      // 4th arg is partial=false (stop-loss is a full sell)
      expect(mockSellLadder.sell).toHaveBeenCalledWith(MINT_A, 1_000_000n, 0.4, false);
    });

    it('does NOT fire sell when position value is above stop-loss threshold', async () => {
      // amountSol=1.0, Jupiter returns 0.6 SOL → ratio=0.6 > 0.5 (-50% SL)
      mockJupiterQuote(0.6 * 1e9);
      mockTradeStore.getMonitoringTrades.mockReturnValue([
        makeTrade({ mint: MINT_A, amountSol: 1.0, amountTokens: 1_000_000 }),
      ]);

      const pm = makePositionManager();
      await pm.tick();

      expect(mockSellLadder.sell).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  describe('tiered take-profit', () => {
    it('tier 0 fires — sells 33% of tokens when ratio >= 2x', async () => {
      // amountSol=1.0, Jupiter returns 2.1 SOL → ratio=2.1 >= 2x
      mockJupiterQuote(2.1 * 1e9);
      mockTradeStore.getMonitoringTrades.mockReturnValue([
        makeTrade({ mint: MINT_A, amountSol: 1.0, amountTokens: 1_000_000 }),
      ]);

      const pm = makePositionManager();
      await pm.tick();

      expect(mockSellLadder.sell).toHaveBeenCalledOnce();
      // 33% of 1_000_000 = 330_000 (integer division: 1_000_000 * 33n / 100n = 330000n)
      // 3rd arg is lastKnownQuoteSol fallback (2.1 SOL from the quote above)
      // 4th arg is partial=true (tier 0 of 3 -- more tiers remain)
      expect(mockSellLadder.sell).toHaveBeenCalledWith(MINT_A, 330_000n, 2.1, true);
    });

    it('tier 1 fires — sells tier 1 tokens when ratio >= 5x and tier index is 1', async () => {
      // amountSol=1.0, Jupiter returns 5.1 SOL → ratio=5.1 >= 5x (tier 1)
      mockJupiterQuote(5.1 * 1e9);

      const pm = makePositionManager();
      // Manually advance tier index to 1 (simulating tier 0 already fired)
      // Access private Map via any cast
      (pm as any).tierIndices.set(MINT_A, 1);

      mockTradeStore.getMonitoringTrades.mockReturnValue([
        makeTrade({ mint: MINT_A, amountSol: 1.0, amountTokens: 1_000_000 }),
      ]);

      await pm.tick();

      expect(mockSellLadder.sell).toHaveBeenCalledOnce();
      // tier 1: pct=33, so 1_000_000 * 33n / 100n = 330000n
      // 3rd arg is lastKnownQuoteSol fallback (5.1 SOL from the quote above)
      // 4th arg is partial=true (tier 1 of 3 -- tier 2 remains)
      expect(mockSellLadder.sell).toHaveBeenCalledWith(MINT_A, 330_000n, 5.1, true);
    });

    it('tiered TP exhausted (past last tier) — no tiered TP fires, SL still evaluates', async () => {
      // tierIndex=3 (beyond array length of 3), ratio=10x — no tiered TP
      // Jupiter returns 10 SOL (10x entry), but all tiers exhausted
      // SL at -50%: ratio=10 > 0.5, so no SL either → no sell
      mockJupiterQuote(10 * 1e9);

      const pm = makePositionManager();
      // Set tier index beyond array bounds
      (pm as any).tierIndices.set(MINT_A, 3);

      mockTradeStore.getMonitoringTrades.mockReturnValue([
        makeTrade({ mint: MINT_A, amountSol: 1.0, amountTokens: 1_000_000 }),
      ]);

      await pm.tick();

      // No tiered TP and no SL (ratio=10 >> threshold)
      expect(mockSellLadder.sell).not.toHaveBeenCalled();
    });

    it('tiered TP advances tier index after firing', async () => {
      // Tier 0 fires (ratio=2.1 >= 2x)
      mockJupiterQuote(2.1 * 1e9);
      mockTradeStore.getMonitoringTrades.mockReturnValue([
        makeTrade({ mint: MINT_A, amountSol: 1.0, amountTokens: 1_000_000 }),
      ]);

      const pm = makePositionManager();
      await pm.tick();

      // After tier 0 fires, index should advance to 1
      expect((pm as any).tierIndices.get(MINT_A)).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  describe('TP takes priority over SL', () => {
    it('fires TP (not SL) when both would trigger in the same cycle', async () => {
      // Configure tiered TP with at=0.9 (below 1x), so TP triggers even on loss
      // SL at -50% also triggers (ratio=0.4 < 0.5)
      // TP should fire, not SL
      mockJupiterQuote(0.4 * 1e9); // 0.4 SOL → ratio=0.4

      const config = makeConfig({
        stopLossPct: -50,
        tieredTp: [{ at: 0.9, pct: 50 }], // triggers at any ratio >= 0.9? No — 0.4 < 0.9
        trailingStopPct: 0,
      });

      // To force BOTH to trigger simultaneously:
      // ratio must be both >= tieredTp[0].at AND < SL threshold
      // Use tieredTp[0].at = 0.3 (triggers when ratio >= 0.3) and SL at -50% (triggers when ratio < 0.5)
      // Jupiter returns 0.4 SOL → ratio=0.4 → 0.4 >= 0.3 ✓ and 0.4 < 0.5 ✓
      const config2 = makeConfig({
        stopLossPct: -50,    // SL threshold: ratio < 0.5
        tieredTp: [{ at: 0.3, pct: 50 }], // TP fires when ratio >= 0.3
        trailingStopPct: 0,
      });

      mockTradeStore.getMonitoringTrades.mockReturnValue([
        makeTrade({ mint: MINT_A, amountSol: 1.0, amountTokens: 1_000_000 }),
      ]);

      const pm = makePositionManager(config2);
      await pm.tick();

      // sell should fire (TP wins over SL — TP returns early before SL check)
      expect(mockSellLadder.sell).toHaveBeenCalledOnce();
      // TP sells 50% of 1_000_000 = 500_000
      // 3rd arg is lastKnownQuoteSol fallback (0.4 SOL from the quote above)
      // 4th arg is partial=false (only 1 tier configured -- this is the final tier)
      expect(mockSellLadder.sell).toHaveBeenCalledWith(MINT_A, 500_000n, 0.4, false);
    });
  });

  // -------------------------------------------------------------------------
  describe('trailing stop', () => {
    it('fires sell when price drops below high watermark by configured pct', async () => {
      // trailingStopPct=20, watermark=2.0 SOL → threshold=2.0*(1-0.2)=1.6 SOL
      // Jupiter returns 1.5 SOL → 1.5 < 1.6 → trailing stop fires
      mockJupiterQuote(1.5 * 1e9);

      const config = makeConfig({ trailingStopPct: 20 });

      const pm = makePositionManager(config);
      // Pre-set the high watermark for MINT_A to 2.0 SOL
      (pm as any).highWatermarks.set(MINT_A, 2.0);

      mockTradeStore.getMonitoringTrades.mockReturnValue([
        makeTrade({ mint: MINT_A, amountSol: 1.0, amountTokens: 1_000_000 }),
      ]);

      await pm.tick();

      expect(mockSellLadder.sell).toHaveBeenCalledOnce();
      // 3rd arg is lastKnownQuoteSol fallback (1.5 SOL from the quote above)
      // 4th arg is partial=false (trailing stop is a full sell)
      expect(mockSellLadder.sell).toHaveBeenCalledWith(MINT_A, 1_000_000n, 1.5, false);
    });

    it('does NOT fire trailing stop when trailingStopPct=0 (disabled)', async () => {
      // Even if current price is below a hypothetical watermark, trailing stop is disabled
      mockJupiterQuote(0.5 * 1e9); // 0.5 SOL — below a 2.0 watermark, but disabled

      const config = makeConfig({
        stopLossPct: -50,    // SL threshold: ratio < 0.5 → 0.5 is NOT < 0.5, so no SL either
        trailingStopPct: 0,
      });

      // Exactly at SL threshold: ratio=0.5, slThreshold=0.5 → NOT strictly less than → no SL
      const pm = makePositionManager(config);
      (pm as any).highWatermarks.set(MINT_A, 2.0); // watermark set but trailing stop disabled

      mockTradeStore.getMonitoringTrades.mockReturnValue([
        makeTrade({ mint: MINT_A, amountSol: 1.0, amountTokens: 1_000_000 }),
      ]);

      await pm.tick();

      // Trailing stop disabled → no trailing stop sell
      // SL: ratio=0.5 is NOT < 0.5 (slThreshold) → no SL either
      expect(mockSellLadder.sell).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  describe('sellsInFlight guard', () => {
    it('prevents double-sell when mint is already in sellsInFlight', async () => {
      mockJupiterQuote(0.4 * 1e9); // would trigger SL
      mockTradeStore.getMonitoringTrades.mockReturnValue([
        makeTrade({ mint: MINT_A, amountSol: 1.0, amountTokens: 1_000_000 }),
      ]);

      const pm = makePositionManager();
      // Inject mint into sellsInFlight to simulate in-progress sell
      (pm as any).sellsInFlight.add(MINT_A);

      await pm.tick();

      // Sell should NOT be called — mint is already in flight
      expect(mockSellLadder.sell).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  describe('Jupiter failure handling', () => {
    it('skips tick when Jupiter quote fails — no sell triggered', async () => {
      mockJupiterFailure();
      mockTradeStore.getMonitoringTrades.mockReturnValue([
        makeTrade({ mint: MINT_A, amountSol: 1.0, amountTokens: 1_000_000 }),
      ]);

      const pm = makePositionManager();
      await pm.tick();

      expect(mockSellLadder.sell).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  describe('PumpPortal backfill', () => {
    it('backfills amountTokens via on-chain query when trade.amountTokens is undefined', async () => {
      // After backfill, position value is retrieved — Jupiter returns above SL
      // so no sell, but updateMonitoringAmount should be called
      mockJupiterQuote(1.0 * 1e9); // 1.0 SOL = ratio 1.0 → no SL/TP

      // Mock connection returning a token account with 1_000_000 tokens
      mockConnection.getParsedTokenAccountsByOwner.mockImplementation(
        (_owner: PublicKey, filter: { mint?: PublicKey; programId?: PublicKey }) => {
          if (filter.mint) {
            return Promise.resolve({
              value: [{
                pubkey: WALLET_PUBKEY,
                account: {
                  data: {
                    parsed: {
                      info: {
                        mint: filter.mint.toBase58(),
                        tokenAmount: { amount: '1000000' },
                      },
                    },
                  },
                },
              }],
            });
          }
          return Promise.resolve({ value: [] }); // Token-2022 empty
        },
      );

      mockTradeStore.getMonitoringTrades.mockReturnValue([
        makeTrade({ mint: MINT_A, amountSol: 1.0, amountTokens: undefined }),
      ]);

      const pm = makePositionManager();
      await pm.tick();

      // updateMonitoringAmount should be called with the on-chain balance
      expect(mockTradeStore.updateMonitoringAmount).toHaveBeenCalledWith(MINT_A, 1000000);
    });

    it('skips position when on-chain balance is 0 during backfill', async () => {
      // Connection returns empty (0 balance)
      mockConnection.getParsedTokenAccountsByOwner.mockResolvedValue({ value: [] });

      mockTradeStore.getMonitoringTrades.mockReturnValue([
        makeTrade({ mint: MINT_A, amountSol: 1.0, amountTokens: undefined }),
      ]);

      const pm = makePositionManager();
      await pm.tick();

      // Cannot monitor with 0 tokens — no sell, no updateMonitoringAmount
      expect(mockSellLadder.sell).not.toHaveBeenCalled();
      expect(mockTradeStore.updateMonitoringAmount).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  describe('dry-run fallback for missing amountTokens', () => {
    it('completes dry-run trade immediately when amountTokens is missing (fallback)', async () => {
      mockTradeStore.getMonitoringTrades.mockReturnValue([
        makeTrade({ mint: MINT_A, amountSol: 1.0, amountTokens: undefined, dryRun: true }),
      ]);

      const pm = makePositionManager();
      await pm.tick();

      // On-chain query should NOT be called — dry-run has no tokens
      expect(mockConnection.getParsedTokenAccountsByOwner).not.toHaveBeenCalled();
      // Should transition to COMPLETED immediately
      expect(mockTradeStore.transition).toHaveBeenCalledWith(
        MINT_A, 'MONITORING', 'COMPLETED',
        { errorMessage: 'DRY_RUN_COMPLETED: no amountTokens and no on-chain balance for dry-run' },
      );
    });

    it('non-dry-run trade with missing amountTokens still does on-chain backfill', async () => {
      mockJupiterQuote(1.0 * 1e9); // ratio=1.0, no SL/TP
      mockConnection.getParsedTokenAccountsByOwner.mockResolvedValue({ value: [] });

      mockTradeStore.getMonitoringTrades.mockReturnValue([
        makeTrade({ mint: MINT_A, amountSol: 1.0, amountTokens: undefined, dryRun: false }),
      ]);

      const pm = makePositionManager();
      await pm.tick();

      // On-chain query SHOULD be called for real trades
      expect(mockConnection.getParsedTokenAccountsByOwner).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  describe('amountTokens float to bigint conversion', () => {
    it('applies Math.round before BigInt conversion to handle float amountTokens', async () => {
      // amountTokens=1000000.7 — direct BigInt() would throw "Cannot convert non-integer"
      // Math.round should produce 1000001n
      mockJupiterQuote(0.3 * 1e9); // ratio=0.3 < 0.5 → SL fires

      mockTradeStore.getMonitoringTrades.mockReturnValue([
        makeTrade({ mint: MINT_A, amountSol: 1.0, amountTokens: 1_000_000.7 }),
      ]);

      const pm = makePositionManager();

      // Should not throw — Math.round applied before BigInt()
      await expect(pm.tick()).resolves.not.toThrow();

      // Sell should be called with rounded amount
      // 3rd arg is lastKnownQuoteSol fallback (0.3 SOL from the quote above)
      // 4th arg is partial=false (stop-loss is a full sell)
      expect(mockSellLadder.sell).toHaveBeenCalledOnce();
      expect(mockSellLadder.sell).toHaveBeenCalledWith(MINT_A, 1_000_001n, 0.3, false);
    });
  });

  // -------------------------------------------------------------------------
  describe('multi-position handling', () => {
    it('evaluates multiple positions independently in same tick', async () => {
      // MINT_A: ratio=0.4 → SL fires
      // MINT_B: ratio=0.8 → no exit
      let callCount = 0;
      mockJupiterClient.quote.mockImplementation(() => {
        callCount++;
        const lamports = callCount === 1 ? 0.4 * 1e9 : 0.8 * 1e9;
        return Promise.resolve({ outAmount: String(lamports) });
      });

      mockTradeStore.getMonitoringTrades.mockReturnValue([
        makeTrade({ mint: MINT_A, amountSol: 1.0, amountTokens: 1_000_000 }),
        makeTrade({ mint: MINT_B, amountSol: 1.0, amountTokens: 2_000_000 }),
      ]);

      const pm = makePositionManager();
      await pm.tick();

      // Only MINT_A's SL fires
      // 3rd arg is lastKnownQuoteSol fallback (0.4 SOL from MINT_A's quote)
      // 4th arg is partial=false (stop-loss is a full sell)
      expect(mockSellLadder.sell).toHaveBeenCalledOnce();
      expect(mockSellLadder.sell).toHaveBeenCalledWith(MINT_A, 1_000_000n, 0.4, false);
    });
  });

  // -------------------------------------------------------------------------
  describe('dry-run position handling', () => {
    it('transitions MONITORING->COMPLETED without calling fireSell when trade.dryRun=true (stop-loss)', async () => {
      // amountSol=1.0, Jupiter returns 0.4 SOL → ratio=0.4 < 0.5 (-50% SL)
      mockJupiterQuote(0.4 * 1e9);

      const mockTransition = vi.fn().mockReturnValue(1);
      (mockTradeStore as any).transition = mockTransition;

      mockTradeStore.getMonitoringTrades.mockReturnValue([
        makeTrade({ mint: MINT_A, amountSol: 1.0, amountTokens: 1_000_000, dryRun: true }),
      ]);

      const pm = makePositionManager();
      await pm.tick();

      // fireSell/sellLadder.sell must NOT have been called
      expect(mockSellLadder.sell).not.toHaveBeenCalled();
      // transition to COMPLETED should be called with dry-run error message
      expect(mockTransition).toHaveBeenCalledWith(MINT_A, 'MONITORING', 'COMPLETED', {
        errorMessage: 'DRY_RUN_TRIGGER: STOP_LOSS',
      });
    });

    it('transitions MONITORING->COMPLETED without calling fireSell when trade.dryRun=true (tiered TP)', async () => {
      // amountSol=1.0, Jupiter returns 2.1 SOL → ratio=2.1 >= 2x (tier 0)
      mockJupiterQuote(2.1 * 1e9);

      const mockTransition = vi.fn().mockReturnValue(1);
      (mockTradeStore as any).transition = mockTransition;

      mockTradeStore.getMonitoringTrades.mockReturnValue([
        makeTrade({ mint: MINT_A, amountSol: 1.0, amountTokens: 1_000_000, dryRun: true }),
      ]);

      const pm = makePositionManager();
      await pm.tick();

      expect(mockSellLadder.sell).not.toHaveBeenCalled();
      expect(mockTransition).toHaveBeenCalledWith(MINT_A, 'MONITORING', 'COMPLETED', {
        errorMessage: expect.stringContaining('DRY_RUN_TRIGGER: TIERED_TP'),
      });
    });

    it('transitions MONITORING->COMPLETED without calling fireSell when trade.dryRun=true (trailing stop)', async () => {
      mockJupiterQuote(1.5 * 1e9); // 1.5 SOL, below 2.0 watermark * 0.8 = 1.6

      const mockTransition = vi.fn().mockReturnValue(1);
      (mockTradeStore as any).transition = mockTransition;

      const config = makeConfig({ trailingStopPct: 20 });

      const pm = makePositionManager(config);
      (pm as any).highWatermarks.set(MINT_A, 2.0);

      mockTradeStore.getMonitoringTrades.mockReturnValue([
        makeTrade({ mint: MINT_A, amountSol: 1.0, amountTokens: 1_000_000, dryRun: true }),
      ]);

      await pm.tick();

      expect(mockSellLadder.sell).not.toHaveBeenCalled();
      expect(mockTransition).toHaveBeenCalledWith(MINT_A, 'MONITORING', 'COMPLETED', {
        errorMessage: 'DRY_RUN_TRIGGER: TRAILING_STOP',
      });
    });

    it('dry-run=false proceeds normally — real trade fires sell as usual', async () => {
      // amountSol=1.0, Jupiter returns 0.4 SOL → ratio=0.4 < 0.5 (-50% SL)
      mockJupiterQuote(0.4 * 1e9);
      mockTradeStore.getMonitoringTrades.mockReturnValue([
        makeTrade({ mint: MINT_A, amountSol: 1.0, amountTokens: 1_000_000, dryRun: false }),
      ]);

      const pm = makePositionManager();
      await pm.tick();

      // Real trade should call fireSell
      // 3rd arg is lastKnownQuoteSol fallback (0.4 SOL from the quote above)
      // 4th arg is partial=false (stop-loss is a full sell)
      expect(mockSellLadder.sell).toHaveBeenCalledOnce();
      expect(mockSellLadder.sell).toHaveBeenCalledWith(MINT_A, 1_000_000n, 0.4, false);
    });
  });

  // -------------------------------------------------------------------------
  describe('max hold time', () => {
    it('fires sell (full position) when position held longer than maxHoldTimeMs', async () => {
      // Trade created 130s ago, maxHoldTimeMs=120000 → holdDuration=130s > 120s → fires sell
      mockJupiterQuote(0.8 * 1e9); // ratio=0.8 → no SL/TP triggers before max hold time

      mockTradeStore.getMonitoringTrades.mockReturnValue([
        makeTrade({ mint: MINT_A, amountSol: 1.0, amountTokens: 1_000_000, createdAt: Date.now() - 130_000 }),
      ]);

      const pm = makePositionManager(makeConfig({ maxHoldTimeMs: 120000 }));
      await pm.tick();

      expect(mockSellLadder.sell).toHaveBeenCalledOnce();
      // 3rd arg is lastKnownQuoteSol fallback (0.8 SOL from the quote above)
      // 4th arg is partial=false (max hold time is a full sell)
      expect(mockSellLadder.sell).toHaveBeenCalledWith(MINT_A, 1_000_000n, 0.8, false);
    });

    it('does NOT fire sell when position held shorter than maxHoldTimeMs', async () => {
      // Trade created 60s ago, maxHoldTimeMs=120000 → holdDuration=60s < 120s → no sell
      mockJupiterQuote(0.8 * 1e9); // ratio=0.8 → no other triggers

      mockTradeStore.getMonitoringTrades.mockReturnValue([
        makeTrade({ mint: MINT_A, amountSol: 1.0, amountTokens: 1_000_000, createdAt: Date.now() - 60_000 }),
      ]);

      const pm = makePositionManager(makeConfig({ maxHoldTimeMs: 120000 }));
      await pm.tick();

      expect(mockSellLadder.sell).not.toHaveBeenCalled();
    });

    it('does NOT fire sell when maxHoldTimeMs=0 (disabled) even if held very long', async () => {
      // Trade created a very long time ago, but maxHoldTimeMs=0 disables the check
      mockJupiterQuote(0.8 * 1e9); // ratio=0.8 → no other triggers

      mockTradeStore.getMonitoringTrades.mockReturnValue([
        makeTrade({ mint: MINT_A, amountSol: 1.0, amountTokens: 1_000_000, createdAt: Date.now() - 999_999_999 }),
      ]);

      const pm = makePositionManager(makeConfig({ maxHoldTimeMs: 0 }));
      await pm.tick();

      expect(mockSellLadder.sell).not.toHaveBeenCalled();
    });

    it('transitions dry-run trade to COMPLETED with DRY_RUN_TRIGGER: MAX_HOLD_TIME (no fireSell)', async () => {
      mockJupiterQuote(0.8 * 1e9); // ratio=0.8 → no other triggers

      const mockTransition = vi.fn().mockReturnValue(1);
      (mockTradeStore as any).transition = mockTransition;

      mockTradeStore.getMonitoringTrades.mockReturnValue([
        makeTrade({ mint: MINT_A, amountSol: 1.0, amountTokens: 1_000_000, createdAt: Date.now() - 130_000, dryRun: true }),
      ]);

      const pm = makePositionManager(makeConfig({ maxHoldTimeMs: 120000 }));
      await pm.tick();

      expect(mockSellLadder.sell).not.toHaveBeenCalled();
      expect(mockTransition).toHaveBeenCalledWith(MINT_A, 'MONITORING', 'COMPLETED', {
        errorMessage: 'DRY_RUN_TRIGGER: MAX_HOLD_TIME',
      });
    });

    it('SL takes priority over max hold time when both would trigger', async () => {
      // Trade created 130s ago (exceeds maxHoldTimeMs=120000) AND ratio=0.3 (below SL -50%)
      // SL is checked first → fires → max hold time block never reached
      mockJupiterQuote(0.3 * 1e9); // ratio=0.3 < slThreshold=0.5 → SL triggers

      mockTradeStore.getMonitoringTrades.mockReturnValue([
        makeTrade({ mint: MINT_A, amountSol: 1.0, amountTokens: 1_000_000, createdAt: Date.now() - 130_000 }),
      ]);

      const pm = makePositionManager(makeConfig({ maxHoldTimeMs: 120000, stopLossPct: -50 }));
      await pm.tick();

      // SL fires (checked before max hold time), sell called exactly once
      // 3rd arg is lastKnownQuoteSol fallback (0.3 SOL from the quote above)
      // 4th arg is partial=false (stop-loss is a full sell)
      expect(mockSellLadder.sell).toHaveBeenCalledOnce();
      expect(mockSellLadder.sell).toHaveBeenCalledWith(MINT_A, 1_000_000n, 0.3, false);
    });
  });

  // -------------------------------------------------------------------------
  describe('maxHoldTimeMs config', () => {
    it('makeConfig() includes maxHoldTimeMs with default 120000', () => {
      const config = makeConfig();
      expect(config.positionManagement.maxHoldTimeMs).toBe(120000);
    });

    it('makeConfig() allows overriding maxHoldTimeMs to 0 (disabled)', () => {
      const config = makeConfig({ maxHoldTimeMs: 0 });
      expect(config.positionManagement.maxHoldTimeMs).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  describe('start/stop lifecycle', () => {
    it('start() and stop() do not throw with no positions', () => {
      mockTradeStore.getMonitoringTrades.mockReturnValue([]);

      const pm = new PositionManager(
        mockTradeStore as any,
        mockSellLadder as any,
        mockConnection as any,
        WALLET_PUBKEY,
        makeConfig(),
        mockJupiterClient as any,
      );

      expect(() => pm.start()).not.toThrow();
      expect(() => pm.stop()).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  describe('dynamic poll interval (cooldown stretching)', () => {
    it('scheduleTick stretches interval when cooldownRemainingMs > 0', () => {
      vi.useFakeTimers();
      mockJupiterClient.cooldownRemainingMs.mockReturnValue(5000); // 5s cooldown remaining
      mockTradeStore.getMonitoringTrades.mockReturnValue([]);

      const config = makeConfig({ pollIntervalMs: 3000 }); // normal interval = 3s
      const pm = new PositionManager(
        mockTradeStore as any,
        mockSellLadder as any,
        mockConnection as any,
        WALLET_PUBKEY,
        config,
        mockJupiterClient as any,
      );

      pm.start();

      // Normal poll interval is 3000ms; cooldown is 5000ms
      // stretched interval = 5000 + 3000 = 8000ms
      // After 3000ms, tick should NOT have fired yet
      vi.advanceTimersByTime(3000);
      expect(mockTradeStore.getMonitoringTrades).not.toHaveBeenCalled();

      // After 8000ms total, tick should fire
      vi.advanceTimersByTime(5001);
      expect(mockTradeStore.getMonitoringTrades).toHaveBeenCalled();

      pm.stop();
      vi.useRealTimers();
    });

    it('scheduleTick uses normal interval when cooldownRemainingMs returns 0', () => {
      vi.useFakeTimers();
      mockJupiterClient.cooldownRemainingMs.mockReturnValue(0); // no cooldown
      mockTradeStore.getMonitoringTrades.mockReturnValue([]);

      const config = makeConfig({ pollIntervalMs: 3000 });
      const pm = new PositionManager(
        mockTradeStore as any,
        mockSellLadder as any,
        mockConnection as any,
        WALLET_PUBKEY,
        config,
        mockJupiterClient as any,
      );

      pm.start();

      // After 3000ms, tick should fire
      vi.advanceTimersByTime(3001);
      expect(mockTradeStore.getMonitoringTrades).toHaveBeenCalled();

      pm.stop();
      vi.useRealTimers();
    });
  });
});
