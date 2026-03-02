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
import { createModuleLogger } from '../../core/logger.js';

const log = createModuleLogger('pump-portal-seller');
const PUMPPORTAL_API = 'https://pumpportal.fun/api/trade-local';

/**
 * Sells tokens via PumpPortal trade-local API.
 *
 * @param mint         - Token mint address (base58)
 * @param tokenAmount  - Exact token amount to sell (raw units as bigint)
 * @param config       - Trading config (slippage from sell.standardSlippageBps)
 * @param wallet       - Signer keypair
 * @param connections  - RPC connections for broadcast
 * @returns Transaction signature string on success
 * @throws On HTTP error or broadcast failure
 */
export async function pumpPortalSell(
  mint: string,
  tokenAmount: bigint,
  config: TradingConfig,
  wallet: Keypair,
  connections: Connection[]
): Promise<string> {
  const { sell } = config.execution;
  // CRITICAL: PumpPortal slippage is PERCENT, not basis points (bps/100 = percent)
  const slippagePct = sell.standardSlippageBps / 100;
  const priorityFeeSol = config.execution.buy.priorityFeeBaseLamports / 1e9;

  log.debug({ mint, tokenAmount: tokenAmount.toString(), slippagePct }, 'PumpPortal sell initiated');

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

  if (!response.ok) {
    throw new Error(`PumpPortal sell HTTP ${response.status}`);
  }

  // Raw bytes response — NOT JSON. Use arrayBuffer().
  const txBytes = new Uint8Array(await response.arrayBuffer());
  const tx = VersionedTransaction.deserialize(txBytes);
  const result = await broadcastAndConfirm(tx, wallet, connections);

  log.info({ mint, signature: result.signature }, 'PumpPortal sell confirmed');
  return result.signature;
}
