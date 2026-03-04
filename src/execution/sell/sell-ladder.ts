/**
 * sell-ladder.ts -- Orchestrates the 6-step sell escalation ladder (EXE-06).
 *
 * Step order: STANDARD → HIGH_FEE → JITO_BUNDLE → CHUNKED → PUMPPORTAL → EMERGENCY
 * Advancement: time-based only (timeout expiry per step, not failure count)
 * Each step: fresh quote + fresh blockhash (via broadcastAndConfirm or direct)
 *
 * EXE-07: Jito bundle at step 3
 * EXE-09: Emergency 49% slippage (4900 bps) at step 6
 *
 * PUMPPORTAL step (step 5): only fires for pumpportal-sourced tokens when
 * the last error was a JupiterRouteError with a route-failure code.
 * This handles tokens that Jupiter cannot route (e.g., TOKEN_NOT_TRADABLE).
 */
import type { Connection, Keypair } from '@solana/web3.js';
import { standardSell } from './standard-seller.js';
import { jitoSell } from './jito-seller.js';
import { chunkedSell } from './chunked-seller.js';
import { pumpPortalSell } from './pump-portal-seller.js';
import { JupiterRouteError } from '../jupiter-client.js';
import type { SellResult, SellStep, SellOutcome, ChunkedSellOutcome } from '../../types/index.js';
import type { TradingConfig } from '../../config/trading.js';
import { getRuntimeConfig } from '../../config/trading.js';
import type { TradeStore } from '../../persistence/trade-store.js';
import { createModuleLogger } from '../../core/logger.js';
import { botEventBus } from '../../dashboard/bot-event-bus.js';
import { parseSolReceived } from '../../utils/parse-sol-received.js';

const log = createModuleLogger('sell-ladder');

/** Jupiter route-failure codes that trigger the PumpPortal fallback step. */
const PUMPPORTAL_TRIGGER_CODES = new Set(['TOKEN_NOT_TRADABLE', 'NO_ROUTES_FOUND', 'ROUTE_NOT_FOUND']);

export class SellLadder {
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
   * Runs the full sell escalation ladder for the given mint.
   * Transitions trade from MONITORING → SELLING before starting.
   * Transitions to COMPLETED on success or FAILED if all steps exhaust.
   * EXE-09: Emergency step uses emergencySlippageBps (4900 = 49%).
   *
   * @param fallbackSolReceived - Last known Jupiter quote value from PositionManager.
   *   Used as final fallback if on-chain parse fails and solReceived is still undefined.
   * @param partial - When true, a successful sell transitions SELLING -> MONITORING (not COMPLETED)
   *   and decrements amount_tokens by the sold amount. Used for tiered TP partial sells where
   *   subsequent tiers must still fire. Defaults to false (full sell -> COMPLETED).
   */
  async sell(mint: string, tokenAmount: bigint, fallbackSolReceived?: number, partial = false): Promise<SellResult> {
    const { sell } = this.config.execution;

    // Emit SELL_TRIGGERED at entry -- dashboard sees all sell attempts regardless of outcome
    botEventBus.emit('event', { type: 'SELL_TRIGGERED', mint, ts: Date.now(), detail: `${tokenAmount} tokens`, isDryRun: getRuntimeConfig().dryRun });

    // Transition to SELLING before starting the ladder
    this.tradeStore.transition(mint, 'MONITORING', 'SELLING');

    // Track the last error to determine PUMPPORTAL step eligibility
    let lastError: unknown;

    const steps: Array<{
      name: SellStep;
      timeoutMs: number;
      fn: () => Promise<SellOutcome | ChunkedSellOutcome>;
    }> = [
      {
        name: 'STANDARD',
        timeoutMs: sell.standardTimeoutMs,
        fn: () => standardSell(
          mint, tokenAmount,
          { slippageBps: sell.standardSlippageBps, feeMultiplier: 1 },
          this.config, this.wallet, this.connections
        ),
      },
      {
        name: 'HIGH_FEE',
        timeoutMs: sell.highFeeTimeoutMs,
        fn: () => standardSell(
          mint, tokenAmount,
          { slippageBps: sell.standardSlippageBps, feeMultiplier: sell.highFeeMultiplier },
          this.config, this.wallet, this.connections
        ),
      },
      {
        name: 'JITO_BUNDLE',
        timeoutMs: sell.jitoTimeoutMs,
        fn: () => jitoSell(mint, tokenAmount, this.config, this.wallet, this.connections),
      },
      {
        name: 'CHUNKED',
        timeoutMs: sell.chunkedTimeoutMs,
        fn: () => chunkedSell(mint, this.config, this.wallet, this.connections, this.tradeStore),
      },
      {
        name: 'PUMPPORTAL',
        timeoutMs: 30_000,
        fn: () => {
          // Only fire for pumpportal-sourced tokens with Jupiter route errors
          const trade = this.tradeStore.getTradeByMint(mint);
          if (trade?.source !== 'pumpportal') {
            throw new Error('PumpPortal sell: not a pumpportal token -- skipping');
          }
          if (
            !(lastError instanceof JupiterRouteError) ||
            !lastError.code ||
            !PUMPPORTAL_TRIGGER_CODES.has(lastError.code)
          ) {
            throw new Error('PumpPortal sell: last error not a route failure -- skipping');
          }
          return pumpPortalSell(mint, tokenAmount, this.config, this.wallet, this.connections);
        },
      },
      {
        name: 'EMERGENCY',
        timeoutMs: sell.emergencyTimeoutMs,
        fn: () => standardSell(
          mint, tokenAmount,
          // EXE-09: 49% slippage = 4900 bps, emergencyPriorityMultiplier for max fee
          { slippageBps: sell.emergencySlippageBps, feeMultiplier: sell.emergencyPriorityMultiplier },
          this.config, this.wallet, this.connections
        ),
      },
    ];

    for (const step of steps) {
      log.info({ mint, step: step.name, timeoutMs: step.timeoutMs }, 'Sell ladder step starting');

      let signature: string | undefined;
      let solReceived: number | undefined;
      let stepSucceeded = false;

      try {
        const result = await Promise.race([
          step.fn(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`Step ${step.name} timed out after ${step.timeoutMs}ms`)), step.timeoutMs)
          ),
        ]);

        // Discriminate ChunkedSellOutcome (has confirmedTranches) from SellOutcome (has signature)
        if ('confirmedTranches' in result) {
          const chunked = result as ChunkedSellOutcome;
          stepSucceeded = chunked.confirmedTranches > 0;
          signature = undefined;  // No single signature for chunked sells
          solReceived = chunked.solReceived;
        } else {
          const outcome = result as SellOutcome;
          signature = outcome.signature;
          solReceived = outcome.solReceived;
          stepSucceeded = true;
        }

        // EMERGENCY step override: per locked decision, EMERGENCY (49% slippage) uses
        // on-chain transaction parse instead of Jupiter quote outAmount because the quote
        // is unreliable at extreme slippage levels.
        if (stepSucceeded && step.name === 'EMERGENCY' && signature) {
          const onChainSol = await parseSolReceived(signature, this.wallet.publicKey, this.connections[0]);
          if (onChainSol != null) {
            log.info({ mint, quoteEstimate: solReceived, onChainActual: onChainSol }, 'EMERGENCY: using on-chain parse instead of quote');
            solReceived = onChainSol;
          } else {
            log.warn({ mint, quoteEstimate: solReceived }, 'EMERGENCY: on-chain parse failed, using quote estimate as fallback');
            // Keep solReceived from the quote as last resort
          }
        }

        // Fallback: if solReceived is still undefined after all attempts,
        // use PositionManager's last known quote value (per locked decision:
        // "Fall back to last known PositionManager quote value rather than storing NULL")
        if (stepSucceeded && solReceived == null && fallbackSolReceived != null) {
          log.warn({ mint, fallbackSolReceived }, 'solReceived undefined -- falling back to last known PositionManager quote');
          solReceived = fallbackSolReceived;
        }
      } catch (err) {
        lastError = err;  // Track for PUMPPORTAL trigger logic
        const message = err instanceof Error ? err.message : String(err);
        log.warn({ mint, step: step.name, message }, 'Sell step failed or timed out -- advancing');
      }

      if (stepSucceeded) {
        // Accumulate sell price for tiered TP tracking (crash-safe SQL increment).
        // Called BEFORE getTradeByMint so priorTrade.sellPriceSol reflects the already-accumulated total.
        if (solReceived != null) {
          this.tradeStore.addSellPrice(mint, solReceived);
        }

        // Read accumulated state (including the just-added delta for partial path display)
        const priorTrade = this.tradeStore.getTradeByMint(mint);
        const hasPriorSellPrice = priorTrade?.sellPriceSol != null && priorTrade.sellPriceSol > 0;

        if (partial) {
          // --- PARTIAL SELL: return to MONITORING for next tier ---

          // Emit SELL_PARTIAL event (for both first-tier and subsequent-tier partials)
          const totalSellPrice = priorTrade?.sellPriceSol ?? 0;
          botEventBus.emit('event', {
            type: 'SELL_PARTIAL',
            mint,
            ts: Date.now(),
            detail: `${step.name}: +${(solReceived ?? 0).toFixed(6)} SOL (total: ${totalSellPrice.toFixed(6)} SOL)`,
            isDryRun: getRuntimeConfig().dryRun,
            pnlSol: solReceived,
          });
          log.info({ mint, step: step.name, tierSolReceived: solReceived, totalSellPrice }, 'Partial sell confirmed -- returning to MONITORING');

          // Transition SELLING -> MONITORING (not COMPLETED)
          this.tradeStore.transition(mint, 'SELLING', 'MONITORING', {
            sellSignature: signature,
          });

          // Decrement amount_tokens by the sold amount so next tier uses remaining balance
          this.tradeStore.decrementTokenAmount(mint, Number(tokenAmount));

          return { success: true, step: step.name, signature };
        }

        // --- FULL SELL: transition to COMPLETED ---

        // Emit SELL_PARTIAL for accumulated tiers context (if this is the final tier after prior partials)
        if (hasPriorSellPrice && solReceived != null) {
          const runningTotal = priorTrade.sellPriceSol! + solReceived;
          botEventBus.emit('event', {
            type: 'SELL_PARTIAL',
            mint,
            ts: Date.now(),
            detail: `${step.name}: +${solReceived.toFixed(6)} SOL (total: ${runningTotal.toFixed(6)} SOL)`,
            isDryRun: getRuntimeConfig().dryRun,
            pnlSol: solReceived,
          });
        }

        // Transition SELLING -> COMPLETED.
        // Don't overwrite accumulated sell_price_sol from addSellPrice -- let COALESCE preserve it.
        // When hasPriorSellPrice is true (tiered sell), sell_price_sol was already accumulated via addSellPrice.
        // When false (non-tiered sell), pass solReceived directly as before.
        this.tradeStore.transition(mint, 'SELLING', 'COMPLETED', {
          sellSignature: signature,
          sellPriceSol: hasPriorSellPrice ? undefined : solReceived,
        });

        const completedTrade = this.tradeStore.getTradeByMint(mint);
        // FIX: pnlSol = sellPriceSol - amountSol (total out minus total in)
        // Was incorrectly: sellPriceSol - buyPriceSol (per-token unit delta)
        const pnlSol = (completedTrade?.sellPriceSol != null && completedTrade?.amountSol != null)
          ? completedTrade.sellPriceSol - completedTrade.amountSol
          : undefined;
        botEventBus.emit('event', { type: 'SELL_CONFIRMED', mint, ts: Date.now(), detail: step.name, isDryRun: getRuntimeConfig().dryRun, pnlSol });
        log.info({ mint, step: step.name, signature, solReceived, pnlSol }, 'Sell confirmed -- trade COMPLETED');
        return { success: true, step: step.name, signature };
      }
    }

    // All steps exhausted -- EXE-06 terminal failure
    this.tradeStore.transition(mint, 'SELLING', 'FAILED', {
      errorMessage: 'SELL_FAILED: all ladder steps exhausted',
    });
    const failedTrade = this.tradeStore.getTradeByMint(mint);
    // FIX: pnlSol uses amountSol (not buyPriceSol)
    const pnlSol = (failedTrade?.sellPriceSol != null && failedTrade?.amountSol != null)
      ? failedTrade.sellPriceSol - failedTrade.amountSol
      : undefined;
    botEventBus.emit('event', { type: 'SELL_FAILED', mint, ts: Date.now(), detail: 'all ladder steps exhausted', isDryRun: getRuntimeConfig().dryRun, pnlSol });
    log.error({ mint }, 'SELL_FAILED: all escalation steps exhausted');
    return { success: false, errorMessage: 'SELL_FAILED: all ladder steps exhausted' };
  }
}
