/**
 * chunked-seller.ts -- Splits token balance into 3 sequential tranches (EXE-06).
 *
 * Each tranche must confirm before the next is sent.
 * Partial recovery: if tranche N fails, continue to tranche N+1.
 * Last tranche gets remainder to prevent dust (avoids integer-division loss).
 *
 * Anti-patterns avoided:
 * - bigint throughout -- token amounts can exceed Number.MAX_SAFE_INTEGER
 * - No "all or nothing": partial confirms are still capital recovered
 */
import { getAssociatedTokenAddress, getAccount, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import type { Connection, Keypair } from '@solana/web3.js';
import { PublicKey } from '@solana/web3.js';
import { standardSell } from './standard-seller.js';
import type { TradingConfig } from '../../config/trading.js';
import type { ChunkedSellOutcome } from '../../types/index.js';
import type { TradeStore } from '../../persistence/trade-store.js';
import { createModuleLogger } from '../../core/logger.js';

const log = createModuleLogger('chunked-seller');
const TRANCHES = 3;

/**
 * Splits the token balance into 3 equal tranches and sells sequentially (EXE-06).
 * Each tranche must confirm before the next is sent.
 * Last tranche gets the remainder to ensure total is exact (avoids dust from integer division).
 * Partial recovery is acceptable: if tranche N fails, continue to tranche N+1.
 * Returns the count of successfully confirmed tranches.
 *
 * @param tradeStore - Optional TradeStore for Token-2022 ATA derivation (reads tokenProgramId).
 *                     If not provided or trade not found, defaults to TOKEN_PROGRAM_ID.
 */
export async function chunkedSell(
  mint: string,
  config: TradingConfig,
  wallet: Keypair,
  connections: Connection[],
  tradeStore?: TradeStore
): Promise<ChunkedSellOutcome> {  // returns { confirmedTranches, solReceived }
  const { sell } = config.execution;

  // Determine token program ID for ATA derivation (Token-2022 vs legacy SPL)
  let tokenProgramId = TOKEN_PROGRAM_ID;
  if (tradeStore) {
    const trade = tradeStore.getTradeByMint(mint);
    if (trade?.tokenProgramId) {
      tokenProgramId = new PublicKey(trade.tokenProgramId);
    }
  }

  // Fetch exact token balance
  const mintPubkey = new PublicKey(mint);
  // Pass tokenProgramId to correctly derive ATA for Token-2022 tokens
  const ata = await getAssociatedTokenAddress(mintPubkey, wallet.publicKey, false, tokenProgramId);
  const accountInfo = await getAccount(connections[0], ata, undefined, tokenProgramId);
  const balance = accountInfo.amount;   // bigint -- exact raw token units

  if (balance === 0n) {
    log.warn({ mint }, 'Chunked sell: zero token balance');
    return { confirmedTranches: 0, solReceived: undefined };
  }

  const tranche = balance / BigInt(TRANCHES);
  log.debug({ mint, balance: balance.toString(), tranche: tranche.toString() }, 'Chunked sell starting');

  let confirmedTranches = 0;
  let totalSolReceived = 0;

  for (let i = 0; i < TRANCHES; i++) {
    // Last tranche gets the remainder to prevent dust (EXE-06 anti-pattern note)
    const amount = i === TRANCHES - 1 ? balance - tranche * BigInt(TRANCHES - 1) : tranche;

    try {
      const outcome = await standardSell(
        mint,
        amount,
        { slippageBps: sell.standardSlippageBps, feeMultiplier: sell.highFeeMultiplier },
        config,
        wallet,
        connections
      );
      confirmedTranches++;
      if (outcome.solReceived != null) totalSolReceived += outcome.solReceived;
      log.debug({ mint, tranche: i + 1, amount: amount.toString(), solReceived: outcome.solReceived }, 'Tranche confirmed');
    } catch (err) {
      // Partial recovery: continue to next tranche even if this one fails
      log.warn({ mint, tranche: i + 1, err }, 'Tranche failed -- continuing to next');
    }
  }

  return { confirmedTranches, solReceived: totalSolReceived > 0 ? totalSolReceived : undefined };
}
