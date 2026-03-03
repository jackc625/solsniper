/**
 * execution-engine.ts — Routes buy to PumpPortal or Jupiter based on TokenEvent.source.
 *
 * EXE-03: Automatic path selection.
 * - source === 'pumpportal' → PumpPortal trade-local (bonding curve)
 * - source === 'raydium' | 'pumpswap' → Jupiter Swap API (migrated)
 *
 * Buy failure behavior (locked decision):
 * - No retry — single attempt, speed over resilience
 * - On failure: transition BUYING → FAILED (terminal), activeMints.delete() auto-called
 * - BUY_FAILED in errorMessage distinguishes from sell failures in DB
 *
 * Post-buy sell-route verification:
 * - For pumpportal tokens, Jupiter may not have indexed the new mint yet.
 * - We schedule a deferred check (fire-and-forget) to verify a sell route exists.
 * - 3 retries at 10s, 15s, 20s delays. Logs warning if all fail — does NOT force-sell.
 */
import type { Keypair, Connection } from '@solana/web3.js';
import { pumpPortalBuy } from './buy/pump-portal-buyer.js';
import { jupiterBuy } from './buy/jupiter-buyer.js';
import { jupiterClient } from './jupiter-client.js';
import type { TokenEvent } from '../types/index.js';
import type { TradingConfig } from '../config/trading.js';
import { getRuntimeConfig } from '../config/trading.js';
import type { TradeStore } from '../persistence/trade-store.js';
import { createModuleLogger } from '../core/logger.js';
import { botEventBus } from '../dashboard/bot-event-bus.js';

const log = createModuleLogger('execution-engine');

export class ExecutionEngine {
  private readonly wallet: Keypair;
  private readonly connections: Connection[];
  private readonly config: TradingConfig;
  private readonly tradeStore: TradeStore;

  constructor(
    wallet: Keypair,
    connections: Connection[],
    config: TradingConfig,
    tradeStore: TradeStore
  ) {
    this.wallet = wallet;
    this.connections = connections;
    this.config = config;
    this.tradeStore = tradeStore;
  }

  /**
   * Executes a buy for the given token event.
   * Assumes createBuyingRecord() has already been called by index.ts (write-ahead).
   * Transitions trade to MONITORING on success, FAILED on failure.
   *
   * For pumpportal tokens: schedules a deferred sell-route verification (fire-and-forget).
   */
  async buy(event: TokenEvent): Promise<void> {
    const { mint, source } = event;
    log.info({ mint, source }, 'Executing buy');

    try {
      // Emit BUY_SENT before dispatching — write-ahead record already created by index.ts
      botEventBus.emit('event', { type: 'BUY_SENT', mint, ts: Date.now(), detail: `via ${source}`, isDryRun: getRuntimeConfig().dryRun, source, buyAmountSol: this.config.buyAmountSol });

      const result = source === 'pumpportal'
        ? await pumpPortalBuy(mint, this.config, this.wallet, this.connections)
        : await jupiterBuy(mint, this.config, this.wallet, this.connections);

      if (result.success && result.signature) {
        // Dry-run PumpPortal: estimate amountTokens from bonding curve state
        if (result.amountTokens == null && getRuntimeConfig().dryRun
            && event.vSolInBondingCurve != null && event.vTokensInBondingCurve != null) {
          // Constant-product AMM: tokensOut = vTokens * solIn / (vSol + solIn)
          // 1.25% pump.fun fee deducted from SOL input before curve calculation
          const solAfterFees = this.config.buyAmountSol * 0.9875;
          const tokensHuman = event.vTokensInBondingCurve * solAfterFees
            / (event.vSolInBondingCurve + solAfterFees);
          result.amountTokens = Math.round(tokensHuman * 1e6); // pump.fun tokens = 6 decimals
          log.info(
            { mint, estimatedTokens: result.amountTokens },
            'Dry-run PumpPortal: estimated amountTokens from bonding curve',
          );
        }

        // Estimate buy price from config (actual price from Phase 7 price polling)
        const buyPriceSol = this.config.buyAmountSol / (result.amountTokens ?? 1);
        this.tradeStore.transition(mint, 'BUYING', 'MONITORING', {
          buySignature: result.signature,
          amountSol: this.config.buyAmountSol,
          amountTokens: result.amountTokens,
          buyPriceSol: result.amountTokens ? buyPriceSol : undefined,
        });
        botEventBus.emit('event', { type: 'BUY_CONFIRMED', mint, ts: Date.now(), detail: result.signature.slice(0, 8), isDryRun: getRuntimeConfig().dryRun, source, buyAmountSol: this.config.buyAmountSol });
        log.info({ mint, signature: result.signature }, 'Buy confirmed — trade in MONITORING');

        // For pumpportal tokens: schedule deferred sell-route verification (fire-and-forget).
        // Jupiter may not have indexed the new mint yet — we verify without blocking buy().
        if (source === 'pumpportal') {
          void this.schedulePostBuySellRouteVerification(mint);
        }
      } else {
        this.tradeStore.transition(mint, 'BUYING', 'FAILED', {
          errorMessage: `BUY_FAILED: ${result.errorMessage ?? 'unknown error'}`,
        });
        botEventBus.emit('event', { type: 'BUY_FAILED', mint, ts: Date.now(), detail: result.errorMessage, isDryRun: getRuntimeConfig().dryRun });
        log.warn({ mint, errorMessage: result.errorMessage }, 'Buy failed — trade marked FAILED');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.tradeStore.transition(mint, 'BUYING', 'FAILED', {
        errorMessage: `BUY_FAILED: ${message}`,
      });
      botEventBus.emit('event', { type: 'BUY_FAILED', mint, ts: Date.now(), detail: message, isDryRun: getRuntimeConfig().dryRun });
      log.error({ mint, err }, 'Buy threw unexpectedly — trade marked FAILED');
    }
  }

  /**
   * Deferred sell-route verification for newly-bought pumpportal tokens.
   *
   * Jupiter may not index the token immediately after launch. We retry at
   * increasing intervals to verify a sell route exists before needing it.
   * This is informational only — we do NOT force-sell if all retries fail.
   *
   * Retry schedule: 10s, 15s, 20s (3 attempts)
   */
  private async schedulePostBuySellRouteVerification(mint: string): Promise<void> {
    const delays = [10_000, 15_000, 20_000];  // retry at 10s, 15s, 20s
    for (let i = 0; i < delays.length; i++) {
      await new Promise<void>(resolve => setTimeout(resolve, delays[i]));
      try {
        const params = new URLSearchParams({
          inputMint: mint,
          outputMint: 'So11111111111111111111111111111111111111112',  // WSOL
          amount: '1000000',
          slippageBps: '500',
        });
        await jupiterClient.quote(params);
        log.info({ mint, attempt: i + 1 }, 'Post-buy sell-route verified');
        return;  // Route found — done
      } catch (err) {
        log.debug({ mint, attempt: i + 1, err }, 'Post-buy sell-route check failed');
      }
    }
    // All retries failed — log warning, keep monitoring (do NOT force-sell)
    log.warn({ mint }, 'Post-buy sell-route verification failed after all retries — monitoring continues');
  }
}
