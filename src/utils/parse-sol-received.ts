/**
 * parse-sol-received.ts -- Parses actual SOL received from a confirmed on-chain transaction.
 *
 * Used by:
 * - pump-portal-seller.ts: PumpPortal has no Jupiter quote, must parse on-chain
 * - sell-ladder.ts: EMERGENCY step (49% slippage) where Jupiter quote is unreliable
 *
 * Method: Compares wallet's pre/post SOL balance delta from the transaction metadata.
 */
import type { Connection, PublicKey } from '@solana/web3.js';
import { createModuleLogger } from '../core/logger.js';

const log = createModuleLogger('parse-sol-received');

/**
 * Parses the actual SOL received by the wallet from a confirmed transaction.
 * Returns the SOL balance increase (post - pre) or undefined if parse fails.
 *
 * @param signature     - Confirmed transaction signature
 * @param walletPubKey  - Wallet public key to find in account keys
 * @param connection    - RPC connection for getTransaction
 * @returns SOL received (positive delta) or undefined on any failure
 */
export async function parseSolReceived(
  signature: string,
  walletPubKey: PublicKey,
  connection: Connection
): Promise<number | undefined> {
  try {
    const tx = await connection.getTransaction(signature, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0,
    });
    if (!tx || !tx.meta) {
      log.warn({ signature }, 'parseSolReceived: no transaction or meta found');
      return undefined;
    }

    const accountKeys = tx.transaction.message.getAccountKeys().staticAccountKeys;
    const walletIndex = accountKeys.findIndex(k => k.equals(walletPubKey));
    if (walletIndex === -1) {
      log.warn({ signature }, 'parseSolReceived: wallet not found in account keys');
      return undefined;
    }

    const pre = tx.meta.preBalances[walletIndex];
    const post = tx.meta.postBalances[walletIndex];
    if (pre == null || post == null) return undefined;

    const delta = (post - pre) / 1e9;
    return delta > 0 ? delta : undefined;
  } catch (err) {
    log.warn({ signature, err }, 'parseSolReceived: failed to parse transaction');
    return undefined;
  }
}
