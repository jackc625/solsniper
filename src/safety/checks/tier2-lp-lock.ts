import { PublicKey } from '@solana/web3.js';
import type { Connection } from '@solana/web3.js';
import type { CheckResult, DetectionSource } from '../../types/index.js';

/**
 * Known burn addresses -- LP tokens sent here are considered permanently locked.
 */
const KNOWN_BURN_ADDRESSES = new Set([
  '1nc1nerator11111111111111111111111111111111',
]);

/**
 * Known LP locker program addresses -- LP tokens held by these are considered locked.
 */
const KNOWN_LOCKER_PROGRAMS = new Set([
  'GsSCS3vPWrtJ5Y9aEVVT65fmrex5P5RGHXdZvsdbWgfo',  // UNCX Raydium AMM LP Locker
]);

/**
 * RugCheck data subset needed for LP lock scoring.
 */
interface RugCheckLpData {
  lpLockedPct: number;
  risks: Array<{ name: string }>;
}

/**
 * Scores LP lock/burn status as a rug risk factor.
 *
 * Primary path: Uses RugCheck API data (lpLockedPct) when available.
 * Fallback path: On-chain check for LP tokens at known burn/locker addresses.
 *
 * Source-aware behavior:
 * - pumpportal: Neutral skip (bonding curve phase, no LP to lock) per D-23
 * - raydium/pumpswap/undefined: Run LP lock check
 *
 * This is a scoring signal (pass is always true) -- penalty applied by pipeline orchestrator.
 *
 * Satisfies: SAF-13
 */
export async function checkLpLock(
  mint: string,
  connection: Connection,
  rugCheckData: RugCheckLpData | null,
  source?: DetectionSource,
  signal?: AbortSignal,
  lpMint?: string,
): Promise<CheckResult> {
  try {
    // Pumpportal: neutral skip -- tokens in bonding curve phase have no LP
    if (source === 'pumpportal') {
      return {
        pass: true,
        score: 50,
        source: 'lp_lock',
        detail: 'skipped for pumpportal (bonding curve phase)',
      };
    }

    // Primary path: RugCheck data available
    if (rugCheckData !== null) {
      return scoreFromRugCheck(rugCheckData);
    }

    // Fallback: on-chain LP burn/locker check
    if (!lpMint) {
      return {
        pass: true,
        score: 0,
        source: 'lp_lock',
        detail: 'no LP mint data for fallback check',
      };
    }

    return await checkOnChainLpLock(connection, lpMint);
  } catch (err: unknown) {
    return {
      pass: true,
      score: 0,
      source: 'lp_lock',
      detail: 'error: ' + (err instanceof Error ? err.message : String(err)),
    };
  }
}

/**
 * Scores LP lock from RugCheck lpLockedPct data.
 *
 * Pitfall 4: lpLockedPct=0 with risks means confirmed unlocked (score=0),
 * but lpLockedPct=0 with no risks means data unavailable (score=50 neutral).
 */
function scoreFromRugCheck(data: RugCheckLpData): CheckResult {
  const { lpLockedPct, risks } = data;

  let score: number;

  if (lpLockedPct >= 90) {
    score = 100;
  } else if (lpLockedPct > 0) {
    score = Math.round(lpLockedPct);
  } else {
    // lpLockedPct === 0
    score = risks.length > 0 ? 0 : 50;
  }

  return {
    pass: true,
    score,
    source: 'lp_lock',
    detail: `rugcheck lpLockedPct=${lpLockedPct}`,
  };
}

/**
 * On-chain fallback: checks if the largest holder of the LP mint token
 * is a known burn address or locker program.
 */
async function checkOnChainLpLock(
  connection: Connection,
  lpMint: string,
): Promise<CheckResult> {
  const lpMintPubkey = new PublicKey(lpMint);
  const largestAccounts = await connection.getTokenLargestAccounts(lpMintPubkey);

  if (!largestAccounts.value.length) {
    return {
      pass: true,
      score: 0,
      source: 'lp_lock',
      detail: 'no LP token holders found',
    };
  }

  // Check the largest holder's owner address
  const largestAccount = largestAccounts.value[0];
  const accountInfo = await connection.getParsedAccountInfo(largestAccount.address);

  if (!accountInfo.value) {
    return {
      pass: true,
      score: 0,
      source: 'lp_lock',
      detail: 'could not resolve LP holder account',
    };
  }

  const data = accountInfo.value.data as {
    parsed?: { info?: { owner?: string } };
  };
  const owner = data?.parsed?.info?.owner;

  if (!owner) {
    return {
      pass: true,
      score: 0,
      source: 'lp_lock',
      detail: 'could not determine LP holder owner',
    };
  }

  // Check if owner is a known burn/locker address
  if (KNOWN_BURN_ADDRESSES.has(owner) || KNOWN_LOCKER_PROGRAMS.has(owner)) {
    return {
      pass: true,
      score: 100,
      source: 'lp_lock',
      detail: `on-chain: LP held by ${KNOWN_BURN_ADDRESSES.has(owner) ? 'burn address' : 'locker program'} (${owner})`,
    };
  }

  return {
    pass: true,
    score: 0,
    source: 'lp_lock',
    detail: `on-chain: LP held by unknown address (${owner})`,
  };
}
