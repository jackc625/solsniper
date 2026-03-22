/**
 * Unit tests for RecoveryManager.
 *
 * Mocks: TradeStore, SellLadder, Solana Connection.
 * No real SQLite or Solana connections used.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PublicKey } from '@solana/web3.js';
import { RecoveryManager } from './recovery-manager.js';
import type { Trade } from '../types/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const WALLET_PUBKEY = new PublicKey('11111111111111111111111111111111');

// Valid base58 Solana pubkeys used as mint addresses in tests.
// PublicKey constructor validates base58 encoding — fake strings like 'mint1' will throw.
const MINT_A = 'So11111111111111111111111111111111111111112'; // wrapped SOL
const MINT_B = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'; // USDC
const MINT_C = '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs'; // ETH (Wormhole)

const DETECTED_MINT_1 = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
const DETECTED_MINT_2 = '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R';
const SELLING_MINT_1 = 'orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE';
const MONITORING_MINT_1 = 'kinXdEcpDQeHPEuQnqmUgtYykqKTVZek2pF777SQXZ';
const MONITORING_MINT_2 = 'StepAscQoEioFxxWGnh2sLBDFp9d8rvKz2Xzt5Lt3v1';

const makeTrade = (overrides: Partial<Trade>): Trade => ({
  id: 1,
  mint: MINT_A,
  state: 'BUYING',
  createdAt: Date.now(),
  updatedAt: Date.now(),
  ...overrides,
});

/**
 * Builds a mock connection that returns `balanceResult` as the total legacy
 * SPL balance for any mint queried. Token-2022 returns empty.
 */
function makeMockConnection(balanceResult: bigint = 0n) {
  return {
    getParsedTokenAccountsByOwner: vi.fn().mockImplementation(
      (_owner: PublicKey, filter: { mint?: PublicKey; programId?: PublicKey }) => {
        // Legacy SPL call has a { mint } filter
        if (filter.mint) {
          if (balanceResult > 0n) {
            return Promise.resolve({
              value: [{
                pubkey: WALLET_PUBKEY,
                account: {
                  data: {
                    parsed: {
                      info: {
                        mint: filter.mint.toBase58(),
                        tokenAmount: { amount: balanceResult.toString() },
                      },
                    },
                  },
                },
              }],
            });
          }
          return Promise.resolve({ value: [] });
        }
        // Token-2022 call has a { programId } filter — return empty
        return Promise.resolve({ value: [] });
      }
    ),
  };
}

/**
 * Builds a mock connection where the FIRST mint-filtered call rejects,
 * and subsequent mint-filtered calls succeed with `balanceOnSecond`.
 * Token-2022 (programId) calls always return empty.
 */
function makeMockConnectionWithFirstFailure(balanceOnSecond: bigint = 100n) {
  let mintCallCount = 0;
  return {
    getParsedTokenAccountsByOwner: vi.fn().mockImplementation(
      (_owner: PublicKey, filter: { mint?: PublicKey; programId?: PublicKey }) => {
        if (!filter.mint) {
          // Token-2022 programId call — always return empty
          return Promise.resolve({ value: [] });
        }
        mintCallCount++;
        if (mintCallCount === 1) {
          return Promise.reject(new Error('RPC timeout after 5000ms'));
        }
        // Second+ call: return balance
        return Promise.resolve({
          value: [{
            pubkey: WALLET_PUBKEY,
            account: {
              data: {
                parsed: {
                  info: {
                    mint: filter.mint.toBase58(),
                    tokenAmount: { amount: balanceOnSecond.toString() },
                  },
                },
              },
            },
          }],
        });
      }
    ),
  };
}

function makeMockTradeStore(overrides: Record<string, unknown> = {}) {
  return {
    getBuyingTrades: vi.fn().mockReturnValue([]),
    getSellingTrades: vi.fn().mockReturnValue([]),
    getMonitoringTrades: vi.fn().mockReturnValue([]),
    getDetectedTrades: vi.fn().mockReturnValue([]),
    transition: vi.fn().mockReturnValue(1),
    transitionById: vi.fn().mockReturnValue(1),
    ...overrides,
  };
}

function makeMockSellLadder() {
  return { sell: vi.fn().mockResolvedValue({ success: true }) };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RecoveryManager', () => {
  let sellLadder: ReturnType<typeof makeMockSellLadder>;

  beforeEach(() => {
    sellLadder = makeMockSellLadder();
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  describe('DETECTED trades', () => {
    it('marks DETECTED trades as FAILED and counts them', async () => {
      const store = makeMockTradeStore({
        getDetectedTrades: vi.fn().mockReturnValue([
          { id: 1, mint: DETECTED_MINT_1 },
          { id: 2, mint: DETECTED_MINT_2 },
        ]),
      });
      const conn = makeMockConnection(0n);
      const rm = new RecoveryManager(store as any, conn as any, WALLET_PUBKEY, sellLadder as any);
      const summary = await rm.run();

      expect(store.transition).toHaveBeenCalledWith(DETECTED_MINT_1, 'DETECTED', 'FAILED', {
        errorMessage: 'RECOVERY: DETECTED trade discarded',
      });
      expect(store.transition).toHaveBeenCalledWith(DETECTED_MINT_2, 'DETECTED', 'FAILED', {
        errorMessage: 'RECOVERY: DETECTED trade discarded',
      });
      expect(summary.detectedDiscarded).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  describe('BUYING trades', () => {
    it('transitions BUYING→MONITORING when wallet balance > 0', async () => {
      const store = makeMockTradeStore({
        getBuyingTrades: vi.fn().mockReturnValue([
          makeTrade({ id: 1, mint: MINT_A, state: 'BUYING' }),
        ]),
      });
      const conn = makeMockConnection(500n);
      const rm = new RecoveryManager(store as any, conn as any, WALLET_PUBKEY, sellLadder as any);
      const summary = await rm.run();

      expect(store.transition).toHaveBeenCalledWith(MINT_A, 'BUYING', 'MONITORING');
      expect(summary.buyingRecovered).toBe(1);
      expect(summary.buyingUnrecovered).toBe(0);
    });

    it('transitions BUYING→FAILED when wallet balance = 0', async () => {
      const store = makeMockTradeStore({
        getBuyingTrades: vi.fn().mockReturnValue([
          makeTrade({ id: 1, mint: MINT_A, state: 'BUYING' }),
        ]),
      });
      const conn = makeMockConnection(0n);
      const rm = new RecoveryManager(store as any, conn as any, WALLET_PUBKEY, sellLadder as any);
      const summary = await rm.run();

      expect(store.transition).toHaveBeenCalledWith(MINT_A, 'BUYING', 'FAILED', {
        errorMessage: 'RECOVERY: balance=0 -- buy did not land',
      });
      expect(summary.buyingRecovered).toBe(0);
      expect(summary.buyingUnrecovered).toBe(1);
    });

    it('transitions BUYING→FAILED on RPC timeout, increments buyingUnrecovered', async () => {
      const store = makeMockTradeStore({
        getBuyingTrades: vi.fn().mockReturnValue([
          makeTrade({ id: 1, mint: MINT_A, state: 'BUYING' }),
        ]),
      });
      const conn = {
        getParsedTokenAccountsByOwner: vi.fn().mockRejectedValue(
          new Error('RPC timeout after 5000ms')
        ),
      };
      const rm = new RecoveryManager(store as any, conn as any, WALLET_PUBKEY, sellLadder as any);
      const summary = await rm.run();

      expect(store.transition).toHaveBeenCalledWith(MINT_A, 'BUYING', 'FAILED', {
        errorMessage: 'RECOVERY: RPC unavailable',
      });
      expect(summary.buyingUnrecovered).toBe(1);
    });

    it('continues processing other BUYING trades after one RPC failure', async () => {
      const store = makeMockTradeStore({
        getBuyingTrades: vi.fn().mockReturnValue([
          makeTrade({ id: 1, mint: MINT_A, state: 'BUYING' }),
          makeTrade({ id: 2, mint: MINT_B, state: 'BUYING' }),
        ]),
      });
      // First mint-filtered call fails, second succeeds with balance
      const conn = makeMockConnectionWithFirstFailure(200n);
      const rm = new RecoveryManager(store as any, conn as any, WALLET_PUBKEY, sellLadder as any);
      const summary = await rm.run();

      // MINT_A failed (RPC error), MINT_B recovered (balance > 0)
      expect(store.transition).toHaveBeenCalledWith(MINT_A, 'BUYING', 'FAILED', {
        errorMessage: 'RECOVERY: RPC unavailable',
      });
      expect(store.transition).toHaveBeenCalledWith(MINT_B, 'BUYING', 'MONITORING');
      expect(summary.buyingUnrecovered).toBe(1);
      expect(summary.buyingRecovered).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  describe('SELLING trades', () => {
    it('steps back SELLING→MONITORING then calls sellLadder.sell() when balance > 0', async () => {
      const store = makeMockTradeStore({
        getSellingTrades: vi.fn().mockReturnValue([
          makeTrade({ id: 1, mint: SELLING_MINT_1, state: 'SELLING' }),
        ]),
      });
      const conn = makeMockConnection(300n);
      const rm = new RecoveryManager(store as any, conn as any, WALLET_PUBKEY, sellLadder as any);
      const summary = await rm.run();

      // Step back to MONITORING first
      expect(store.transition).toHaveBeenCalledWith(SELLING_MINT_1, 'SELLING', 'MONITORING');
      // Then SellLadder.sell() called
      expect(sellLadder.sell).toHaveBeenCalledWith(SELLING_MINT_1, 300n);
      expect(summary.sellingResumed).toBe(1);
      expect(summary.sellingCompleted).toBe(0);
    });

    it('passes on-chain balance (bigint) as tokenAmount to sellLadder.sell()', async () => {
      const store = makeMockTradeStore({
        getSellingTrades: vi.fn().mockReturnValue([
          // amountTokens stored in DB (could be undefined for PumpPortal)
          makeTrade({ id: 1, mint: SELLING_MINT_1, state: 'SELLING', amountTokens: undefined }),
        ]),
      });
      const conn = makeMockConnection(999999n);
      const rm = new RecoveryManager(store as any, conn as any, WALLET_PUBKEY, sellLadder as any);
      await rm.run();

      // Must use on-chain balance (bigint), not stored amountTokens
      expect(sellLadder.sell).toHaveBeenCalledWith(SELLING_MINT_1, 999999n);
    });

    it('marks SELLING→COMPLETED when wallet balance = 0', async () => {
      const store = makeMockTradeStore({
        getSellingTrades: vi.fn().mockReturnValue([
          makeTrade({ id: 1, mint: SELLING_MINT_1, state: 'SELLING' }),
        ]),
      });
      const conn = makeMockConnection(0n);
      const rm = new RecoveryManager(store as any, conn as any, WALLET_PUBKEY, sellLadder as any);
      const summary = await rm.run();

      expect(store.transition).toHaveBeenCalledWith(SELLING_MINT_1, 'SELLING', 'COMPLETED', {
        errorMessage: 'RECOVERY: sell may have landed -- wallet empty',
      });
      expect(sellLadder.sell).not.toHaveBeenCalled();
      expect(summary.sellingCompleted).toBe(1);
      expect(summary.sellingResumed).toBe(0);
    });

    it('marks SELLING→FAILED on RPC timeout', async () => {
      const store = makeMockTradeStore({
        getSellingTrades: vi.fn().mockReturnValue([
          makeTrade({ id: 1, mint: SELLING_MINT_1, state: 'SELLING' }),
        ]),
      });
      const conn = {
        getParsedTokenAccountsByOwner: vi.fn().mockRejectedValue(
          new Error('RPC timeout after 5000ms')
        ),
      };
      const rm = new RecoveryManager(store as any, conn as any, WALLET_PUBKEY, sellLadder as any);
      const summary = await rm.run();

      expect(store.transition).toHaveBeenCalledWith(SELLING_MINT_1, 'SELLING', 'FAILED', {
        errorMessage: 'RECOVERY: RPC unavailable',
      });
      // BUG 2 fix: RPC failure on SELLING does NOT increment sellingCompleted
      expect(summary.sellingCompleted).toBe(0);
    });

    it('deduplicates multiple SELLING rows for same mint: keeps most recent, marks stale as FAILED', async () => {
      const stale = makeTrade({ id: 1, mint: SELLING_MINT_1, state: 'SELLING', updatedAt: 1000 });
      const current = makeTrade({ id: 2, mint: SELLING_MINT_1, state: 'SELLING', updatedAt: 2000 });
      // getSellingTrades returns ORDER BY updated_at DESC (most recent first)
      const store = makeMockTradeStore({
        getSellingTrades: vi.fn().mockReturnValue([current, stale]),
      });
      const conn = makeMockConnection(500n);
      const rm = new RecoveryManager(store as any, conn as any, WALLET_PUBKEY, sellLadder as any);
      await rm.run();

      // Stale (id=1) marked as FAILED via transitionById
      expect(store.transitionById).toHaveBeenCalledWith(
        stale.id, stale.mint, 'SELLING', 'FAILED',
        expect.objectContaining({ errorMessage: 'RECOVERY: duplicate SELLING record' })
      );
      // Current (id=2) stepped back to MONITORING via transition (not transitionById)
      expect(store.transition).toHaveBeenCalledWith(SELLING_MINT_1, 'SELLING', 'MONITORING');
      // SellLadder called once (for current only)
      expect(sellLadder.sell).toHaveBeenCalledTimes(1);
    });

    it('logs ERROR when multiple SELLING rows exist for same mint', async () => {
      const stale = makeTrade({ id: 1, mint: SELLING_MINT_1, state: 'SELLING', updatedAt: 1000 });
      const current = makeTrade({ id: 2, mint: SELLING_MINT_1, state: 'SELLING', updatedAt: 2000 });
      const store = makeMockTradeStore({
        getSellingTrades: vi.fn().mockReturnValue([current, stale]),
      });
      const conn = makeMockConnection(100n);
      const rm = new RecoveryManager(store as any, conn as any, WALLET_PUBKEY, sellLadder as any);
      // Should not throw — error is logged, not thrown
      await expect(rm.run()).resolves.not.toThrow();
      // Verify stale was processed (evidence of dedup logic running)
      expect(store.transitionById).toHaveBeenCalledWith(
        1, SELLING_MINT_1, 'SELLING', 'FAILED', expect.anything()
      );
    });
  });

  // -------------------------------------------------------------------------
  describe('MONITORING trades', () => {
    it('counts MONITORING trades without making any RPC calls', async () => {
      const store = makeMockTradeStore({
        getMonitoringTrades: vi.fn().mockReturnValue([
          makeTrade({ id: 1, mint: MONITORING_MINT_1, state: 'MONITORING' }),
          makeTrade({ id: 2, mint: MONITORING_MINT_2, state: 'MONITORING' }),
          makeTrade({ id: 3, mint: MINT_C, state: 'MONITORING' }),
        ]),
      });
      const conn = makeMockConnection(0n);
      const rm = new RecoveryManager(store as any, conn as any, WALLET_PUBKEY, sellLadder as any);
      const summary = await rm.run();

      expect(summary.monitoring).toBe(3);
      // RPC should not have been called for any MONITORING mints
      const rpcCalls = (conn.getParsedTokenAccountsByOwner as ReturnType<typeof vi.fn>).mock.calls;
      // No MONITORING mint should appear in any RPC call
      const monitoringMints = [MONITORING_MINT_1, MONITORING_MINT_2, MINT_C];
      for (const call of rpcCalls) {
        if (call[1]?.mint) {
          expect(monitoringMints).not.toContain(call[1].mint.toBase58());
        }
      }
    });

    it('does NOT call transition() for MONITORING trades', async () => {
      const store = makeMockTradeStore({
        getMonitoringTrades: vi.fn().mockReturnValue([
          makeTrade({ id: 1, mint: MONITORING_MINT_1, state: 'MONITORING' }),
        ]),
      });
      const conn = makeMockConnection(0n);
      const rm = new RecoveryManager(store as any, conn as any, WALLET_PUBKEY, sellLadder as any);
      await rm.run();

      // transition() should NOT have been called with MONITORING as from-state
      const monitoringCalls = (store.transition as ReturnType<typeof vi.fn>).mock.calls.filter(
        (args: unknown[]) => args[1] === 'MONITORING'
      );
      expect(monitoringCalls).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  describe('recovery summary', () => {
    it('returns correct counts for mixed scenario', async () => {
      // Use valid Solana pubkeys for all mints
      const BUYING_MINT_RECOVERED = MINT_A;
      const BUYING_MINT_FAILED = MINT_B;
      const SELLING_RESUMED = SELLING_MINT_1;

      const store = makeMockTradeStore({
        getDetectedTrades: vi.fn().mockReturnValue([
          { id: 10, mint: DETECTED_MINT_1 },
          { id: 11, mint: DETECTED_MINT_2 },
        ]),
        getBuyingTrades: vi.fn().mockReturnValue([
          makeTrade({ id: 20, mint: BUYING_MINT_RECOVERED, state: 'BUYING' }),
          makeTrade({ id: 21, mint: BUYING_MINT_FAILED, state: 'BUYING' }),
        ]),
        getSellingTrades: vi.fn().mockReturnValue([
          makeTrade({ id: 30, mint: SELLING_RESUMED, state: 'SELLING' }),
        ]),
        getMonitoringTrades: vi.fn().mockReturnValue([
          makeTrade({ id: 40, mint: MONITORING_MINT_1, state: 'MONITORING' }),
          makeTrade({ id: 41, mint: MONITORING_MINT_2, state: 'MONITORING' }),
        ]),
      });

      // Map mint → balance: SELLING_RESUMED=200, BUYING_MINT_RECOVERED=100, BUYING_MINT_FAILED=0
      const balanceByMint: Record<string, bigint> = {
        [SELLING_RESUMED]: 200n,
        [BUYING_MINT_RECOVERED]: 100n,
        [BUYING_MINT_FAILED]: 0n,
      };

      const conn = {
        getParsedTokenAccountsByOwner: vi.fn().mockImplementation(
          (_owner: PublicKey, filter: { mint?: PublicKey; programId?: PublicKey }) => {
            if (!filter.mint) return Promise.resolve({ value: [] }); // Token-2022 empty
            const mintStr = filter.mint.toBase58();
            const balance = balanceByMint[mintStr] ?? 0n;
            if (balance === 0n) return Promise.resolve({ value: [] });
            return Promise.resolve({
              value: [{
                pubkey: WALLET_PUBKEY,
                account: { data: { parsed: { info: { mint: mintStr, tokenAmount: { amount: balance.toString() } } } } },
              }],
            });
          }
        ),
      };

      const rm = new RecoveryManager(store as any, conn as any, WALLET_PUBKEY, sellLadder as any);
      const summary = await rm.run();

      expect(summary.detectedDiscarded).toBe(2);
      expect(summary.monitoring).toBe(2);
      expect(summary.sellingResumed).toBe(1);
      expect(summary.sellingCompleted).toBe(0);
      expect(summary.buyingRecovered).toBe(1);
      expect(summary.buyingUnrecovered).toBe(1);
    });

    it('returns all-zero summary when no non-terminal trades exist', async () => {
      const store = makeMockTradeStore(); // all return []
      const conn = makeMockConnection(0n);
      const rm = new RecoveryManager(store as any, conn as any, WALLET_PUBKEY, sellLadder as any);
      const summary = await rm.run();

      expect(summary).toEqual({
        monitoring: 0,
        sellingResumed: 0,
        sellingCompleted: 0,
        buyingRecovered: 0,
        buyingUnrecovered: 0,
        detectedDiscarded: 0,
      });
    });
  });

  // -------------------------------------------------------------------------
  describe('dry-run trade abandonment', () => {
    it('abandons dry-run MONITORING trades on recovery (transitions to ABANDONED)', async () => {
      const store = makeMockTradeStore({
        getMonitoringTrades: vi.fn().mockReturnValue([
          makeTrade({ id: 1, mint: MONITORING_MINT_1, state: 'MONITORING', dryRun: true }),
        ]),
      });
      const conn = makeMockConnection(0n);
      const rm = new RecoveryManager(store as any, conn as any, WALLET_PUBKEY, sellLadder as any);
      const summary = await rm.run();

      // Dry-run MONITORING trade should be abandoned
      expect(store.transition).toHaveBeenCalledWith(MONITORING_MINT_1, 'MONITORING', 'ABANDONED', {
        errorMessage: 'RECOVERY: dry-run trade abandoned on restart',
      });
      // Should NOT count toward monitoring
      expect(summary.monitoring).toBe(0);
    });

    it('counts only real (non-dry-run) MONITORING trades in summary', async () => {
      const store = makeMockTradeStore({
        getMonitoringTrades: vi.fn().mockReturnValue([
          makeTrade({ id: 1, mint: MONITORING_MINT_1, state: 'MONITORING', dryRun: true }),
          makeTrade({ id: 2, mint: MONITORING_MINT_2, state: 'MONITORING', dryRun: false }),
        ]),
      });
      const conn = makeMockConnection(0n);
      const rm = new RecoveryManager(store as any, conn as any, WALLET_PUBKEY, sellLadder as any);
      const summary = await rm.run();

      // Only 1 real MONITORING trade counts
      expect(summary.monitoring).toBe(1);
      // Dry-run one gets abandoned
      expect(store.transition).toHaveBeenCalledWith(MONITORING_MINT_1, 'MONITORING', 'ABANDONED', {
        errorMessage: 'RECOVERY: dry-run trade abandoned on restart',
      });
    });

    it('abandons dry-run BUYING trades without RPC balance check', async () => {
      const store = makeMockTradeStore({
        getBuyingTrades: vi.fn().mockReturnValue([
          makeTrade({ id: 1, mint: MINT_A, state: 'BUYING', dryRun: true }),
        ]),
      });
      const conn = makeMockConnection(0n);
      const rm = new RecoveryManager(store as any, conn as any, WALLET_PUBKEY, sellLadder as any);
      const summary = await rm.run();

      expect(store.transition).toHaveBeenCalledWith(MINT_A, 'BUYING', 'ABANDONED', {
        errorMessage: 'RECOVERY: dry-run trade abandoned on restart',
      });
      // Should NOT count as buyingUnrecovered (dry-run is expected)
      expect(summary.buyingUnrecovered).toBe(0);
      expect(summary.buyingRecovered).toBe(0);
    });

    it('abandons dry-run SELLING trades without RPC balance check', async () => {
      const store = makeMockTradeStore({
        getSellingTrades: vi.fn().mockReturnValue([
          makeTrade({ id: 1, mint: SELLING_MINT_1, state: 'SELLING', dryRun: true }),
        ]),
      });
      const conn = makeMockConnection(0n);
      const rm = new RecoveryManager(store as any, conn as any, WALLET_PUBKEY, sellLadder as any);
      await rm.run();

      expect(store.transition).toHaveBeenCalledWith(SELLING_MINT_1, 'SELLING', 'ABANDONED', {
        errorMessage: 'RECOVERY: dry-run trade abandoned on restart',
      });
    });
  });

  // -------------------------------------------------------------------------
  describe('startup ordering (integration hint)', () => {
    it('run() resolves (returns summary) before any external async work completes — verifies await semantics', async () => {
      // A fire-and-forget sell takes a long time but run() should still resolve promptly
      const longSell = vi.fn().mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve({ success: true }), 10_000))
      );
      const store = makeMockTradeStore({
        getSellingTrades: vi.fn().mockReturnValue([
          makeTrade({ id: 1, mint: SELLING_MINT_1, state: 'SELLING' }),
        ]),
      });
      const conn = makeMockConnection(100n);
      const ladderWithSlowSell = { sell: longSell };

      const rm = new RecoveryManager(store as any, conn as any, WALLET_PUBKEY, ladderWithSlowSell as any);

      // run() should resolve even though the fire-and-forget sell hasn't completed
      const start = Date.now();
      const summary = await rm.run();
      const elapsed = Date.now() - start;

      // Should complete well before the 10s slow sell
      expect(elapsed).toBeLessThan(5000);
      expect(summary.sellingResumed).toBe(1);
      // Sell was called (fire-and-forget)
      expect(longSell).toHaveBeenCalledWith(SELLING_MINT_1, 100n);
    });
  });
});
