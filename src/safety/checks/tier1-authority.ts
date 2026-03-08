import {
  unpackMint,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TokenAccountNotFoundError,
} from '@solana/spl-token';
import { PublicKey } from '@solana/web3.js';
import type { Connection } from '@solana/web3.js';
import type { CheckResult } from '../../types/index.js';

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 100;

/**
 * Returns true if the error signals that the account was not found.
 *
 * Uses instanceof check against TokenAccountNotFoundError (not string matching).
 * TokenAccountNotFoundError has an empty .message -- string matching is unreliable.
 */
function isAccountNotFoundError(err: unknown): boolean {
  return err instanceof TokenAccountNotFoundError;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Checks mint authority and freeze authority for a given SPL or Token-2022 token mint.
 *
 * Uses Pattern A (getAccountInfo + unpackMint with detected programId):
 *   1. getAccountInfo() to get raw account data and detect owner program
 *   2. info.owner determines whether it's Token-2022 or legacy SPL
 *   3. unpackMint(pubkey, info, programId) to parse authority fields
 *
 * This pattern works for both TOKEN_PROGRAM_ID and TOKEN_2022_PROGRAM_ID mints,
 * unlike getMint() which defaults to TOKEN_PROGRAM_ID and silently misparses Token-2022 mints.
 *
 * Returns [mintAuthority CheckResult, freezeAuthority CheckResult, detected programId].
 * The detected programId is passed to TradeStore for downstream use (ATA lookup, etc.)
 *
 * Pessimistic failure: if detection fails (account not found, RPC error),
 * both checks return pass=false and a default TOKEN_PROGRAM_ID is returned.
 * Includes 1-2 retries for account-not-found (race condition on new mints).
 *
 * Satisfies: SAF-01 (mint authority), SAF-02 (freeze authority)
 */
export async function checkAuthorities(
  mint: string,
  connection: Connection,
): Promise<[CheckResult, CheckResult, PublicKey]> {
  let lastError: unknown;
  const mintPubkey = new PublicKey(mint);

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const info = await connection.getAccountInfo(mintPubkey);

      if (!info) {
        // Account not found -- throw TokenAccountNotFoundError for instanceof retry check
        throw new TokenAccountNotFoundError();
      }

      // Detect program by owner -- determines how to parse the mint account
      const programId = info.owner.equals(TOKEN_2022_PROGRAM_ID)
        ? TOKEN_2022_PROGRAM_ID
        : TOKEN_PROGRAM_ID;

      const mintInfo = unpackMint(mintPubkey, info, programId);

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

      return [mintAuthCheck, freezeAuthCheck, programId];
    } catch (err: unknown) {
      lastError = err;

      // Only retry on account-not-found errors (race condition on new mints).
      // Non-ANFE errors (invalid account owner, RPC failures) are not retried.
      if (!isAccountNotFoundError(err) || attempt >= MAX_RETRIES) {
        break;
      }

      await sleep(RETRY_DELAY_MS);
    }
  }

  // Pessimistic: any error = hard block. Conservative default programId on error.
  const errorMessage = lastError instanceof Error ? lastError.message : String(lastError);
  const errorDetail = `error: ${errorMessage || 'account not found'}`;

  return [
    { pass: false, source: 'mint_authority', detail: errorDetail },
    { pass: false, source: 'freeze_authority', detail: errorDetail },
    TOKEN_PROGRAM_ID,
  ];
}
