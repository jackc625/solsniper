/**
 * pump-portal-seller.ts — Executes sell transactions via PumpPortal trade-local API.
 *
 * Mirrors the buy pattern from pump-portal-buyer.ts.
 * Response is raw bytes (arrayBuffer) — NOT base64 JSON.
 * Slippage is PERCENT (e.g., 5 for 5%), NOT basis points.
 * pool='auto' lets PumpPortal pick bonding curve or PumpSwap.
 */
import { VersionedTransaction } from '@solana/web3.js';
import type { Connection, Keypair } from '@solana/web3.js';
import { broadcastAndConfirm } from '../broadcaster.js';
import type { TradingConfig } from '../../config/trading.js';
import type { FeeEstimator } from '../../core/fee-estimator.js';
import type { MetricsTracker } from '../../monitoring/metrics-tracker.js';
import type { ApiAlertCallback } from '../../core/fee-estimator.js';
import type { SellOutcome } from '../../types/index.js';
import { parseSolReceived } from '../../utils/parse-sol-received.js';
import { createModuleLogger } from '../../core/logger.js';

const log = createModuleLogger('pump-portal-seller');
const PUMPPORTAL_API = 'https://pumpportal.fun/api/trade-local';

// D-10: Module-level consecutive failure counter
let consecutiveFailures = 0;

/**
 * Sells tokens via PumpPortal trade-local API.
 *
 * @param mint         - Token mint address (base58)
 * @param tokenAmount  - Exact token amount to sell (raw units as bigint)
 * @param config       - Trading config (slippage from sell.standardSlippageBps)
 * @param wallet       - Signer keypair
 * @param connections  - RPC connections for broadcast
 * @returns SellOutcome { signature, solReceived } on success
 * @throws On HTTP error or broadcast failure
 */
export async function pumpPortalSell(
  mint: string,
  tokenAmount: bigint,
  config: TradingConfig,
  wallet: Keypair,
  connections: Connection[],
  feeEstimator: FeeEstimator,
  metricsTracker?: MetricsTracker,
  onApiAlert?: ApiAlertCallback,
  apiFailureThreshold = 5,
): Promise<SellOutcome> {
  const { sell } = config.execution;
  // CRITICAL: PumpPortal slippage is PERCENT, not basis points (bps/100 = percent)
  const slippagePct = sell.standardSlippageBps / 100;
  const feeEstimate = await feeEstimator.getEstimate(config);
  const priorityFeeSol = feeEstimate.priorityFeeSol; // D-20: same dynamic fee as buy path
  log.debug({ feeSource: feeEstimate.source, priorityFeeSol }, 'Dynamic fee for PumpPortal sell'); // D-07

  log.debug({ mint, tokenAmount: tokenAmount.toString(), slippagePct }, 'PumpPortal sell initiated');

  const start = Date.now();
  let success = false;
  try {
    const response = await fetch(PUMPPORTAL_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        publicKey: wallet.publicKey.toBase58(),
        action: 'sell',
        mint,
        amount: tokenAmount.toString(),
        slippage: slippagePct,
        priorityFee: priorityFeeSol,
        pool: 'auto',  // PumpPortal picks: bonding curve or PumpSwap
      }),
    });

    success = response.ok;

    // D-10: HTTP 429 rate limit detection
    if (response.status === 429) {
      onApiAlert?.('pumpportal:sell', 'rate_limit', 'HTTP 429 rate limit from pumpportal:sell');
    }

    if (!response.ok) {
      throw new Error(`PumpPortal sell HTTP ${response.status}`);
    }

    // Raw bytes response — NOT JSON. Use arrayBuffer().
    const txBytes = new Uint8Array(await response.arrayBuffer());
    const tx = VersionedTransaction.deserialize(txBytes);
    const result = await broadcastAndConfirm(tx, wallet, connections);

    // PumpPortal has no Jupiter quote — parse actual SOL received from on-chain tx
    const solReceived = await parseSolReceived(result.signature, wallet.publicKey, connections[0]);

    log.info({ mint, signature: result.signature, solReceived }, 'PumpPortal sell confirmed');
    return { signature: result.signature, solReceived };
  } catch (err) {
    throw err;
  } finally {
    metricsTracker?.record('pumpportal:sell', Date.now() - start, success);

    // D-10: Consecutive failure tracking
    if (!success) {
      consecutiveFailures++;
      if (consecutiveFailures >= apiFailureThreshold) {
        onApiAlert?.('pumpportal:sell', 'consecutive_failure',
          `${consecutiveFailures} consecutive failures on pumpportal:sell`);
      }
    } else {
      consecutiveFailures = 0;
    }
  }
}
