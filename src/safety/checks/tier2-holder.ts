import { PublicKey } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID, unpackMint } from '@solana/spl-token';
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
]);

// Pump.fun program ID — used to derive per-mint bonding curve PDAs, not a static account.
// The bonding curve PDA is NOT a fixed address; it must be derived per-mint via findProgramAddressSync.
const PUMP_FUN_PROGRAM_ID = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');

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
  programId?: PublicKey,
  source?: string,
): Promise<CheckResult> {
  try {
    const mintPubkey = new PublicKey(mint);
    const isToken2022 = programId?.equals(TOKEN_2022_PROGRAM_ID) ?? false;

    // Derive per-mint bonding curve PDA — CPU-only, zero RPC cost.
    // Universal exclusion: applies regardless of source, handles migration edge cases.
    const [bondingCurvePda] = PublicKey.findProgramAddressSync(
      [Buffer.from('bonding-curve'), mintPubkey.toBuffer()],
      PUMP_FUN_PROGRAM_ID,
    );
    const bondingCurvePdaStr = bondingCurvePda.toBase58();

    let userHolders: { owner: string; amount: bigint }[];
    let totalSupply: bigint;

    if (isToken2022) {
      // Token-2022: getTokenLargestAccounts doesn't support Token-2022 on most RPC providers.
      // Use getParsedProgramAccounts to fetch all token accounts for this mint,
      // and getAccountInfo + unpackMint for total supply.
      const [tokenAccounts, mintAccountInfo] = await Promise.all([
        connection.getParsedProgramAccounts(TOKEN_2022_PROGRAM_ID, {
          filters: [{ memcmp: { offset: 0, bytes: mint } }],
        }),
        connection.getAccountInfo(mintPubkey),
      ]);

      if (!mintAccountInfo) {
        return {
          pass: false,
          score: 0,
          source: 'holder_concentration',
          detail: 'error: mint account not found',
        };
      }

      const mintData = unpackMint(mintPubkey, mintAccountInfo, TOKEN_2022_PROGRAM_ID);
      totalSupply = mintData.supply;

      // Extract owner + amount from parsed token accounts, sort descending, take top 20
      type ParsedData = {
        parsed?: { info?: { owner?: string; tokenAmount?: { amount?: string } } };
      };

      const allHolders = tokenAccounts
        .map((a) => {
          const data = a.account.data as ParsedData;
          const owner = data?.parsed?.info?.owner;
          const amount = data?.parsed?.info?.tokenAmount?.amount;
          if (!owner || !amount) return null;
          return { owner, amount: BigInt(amount) };
        })
        .filter((h): h is { owner: string; amount: bigint } => h !== null)
        .sort((a, b) => (a.amount > b.amount ? -1 : a.amount < b.amount ? 1 : 0))
        .slice(0, 20);

      userHolders = allHolders.filter(
        (h) => !SYSTEM_ACCOUNTS.has(h.owner) && h.owner !== bondingCurvePdaStr,
      );
    } else {
      // Standard Token: use optimized getTokenLargestAccounts + getTokenSupply
      const [largestAccountsResult, supplyResult] = await Promise.all([
        connection.getTokenLargestAccounts(mintPubkey),
        connection.getTokenSupply(mintPubkey),
      ]);

      totalSupply = BigInt(supplyResult.value.amount);

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

      userHolders = ownerResolutions.filter(
        (r): r is { owner: string; amount: bigint } =>
          r !== null && !SYSTEM_ACCOUNTS.has(r.owner) && r.owner !== bondingCurvePdaStr,
      );
      userHolders.sort((a, b) => (a.amount > b.amount ? -1 : a.amount < b.amount ? 1 : 0));
    }

    if (userHolders.length === 0) {
      if (source === 'pumpportal') {
        // Pump.fun tokens in the bonding curve phase have no user holders yet — expected.
        // Return pass=true with score=50 (neutral) rather than hard-blocking a valid token.
        return {
          pass: true,
          score: 50,
          source: 'holder_concentration',
          detail: 'insufficient data: no user holders found (bonding curve or system accounts only)',
        };
      }
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
