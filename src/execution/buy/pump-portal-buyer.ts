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
import { createModuleLogger } from '../../core/logger.js';

const log = createModuleLogger('pump-portal-buyer');
const PUMPPORTAL_API = 'https://pumpportal.fun/api/trade-local';

export async function pumpPortalBuy(
  mint: string,
  config: TradingConfig,
  wallet: Keypair,
  connections: Connection[],
  feeEstimator: FeeEstimator
): Promise<BuyResult> {
  const { buy } = config.execution;
  // CRITICAL: PumpPortal slippage is PERCENT, not basis points (bps/100 = percent)
  const slippagePct = buy.slippageBps / 100;
  const feeEstimate = await feeEstimator.getEstimate(config);
  const priorityFeeSol = feeEstimate.priorityFeeSol; // D-02: dynamic fee for PumpPortal
  log.debug({ feeSource: feeEstimate.source, priorityFeeSol }, 'Dynamic fee for PumpPortal buy'); // D-07

  log.debug({ mint, buyAmountSol: config.buyAmountSol, slippagePct }, 'PumpPortal buy initiated');

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
}
