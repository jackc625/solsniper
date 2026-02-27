/**
 * chunked-seller.ts — Splits token balance into 3 sequential tranches (EXE-06).
 *
 * Each tranche must confirm before the next is sent.
 * Partial recovery: if tranche N fails, continue to tranche N+1.
 * Last tranche gets remainder to prevent dust (avoids integer-division loss).
 *
 * Anti-patterns avoided:
 * - bigint throughout — token amounts can exceed Number.MAX_SAFE_INTEGER
 * - No "all or nothing": partial confirms are still capital recovered
 */
import { getAssociatedTokenAddress, getAccount } from '@solana/spl-token';
import type { Connection, Keypair } from '@solana/web3.js';
import { PublicKey } from '@solana/web3.js';
import { standardSell } from './standard-seller.js';
import type { TradingConfig } from '../../config/trading.js';
import { createModuleLogger } from '../../core/logger.js';

const log = createModuleLogger('chunked-seller');
const TRANCHES = 3;

/**
 * Splits the token balance into 3 equal tranches and sells sequentially (EXE-06).
 * Each tranche must confirm before the next is sent.
 * Last tranche gets the remainder to ensure total is exact (avoids dust from integer division).
 * Partial recovery is acceptable: if tranche N fails, continue to tranche N+1.
 * Returns the count of successfully confirmed tranches.
 */
export async function chunkedSell(
  mint: string,
  config: TradingConfig,
  wallet: Keypair,
  connections: Connection[]
): Promise<number> {  // returns count of confirmed tranches (0-3)
  const { sell } = config.execution;

  // Fetch exact token balance
  const mintPubkey = new PublicKey(mint);
  const ata = await getAssociatedTokenAddress(mintPubkey, wallet.publicKey);
  const accountInfo = await getAccount(connections[0], ata);
  const balance = accountInfo.amount;   // bigint — exact raw token units

  if (balance === 0n) {
    log.warn({ mint }, 'Chunked sell: zero token balance');
    return 0;
  }

  const tranche = balance / BigInt(TRANCHES);
  log.debug({ mint, balance: balance.toString(), tranche: tranche.toString() }, 'Chunked sell starting');

  let confirmedTranches = 0;

  for (let i = 0; i < TRANCHES; i++) {
    // Last tranche gets the remainder to prevent dust (EXE-06 anti-pattern note)
    const amount = i === TRANCHES - 1 ? balance - tranche * BigInt(TRANCHES - 1) : tranche;

    try {
      await standardSell(
        mint,
        amount,
        { slippageBps: sell.standardSlippageBps, feeMultiplier: sell.highFeeMultiplier },
        config,
        wallet,
        connections
      );
      confirmedTranches++;
      log.debug({ mint, tranche: i + 1, amount: amount.toString() }, 'Tranche confirmed');
    } catch (err) {
      // Partial recovery: continue to next tranche even if this one fails
      log.warn({ mint, tranche: i + 1, err }, 'Tranche failed — continuing to next');
    }
  }

  return confirmedTranches;
}
