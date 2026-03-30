import type { Connection, PublicKey } from '@solana/web3.js';
import { createModuleLogger } from './logger.js';

const log = createModuleLogger('balance-guard');

export interface BalanceCheckResult {
  sufficient: boolean;
  balanceSol: number;
  thresholdSol: number;
}

export class BalanceGuard {
  private cache: { lamports: number; expiry: number } | null = null;
  private readonly ttlMs: number;

  constructor(ttlMs = 5000) {
    this.ttlMs = ttlMs;
  }

  async check(
    connection: Connection,
    wallet: PublicKey,
    buyAmountSol: number,
    minBufferSol: number,
  ): Promise<BalanceCheckResult> {
    const now = Date.now();

    let lamports: number;
    if (this.cache && now < this.cache.expiry) {
      lamports = this.cache.lamports;
    } else {
      lamports = await connection.getBalance(wallet, 'processed');
      this.cache = { lamports, expiry: now + this.ttlMs };
    }

    const balanceSol = lamports / 1e9;
    const thresholdSol = buyAmountSol + minBufferSol;

    if (balanceSol < thresholdSol) {
      log.warn(
        { balanceSol: balanceSol.toFixed(4), thresholdSol: thresholdSol.toFixed(4) },
        'Wallet balance below buy threshold',
      );
    }

    return { sufficient: balanceSol >= thresholdSol, balanceSol, thresholdSol };
  }

  /** Invalidate cached balance (call after successful buy to force fresh check). */
  invalidateCache(): void {
    this.cache = null;
  }
}
