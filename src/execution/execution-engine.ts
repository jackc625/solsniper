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
 */
import type { Keypair, Connection } from '@solana/web3.js';
import { pumpPortalBuy } from './buy/pump-portal-buyer.js';
import { jupiterBuy } from './buy/jupiter-buyer.js';
import type { TokenEvent } from '../types/index.js';
import type { TradingConfig } from '../config/trading.js';
import type { TradeStore } from '../persistence/trade-store.js';
import { createModuleLogger } from '../core/logger.js';

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
   */
  async buy(event: TokenEvent): Promise<void> {
    const { mint, source } = event;
    log.info({ mint, source }, 'Executing buy');

    try {
      const result = source === 'pumpportal'
        ? await pumpPortalBuy(mint, this.config, this.wallet, this.connections)
        : await jupiterBuy(mint, this.config, this.wallet, this.connections);

      if (result.success && result.signature) {
        // Estimate buy price from config (actual price from Phase 7 price polling)
        const buyPriceSol = this.config.buyAmountSol / (result.amountTokens ?? 1);
        this.tradeStore.transition(mint, 'BUYING', 'MONITORING', {
          buySignature: result.signature,
          amountSol: this.config.buyAmountSol,
          amountTokens: result.amountTokens,
          buyPriceSol: result.amountTokens ? buyPriceSol : undefined,
        });
        log.info({ mint, signature: result.signature }, 'Buy confirmed — trade in MONITORING');
      } else {
        this.tradeStore.transition(mint, 'BUYING', 'FAILED', {
          errorMessage: `BUY_FAILED: ${result.errorMessage ?? 'unknown error'}`,
        });
        log.warn({ mint, errorMessage: result.errorMessage }, 'Buy failed — trade marked FAILED');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.tradeStore.transition(mint, 'BUYING', 'FAILED', {
        errorMessage: `BUY_FAILED: ${message}`,
      });
      log.error({ mint, err }, 'Buy threw unexpectedly — trade marked FAILED');
    }
  }
}
