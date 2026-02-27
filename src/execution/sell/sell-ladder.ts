/**
 * sell-ladder.ts — Orchestrates the 5-step sell escalation ladder (EXE-06).
 *
 * Step order: STANDARD → HIGH_FEE → JITO_BUNDLE → CHUNKED → EMERGENCY
 * Advancement: time-based only (timeout expiry per step, not failure count)
 * Each step: fresh quote + fresh blockhash (via broadcastAndConfirm or direct)
 *
 * EXE-07: Jito bundle at step 3
 * EXE-09: Emergency 49% slippage (4900 bps) at step 5
 */
import type { Connection, Keypair } from '@solana/web3.js';
import { standardSell } from './standard-seller.js';
import { jitoSell } from './jito-seller.js';
import { chunkedSell } from './chunked-seller.js';
import type { SellResult, SellStep } from '../../types/index.js';
import type { TradingConfig } from '../../config/trading.js';
import type { TradeStore } from '../../persistence/trade-store.js';
import { createModuleLogger } from '../../core/logger.js';
import { botEventBus } from '../../dashboard/bot-event-bus.js';

const log = createModuleLogger('sell-ladder');

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
   */
  async sell(mint: string, tokenAmount: bigint): Promise<SellResult> {
    const { sell } = this.config.execution;

    // Emit SELL_TRIGGERED at entry — dashboard sees all sell attempts regardless of outcome
    botEventBus.emit('event', { type: 'SELL_TRIGGERED', mint, ts: Date.now(), detail: `${tokenAmount} tokens` });

    // Transition to SELLING before starting the ladder
    this.tradeStore.transition(mint, 'MONITORING', 'SELLING');

    const steps: Array<{
      name: SellStep;
      timeoutMs: number;
      fn: () => Promise<string | number>;
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
        fn: () => chunkedSell(mint, this.config, this.wallet, this.connections),
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
      let stepSucceeded = false;

      try {
        const result = await Promise.race([
          step.fn(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`Step ${step.name} timed out after ${step.timeoutMs}ms`)), step.timeoutMs)
          ),
        ]);

        // CHUNKED returns number (count of tranches confirmed); others return string (signature)
        if (step.name === 'CHUNKED') {
          const confirmedTranches = result as number;
          stepSucceeded = confirmedTranches > 0;
          signature = undefined;  // No single signature for chunked sells
        } else {
          signature = result as string;
          stepSucceeded = true;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.warn({ mint, step: step.name, message }, 'Sell step failed or timed out — advancing');
      }

      if (stepSucceeded) {
        this.tradeStore.transition(mint, 'SELLING', 'COMPLETED', {
          sellSignature: signature,
        });
        botEventBus.emit('event', { type: 'SELL_CONFIRMED', mint, ts: Date.now(), detail: step.name });
        log.info({ mint, step: step.name, signature }, 'Sell confirmed — trade COMPLETED');
        return { success: true, step: step.name, signature };
      }
    }

    // All steps exhausted — EXE-06 terminal failure
    this.tradeStore.transition(mint, 'SELLING', 'FAILED', {
      errorMessage: 'SELL_FAILED: all ladder steps exhausted',
    });
    botEventBus.emit('event', { type: 'SELL_FAILED', mint, ts: Date.now(), detail: 'all ladder steps exhausted' });
    log.error({ mint }, 'SELL_FAILED: all escalation steps exhausted');
    return { success: false, errorMessage: 'SELL_FAILED: all ladder steps exhausted' };
  }
}
