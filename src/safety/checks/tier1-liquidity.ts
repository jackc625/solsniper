import { PublicKey } from '@solana/web3.js';
import type { Connection } from '@solana/web3.js';
import type { CheckResult, DetectionSource } from '../../types/index.js';

/**
 * Pump.fun program ID -- used to derive per-mint bonding curve PDAs.
 * Same constant as tier2-holder.ts; kept local to avoid cross-module dependency.
 */
const PUMP_FUN_PROGRAM_ID = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');

/**
 * IDL discriminator signature for pump.fun bonding curve accounts.
 * First 8 bytes of account data must match for valid bonding curve identification.
 */
const PUMP_CURVE_SIGNATURE = Buffer.from([0x17, 0xb7, 0xf8, 0x37, 0x60, 0xd8, 0xac, 0x60]);

/**
 * Minimum account data length required to read realSolReserves at offset 0x20.
 * 0x20 (offset) + 8 (u64 size) = 0x28 = 40 bytes.
 */
const BONDING_CURVE_MIN_LENGTH = 0x28;

/**
 * Checks liquidity depth for a given token based on its detection source.
 *
 * Source-aware routing:
 * - pumpportal: Reads SOL reserves from bonding curve PDA on-chain
 * - raydium: Reads SOL balance from pool quoteVault token account
 * - pumpswap: Neutral skip (vault layout unknown per Open Question 1)
 *
 * Hard gate: returns pass=false if SOL reserves are below configurable threshold.
 * Pessimistic on error: returns pass=false (same as tier1-authority pattern).
 *
 * Satisfies: SAF-12
 */
export async function checkLiquidityDepth(
  mint: string,
  connection: Connection,
  minLiquiditySol: number,
  source?: DetectionSource,
  poolQuoteVault?: string,
  vSolInBondingCurve?: number,
): Promise<CheckResult> {
  try {
    // PumpSwap: neutral skip — vault layout unknown
    if (source === 'pumpswap') {
      return {
        pass: true,
        source: 'liquidity_depth',
        detail: 'skipped for pumpswap (vault layout unknown)',
      };
    }

    // PumpPortal fast path: use vSolInBondingCurve from WebSocket event directly.
    // Avoids RPC race condition — bonding curve account may not be confirmed yet.
    if (source === 'pumpportal' && vSolInBondingCurve != null) {
      return {
        pass: vSolInBondingCurve >= minLiquiditySol,
        source: 'liquidity_depth',
        detail: `bonding_curve_vsol=${vSolInBondingCurve.toFixed(4)}`,
      };
    }

    // PumpPortal fallback: read bonding curve SOL reserves on-chain
    if (source === 'pumpportal') {
      return await checkPumpBondingCurve(mint, connection, minLiquiditySol);
    }

    // Raydium (or undefined source): read quoteVault balance
    if (!poolQuoteVault) {
      return {
        pass: true,
        source: 'liquidity_depth',
        detail: 'skipped (no pool vault data)',
      };
    }

    return await checkRaydiumQuoteVault(connection, minLiquiditySol, poolQuoteVault);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      pass: false,
      source: 'liquidity_depth',
      detail: `error: ${message}`,
    };
  }
}

/**
 * Reads realSolReserves from the pump.fun bonding curve PDA for the given mint.
 */
async function checkPumpBondingCurve(
  mint: string,
  connection: Connection,
  minLiquiditySol: number,
): Promise<CheckResult> {
  const mintPubkey = new PublicKey(mint);
  const [bondingCurvePda] = PublicKey.findProgramAddressSync(
    [Buffer.from('bonding-curve'), mintPubkey.toBuffer()],
    PUMP_FUN_PROGRAM_ID,
  );

  const accountInfo = await connection.getAccountInfo(bondingCurvePda);

  if (!accountInfo) {
    return {
      pass: false,
      source: 'liquidity_depth',
      detail: 'error: bonding curve account not found',
    };
  }

  const data = accountInfo.data as Buffer;

  // Validate minimum length
  if (data.length < BONDING_CURVE_MIN_LENGTH) {
    return {
      pass: false,
      source: 'liquidity_depth',
      detail: 'error: invalid bonding curve data (too short)',
    };
  }

  // Validate IDL signature (first 8 bytes)
  if (!data.subarray(0, 8).equals(PUMP_CURVE_SIGNATURE)) {
    return {
      pass: false,
      source: 'liquidity_depth',
      detail: 'error: invalid bonding curve signature',
    };
  }

  // Read realSolReserves at offset 0x20 as u64 LE (lamports)
  const realSolReserves = data.readBigUInt64LE(0x20);
  const solReserves = Number(realSolReserves) / 1e9;

  return {
    pass: solReserves >= minLiquiditySol,
    source: 'liquidity_depth',
    detail: `bonding_curve_sol=${solReserves.toFixed(4)}`,
  };
}

/**
 * Reads SOL balance from a Raydium V4 pool's quoteVault token account.
 */
async function checkRaydiumQuoteVault(
  connection: Connection,
  minLiquiditySol: number,
  poolQuoteVault: string,
): Promise<CheckResult> {
  const result = await connection.getTokenAccountBalance(new PublicKey(poolQuoteVault));
  const amount = result.value.uiAmount ?? 0;

  return {
    pass: amount >= minLiquiditySol,
    source: 'liquidity_depth',
    detail: `pool_sol=${amount.toFixed(4)}`,
  };
}
