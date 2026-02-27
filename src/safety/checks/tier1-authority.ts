import { getMint } from '@solana/spl-token';
import { PublicKey } from '@solana/web3.js';
import type { Connection } from '@solana/web3.js';
import type { CheckResult } from '../../types/index.js';

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 100;

function isAccountNotFoundError(err: unknown): boolean {
  const message = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  return message.includes('could not find') || message.includes('account not found');
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Checks mint authority and freeze authority for a given SPL token mint.
 *
 * Uses a single getMint() call (1 RPC round-trip) to retrieve both authority fields.
 * Returns two CheckResult objects: [mintAuthority, freezeAuthority].
 *
 * Pessimistic failure: if getMint() throws (account not found, invalid address, RPC error),
 * both checks return pass=false. Includes 1-2 retries for account-not-found errors to
 * handle the race condition where a new mint hasn't propagated to the RPC node yet.
 *
 * Satisfies: SAF-01 (mint authority), SAF-02 (freeze authority)
 */
export async function checkAuthorities(
  mint: string,
  connection: Connection,
): Promise<[CheckResult, CheckResult]> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const mintInfo = await getMint(connection, new PublicKey(mint));

      const mintAuthCheck: CheckResult = {
        pass: mintInfo.mintAuthority === null,
        source: 'mint_authority',
        detail:
          mintInfo.mintAuthority !== null
            ? `mint authority: ${mintInfo.mintAuthority.toBase58()}`
            : 'revoked',
      };

      const freezeAuthCheck: CheckResult = {
        pass: mintInfo.freezeAuthority === null,
        source: 'freeze_authority',
        detail:
          mintInfo.freezeAuthority !== null
            ? `freeze authority: ${mintInfo.freezeAuthority.toBase58()}`
            : 'revoked',
      };

      return [mintAuthCheck, freezeAuthCheck];
    } catch (err: unknown) {
      lastError = err;

      // Only retry on account-not-found errors (race condition on new mints)
      if (!isAccountNotFoundError(err) || attempt >= MAX_RETRIES) {
        break;
      }

      await sleep(RETRY_DELAY_MS);
    }
  }

  // Pessimistic: any error = hard block
  const errorMessage = lastError instanceof Error ? lastError.message : String(lastError);
  const errorDetail = `error: ${errorMessage}`;

  return [
    { pass: false, source: 'mint_authority', detail: errorDetail },
    { pass: false, source: 'freeze_authority', detail: errorDetail },
  ];
}
