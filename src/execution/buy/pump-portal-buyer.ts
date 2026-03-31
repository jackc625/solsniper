/**
 * pump-portal-buyer.ts -- Executes buy transactions via PumpPortal trade-local API.
 *
 * EXE-02: PumpPortal trade-local API for bonding curve tokens.
 * Response is raw bytes (arrayBuffer) -- NOT base64 JSON.
 * Slippage is PERCENT (e.g., 10 for 10%), NOT basis points.
 */
import { VersionedTransaction } from '@solana/web3.js';
import type { Connection, Keypair } from '@solana/web3.js';
import { broadcastWithRetry } from '../broadcaster.js';
import type { BuyResult } from '../../types/index.js';
import type { TradingConfig } from '../../config/trading.js';
import type { FeeEstimator } from '../../core/fee-estimator.js';
import type { MetricsTracker } from '../../monitoring/metrics-tracker.js';
import type { ApiAlertCallback } from '../../core/fee-estimator.js';
import { createModuleLogger } from '../../core/logger.js';

const log = createModuleLogger('pump-portal-buyer');
const PUMPPORTAL_API = 'https://pumpportal.fun/api/trade-local';

// D-10: Module-level consecutive failure counter
let consecutiveFailures = 0;

export async function pumpPortalBuy(
  mint: string,
  config: TradingConfig,
  wallet: Keypair,
  connections: Connection[],
  feeEstimator: FeeEstimator,
  metricsTracker?: MetricsTracker,
  onApiAlert?: ApiAlertCallback,
  apiFailureThreshold = 5,
): Promise<BuyResult> {
  const { buy } = config.execution;
  // CRITICAL: PumpPortal slippage is PERCENT, not basis points (bps/100 = percent)
  const slippagePct = buy.slippageBps / 100;
  const feeEstimate = await feeEstimator.getEstimate(config);
  const priorityFeeSol = feeEstimate.priorityFeeSol; // D-02: dynamic fee for PumpPortal
  log.debug({ feeSource: feeEstimate.source, priorityFeeSol }, 'Dynamic fee for PumpPortal buy'); // D-07

  log.debug({ mint, buyAmountSol: config.buyAmountSol, slippagePct }, 'PumpPortal buy initiated');

  const start = Date.now();
  let success = false;
  try {
    const response = await fetch(PUMPPORTAL_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        publicKey: wallet.publicKey.toBase58(),
        action: 'buy',
        mint,
        denominatedInSol: 'true',
        amount: config.buyAmountSol,
        slippage: slippagePct,
        priorityFee: priorityFeeSol,
        pool: 'pump',
      }),
    });

    success = response.ok;

    // D-10: HTTP 429 rate limit detection
    if (response.status === 429) {
      onApiAlert?.('pumpportal:buy', 'rate_limit', 'HTTP 429 rate limit from pumpportal:buy');
    }

    if (!response.ok) {
      return { success: false, errorMessage: `PumpPortal HTTP ${response.status}` };
    }

    // Raw bytes response -- NOT JSON. Use arrayBuffer().
    const txBytes = new Uint8Array(await response.arrayBuffer());
    const tx = VersionedTransaction.deserialize(txBytes);

    const result = await broadcastWithRetry(tx, wallet, connections);

    log.info({ mint, signature: result.signature }, 'PumpPortal buy confirmed');
    return {
      success: true,
      signature: result.signature,
      // amountTokens not available from PumpPortal API response; Phase 7 price polling fills this
      amountTokens: undefined,
    };
  } catch (err) {
    throw err;
  } finally {
    metricsTracker?.record('pumpportal:buy', Date.now() - start, success);

    // D-10: Consecutive failure tracking
    if (!success) {
      consecutiveFailures++;
      if (consecutiveFailures >= apiFailureThreshold) {
        onApiAlert?.('pumpportal:buy', 'consecutive_failure',
          `${consecutiveFailures} consecutive failures on pumpportal:buy`);
      }
    } else {
      consecutiveFailures = 0;
    }
  }
}
