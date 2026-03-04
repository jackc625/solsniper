/**
 * standard-seller.ts — Jupiter sell for STANDARD and HIGH_FEE steps.
 *
 * Handles two reuse cases:
 * - STANDARD: slippageBps=config.sell.standardSlippageBps, feeMultiplier=1
 * - HIGH_FEE: same slippage, feeMultiplier=config.sell.highFeeMultiplier
 *
 * Anti-patterns avoided:
 * - dynamicSlippage: false (we control slippage explicitly per step)
 * - Fresh quote on every call — never reuses a cached quote across attempts
 * - bigint throughout for token amounts (avoids Number.MAX_SAFE_INTEGER overflow)
 */
import { VersionedTransaction } from '@solana/web3.js';
import type { Connection, Keypair } from '@solana/web3.js';
import { broadcastAndConfirm } from '../broadcaster.js';
import { jupiterClient } from '../jupiter-client.js';
import type { TradingConfig } from '../../config/trading.js';
import type { SellOutcome } from '../../types/index.js';
import { createModuleLogger } from '../../core/logger.js';

const log = createModuleLogger('standard-seller');
const SOL_MINT = 'So11111111111111111111111111111111111111112';

export interface StandardSellOptions {
  slippageBps: number;
  feeMultiplier: number;
}

/**
 * Executes a Jupiter sell for the given token mint and amount.
 * Used for STANDARD step (multiplier=1) and HIGH_FEE step (multiplier=N).
 * Always fetches fresh quote — never reuses a cached quote across retry attempts.
 */
export async function standardSell(
  mint: string,
  tokenAmount: bigint,     // raw token units (u64)
  options: StandardSellOptions,
  config: TradingConfig,
  wallet: Keypair,
  connections: Connection[]
): Promise<SellOutcome> {  // returns SellOutcome { signature, solReceived } on success, throws on failure
  const { slippageBps, feeMultiplier } = options;
  const maxPriorityFee = Math.floor(
    config.execution.buy.priorityFeeBaseLamports * feeMultiplier
  );

  log.debug({ mint, tokenAmount: tokenAmount.toString(), slippageBps, feeMultiplier }, 'Standard sell');

  // Fresh quote — token → SOL
  const params = new URLSearchParams({
    inputMint: mint,
    outputMint: SOL_MINT,
    amount: tokenAmount.toString(),
    slippageBps: String(slippageBps),
    maxAccounts: '64',
  });
  const quoteResponse = await jupiterClient.quote(params);
  // Extract solReceived from quote outAmount — same pattern as PositionManager.getPositionValueSol()
  const solReceived = Number((quoteResponse as { outAmount: string }).outAmount) / 1e9;

  const swapResponse = await jupiterClient.swap({
    userPublicKey: wallet.publicKey.toBase58(),
    quoteResponse,
    dynamicComputeUnitLimit: true,
    dynamicSlippage: false,
    prioritizationFeeLamports: {
      priorityLevelWithMaxLamports: {
        priorityLevel: 'veryHigh',
        maxLamports: maxPriorityFee,
      },
    },
    wrapAndUnwrapSol: true,
  });

  const txBytes = Buffer.from(swapResponse.swapTransaction, 'base64');
  const tx = VersionedTransaction.deserialize(txBytes);
  const result = await broadcastAndConfirm(tx, wallet, connections);
  return { signature: result.signature, solReceived };
}
