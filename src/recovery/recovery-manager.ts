/**
 * recovery-manager.ts -- Crash recovery on bot startup (PER-03, PER-05).
 *
 * Reconciles in-flight trades against on-chain wallet state after a crash or
 * restart. Must complete before DetectionManager starts so no duplicate buys
 * race with the in-flight positions being recovered.
 *
 * Recovery decision table:
 *   DETECTED  → always FAILED (no capital at risk; trade never reached chain)
 *   BUYING    → balance > 0: MONITORING (buy landed); balance = 0 or timeout: FAILED
 *   SELLING   → balance > 0: step back to MONITORING, fire sellLadder.sell();
 *               balance = 0: COMPLETED (sell may have landed); timeout: FAILED
 *   MONITORING → no wallet check, loaded as-is (only needs SellLadder re-arm in Phase 7)
 *   Multiple SELLING rows for same mint: keep most recent, mark stale as FAILED
 *
 * On-chain balance: uses a single mint-only getParsedTokenAccountsByOwner query,
 * which covers both TOKEN_PROGRAM_ID (legacy SPL) and TOKEN_2022_PROGRAM_ID
 * (pump.fun create_v2, Nov 2025+) without double-counting Token-2022 accounts.
 */
import { PublicKey, Connection } from '@solana/web3.js';
import type { TradeStore } from '../persistence/trade-store.js';
import type { SellLadder } from '../execution/sell/sell-ladder.js';
import { createModuleLogger } from '../core/logger.js';

const log = createModuleLogger('recovery-manager');

/** Per-trade RPC timeout -- one slow/unavailable RPC does not block others. */
const RPC_TIMEOUT_MS = 5000;

export interface RecoverySummary {
  /** MONITORING trades loaded as-is (no wallet check). */
  monitoring: number;
  /** SELLING trades stepped back to MONITORING + SellLadder called (balance > 0). */
  sellingResumed: number;
  /** SELLING trades marked COMPLETED because wallet was empty (sell may have landed). */
  sellingCompleted: number;
  /** BUYING trades transitioned to MONITORING (balance > 0). */
  buyingRecovered: number;
  /** BUYING trades marked FAILED (balance = 0 or RPC timeout). */
  buyingUnrecovered: number;
  /** DETECTED trades discarded as FAILED (no capital at risk). */
  detectedDiscarded: number;
}

/**
 * Wraps a promise with a timeout. Rejects with an Error if ms elapses first.
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`RPC timeout after ${ms}ms`)), ms)
    ),
  ]);
}

export class RecoveryManager {
  constructor(
    private readonly tradeStore: TradeStore,
    private readonly connection: Connection,
    private readonly walletPubKey: PublicKey,
    private readonly sellLadder: SellLadder,
  ) {}

  /**
   * Runs the full recovery sequence. Blocks until complete.
   * Call this before DetectionManager.start() in index.ts.
   */
  async run(): Promise<RecoverySummary> {
    let monitoring = 0;
    let sellingResumed = 0;
    let sellingCompleted = 0;
    let buyingRecovered = 0;
    let buyingUnrecovered = 0;
    let detectedDiscarded = 0;

    // -------------------------------------------------------------------------
    // Step 1: Discard DETECTED trades -- no capital at risk
    // -------------------------------------------------------------------------
    const detectedTrades = this.tradeStore.getDetectedTrades();
    for (const trade of detectedTrades) {
      this.tradeStore.transition(trade.mint, 'DETECTED', 'FAILED', {
        errorMessage: 'RECOVERY: DETECTED trade discarded',
      });
      detectedDiscarded++;
    }
    log.debug({ count: detectedDiscarded }, 'DETECTED trades discarded');

    // -------------------------------------------------------------------------
    // Step 2: Deduplicate SELLING trades by mint
    // getSellingTrades() returns ORDER BY updated_at DESC so group[0] is most recent.
    // -------------------------------------------------------------------------
    const sellingTrades = this.tradeStore.getSellingTrades();
    const sellingByMint = new Map<string, typeof sellingTrades>();
    for (const trade of sellingTrades) {
      const group = sellingByMint.get(trade.mint) ?? [];
      group.push(trade);
      sellingByMint.set(trade.mint, group);
    }

    // Mark stale duplicates as FAILED, keep one per mint
    const currentSellingTrades: typeof sellingTrades = [];
    for (const [mint, group] of sellingByMint) {
      if (group.length > 1) {
        log.error({ mint, count: group.length }, 'Multiple SELLING records for mint -- keeping most recent');
        for (const stale of group.slice(1)) {
          this.tradeStore.transitionById(stale.id, stale.mint, 'SELLING', 'FAILED', {
            errorMessage: 'RECOVERY: duplicate SELLING record',
          });
        }
      }
      // group[0] is most recent (ORDER BY updated_at DESC)
      currentSellingTrades.push(group[0]);
    }

    // -------------------------------------------------------------------------
    // Step 3: Process SELLING trades (one per mint after dedup)
    // -------------------------------------------------------------------------
    for (const trade of currentSellingTrades) {
      // Skip dry-run SELLING trades -- no real tokens exist
      if (trade.dryRun) {
        this.tradeStore.transition(trade.mint, 'SELLING', 'ABANDONED', {
          errorMessage: 'RECOVERY: dry-run trade abandoned on restart',
        });
        continue;
      }

      try {
        const balance = await withTimeout(
          this.getWalletTokenBalance(trade.mint),
          RPC_TIMEOUT_MS
        );

        if (balance > 0n) {
          // Step back to MONITORING so SellLadder can transition MONITORING→SELLING internally
          this.tradeStore.transition(trade.mint, 'SELLING', 'MONITORING');
          // Fire-and-forget: SellLadder handles its own error logging internally
          void this.sellLadder.sell(trade.mint, balance);
          log.info({ mint: trade.mint, tradeId: trade.id, balance: balance.toString() },
            'SELLING trade resumed -- tokens found in wallet, sell re-initiated');
          sellingResumed++;
        } else {
          // Wallet empty -- sell likely landed before crash
          this.tradeStore.transition(trade.mint, 'SELLING', 'COMPLETED', {
            errorMessage: 'RECOVERY: sell may have landed -- wallet empty',
          });
          log.info({ mint: trade.mint, tradeId: trade.id },
            'SELLING trade completed -- wallet empty, sell assumed landed');
          sellingCompleted++;
        }
      } catch (err) {
        // RPC unavailable or timeout -- fail-safe closed
        // BUG FIX: removed sellingCompleted++ -- RPC failure is NOT a completed sell.
        // The trade transitions to FAILED; no counter should increment.
        this.tradeStore.transition(trade.mint, 'SELLING', 'FAILED', {
          errorMessage: 'RECOVERY: RPC unavailable',
        });
        log.warn({ mint: trade.mint, tradeId: trade.id, err },
          'SELLING trade recovery failed -- RPC unavailable');
      }
    }

    // -------------------------------------------------------------------------
    // Step 4: Process BUYING trades
    // -------------------------------------------------------------------------
    const buyingTrades = this.tradeStore.getBuyingTrades();
    for (const trade of buyingTrades) {
      // Skip dry-run BUYING trades -- no real tokens were purchased
      if (trade.dryRun) {
        this.tradeStore.transition(trade.mint, 'BUYING', 'ABANDONED', {
          errorMessage: 'RECOVERY: dry-run trade abandoned on restart',
        });
        // Don't count as buyingUnrecovered -- expected behavior for dry-run
        continue;
      }

      try {
        const balance = await withTimeout(
          this.getWalletTokenBalance(trade.mint),
          RPC_TIMEOUT_MS
        );

        if (balance > 0n) {
          this.tradeStore.transition(trade.mint, 'BUYING', 'MONITORING');
          log.info({ mint: trade.mint, tradeId: trade.id, balance: balance.toString() },
            'BUYING trade recovered -- tokens found in wallet');
          buyingRecovered++;
        } else {
          this.tradeStore.transition(trade.mint, 'BUYING', 'FAILED', {
            errorMessage: 'RECOVERY: balance=0 -- buy did not land',
          });
          log.warn({ mint: trade.mint, tradeId: trade.id },
            'BUYING trade unrecovered -- wallet balance zero');
          buyingUnrecovered++;
        }
      } catch (err) {
        this.tradeStore.transition(trade.mint, 'BUYING', 'FAILED', {
          errorMessage: 'RECOVERY: RPC unavailable',
        });
        log.warn({ mint: trade.mint, tradeId: trade.id, err },
          'BUYING trade recovery failed -- RPC unavailable');
        buyingUnrecovered++;
      }
    }

    // -------------------------------------------------------------------------
    // Step 5: Count MONITORING trades -- abandon dry-run trades (shadow tracking is ephemeral)
    // -------------------------------------------------------------------------
    const monitoringTrades = this.tradeStore.getMonitoringTrades();
    let dryRunAbandoned = 0;
    for (const trade of monitoringTrades) {
      if (trade.dryRun) {
        this.tradeStore.transition(trade.mint, 'MONITORING', 'ABANDONED', {
          errorMessage: 'RECOVERY: dry-run trade abandoned on restart',
        });
        dryRunAbandoned++;
      }
    }
    monitoring = monitoringTrades.filter(t => !t.dryRun).length;
    if (dryRunAbandoned > 0) {
      log.info({ count: dryRunAbandoned }, 'Dry-run MONITORING trades abandoned');
    }
    log.debug({ count: monitoring }, 'MONITORING trades loaded as-is');

    // -------------------------------------------------------------------------
    // Step 6: Return summary
    // -------------------------------------------------------------------------
    return {
      monitoring,
      sellingResumed,
      sellingCompleted,
      buyingRecovered,
      buyingUnrecovered,
      detectedDiscarded,
    };
  }

  /**
   * Queries on-chain token balance for `mint` using a single mint-only filter.
   * Returns total balance as bigint (sum of all token accounts).
   *
   * Why single query: getParsedTokenAccountsByOwner with {mint} searches ALL token
   * programs (both SPL Token and Token-2022) per Solana RPC behaviour. The previous
   * dual-query approach (one with {mint} + one with {programId: TOKEN_2022_PROGRAM_ID})
   * caused double-counting for Token-2022 tokens, resulting in Jupiter error 6024
   * (InsufficientFunds) when the reported balance was 2x the actual on-chain balance.
   *
   * Reference: https://github.com/solana-labs/solana/issues/31923
   */
  private async getWalletTokenBalance(mint: string): Promise<bigint> {
    const mintPubKey = new PublicKey(mint);

    const result = await this.connection.getParsedTokenAccountsByOwner(
      this.walletPubKey,
      { mint: mintPubKey },
    );

    let total = 0n;

    for (const acct of result.value) {
      const amount: string | undefined = acct.account.data.parsed?.info?.tokenAmount?.amount;
      if (amount) total += BigInt(amount);
    }

    return total;
  }
}
