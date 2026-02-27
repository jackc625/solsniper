import { PublicKey } from '@solana/web3.js';
import type { Connection } from '@solana/web3.js';
import type { CheckResult } from '../../types/index.js';

/**
 * Known system/program addresses that should be excluded from holder concentration analysis.
 * These are not user wallets and holding tokens in these accounts doesn't indicate real concentration.
 */
const SYSTEM_ACCOUNTS = new Set([
  '11111111111111111111111111111111',              // System Program
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', // Token Program
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', // Token-2022
  '1nc1nerator11111111111111111111111111111111',   // Incinerator
  '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P', // Pump.fun program (PDA bonding curve)
]);

interface HolderConfig {
  top1SoftBlockThreshold: number;  // e.g. 0.25 = 25%
  top10SoftBlockThreshold: number; // e.g. 0.50 = 50%
}

/**
 * Analyzes token holder concentration to detect whale dominance and rug risk.
 *
 * Steps:
 * 1. Get 20 largest token accounts via getTokenLargestAccounts()
 * 2. Get total supply via getTokenSupply()
 * 3. Resolve each token account to its owner wallet via getParsedAccountInfo() (in parallel)
 * 4. Filter out known system/program accounts
 * 5. Compute top-1 and top-10 concentration against total supply
 *
 * Soft-block thresholds (configurable):
 * - top1 > 25%: pass=false
 * - top10 > 50%: pass=false
 *
 * Score = Math.max(0, 100 - Math.round(top10Pct * 100))
 * Pessimistic on error: pass=false, score=0
 *
 * Satisfies: SAF-06
 */
export async function checkHolderConcentration(
  mint: string,
  connection: Connection,
  config: HolderConfig,
): Promise<CheckResult> {
  try {
    const mintPubkey = new PublicKey(mint);

    // Fetch largest accounts and total supply concurrently
    const [largestAccountsResult, supplyResult] = await Promise.all([
      connection.getTokenLargestAccounts(mintPubkey),
      connection.getTokenSupply(mintPubkey),
    ]);

    const totalSupply = BigInt(supplyResult.value.amount);

    if (totalSupply === BigInt(0)) {
      return {
        pass: false,
        score: 0,
        source: 'holder_concentration',
        detail: 'zero total supply',
      };
    }

    // Resolve all token accounts to their owner wallets in parallel
    const accounts = largestAccountsResult.value;
    const ownerResolutions = await Promise.all(
      accounts.map(async (account) => {
        const accountInfo = await connection.getParsedAccountInfo(account.address);
        if (!accountInfo.value) return null;

        // Parsed SPL token account info contains the owner wallet address
        const data = accountInfo.value.data as {
          parsed?: { info?: { owner?: string } };
        };
        const owner = data?.parsed?.info?.owner;
        if (!owner) return null;

        return {
          owner,
          amount: BigInt(account.amount),
        };
      }),
    );

    // Filter out null resolutions and system accounts
    const userHolders = ownerResolutions.filter(
      (r): r is { owner: string; amount: bigint } =>
        r !== null && !SYSTEM_ACCOUNTS.has(r.owner),
    );

    // Sort by amount descending for top-N analysis
    userHolders.sort((a, b) => (a.amount > b.amount ? -1 : a.amount < b.amount ? 1 : 0));

    if (userHolders.length === 0) {
      // All accounts are system accounts — treat as suspicious
      return {
        pass: false,
        score: 0,
        source: 'holder_concentration',
        detail: 'no user holders found (all system accounts)',
      };
    }

    // Compute concentrations as percentages against total supply
    const top1Amount = userHolders[0]?.amount ?? BigInt(0);
    const top10Amount = userHolders
      .slice(0, 10)
      .reduce((sum, h) => sum + h.amount, BigInt(0));

    // Convert to float for threshold comparison
    // Using Number() is safe here as these are percentages (0-1 range)
    const top1Pct = Number(top1Amount) / Number(totalSupply);
    const top10Pct = Number(top10Amount) / Number(totalSupply);

    // Score: lower concentration = higher safety score
    const score = Math.max(0, 100 - Math.round(top10Pct * 100));

    // Soft block checks
    if (top1Pct > config.top1SoftBlockThreshold) {
      return {
        pass: false,
        score,
        source: 'holder_concentration',
        detail: `top1=${(top1Pct * 100).toFixed(1)}% exceeds threshold=${(config.top1SoftBlockThreshold * 100).toFixed(0)}%`,
      };
    }

    if (top10Pct > config.top10SoftBlockThreshold) {
      return {
        pass: false,
        score,
        source: 'holder_concentration',
        detail: `top10=${(top10Pct * 100).toFixed(1)}% exceeds threshold=${(config.top10SoftBlockThreshold * 100).toFixed(0)}%`,
      };
    }

    return {
      pass: true,
      score,
      source: 'holder_concentration',
      detail: `top1=${(top1Pct * 100).toFixed(1)}% top10=${(top10Pct * 100).toFixed(1)}%`,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      pass: false,
      score: 0,
      source: 'holder_concentration',
      detail: `error: ${message}`,
    };
  }
}
