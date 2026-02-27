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
import type { TradingConfig } from '../../config/trading.js';
import { createModuleLogger } from '../../core/logger.js';

const log = createModuleLogger('standard-seller');
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const JUPITER_QUOTE = 'https://api.jup.ag/swap/v1/quote';
const JUPITER_SWAP = 'https://api.jup.ag/swap/v1/swap';

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
): Promise<string> {  // returns signature on success, throws on failure
  const { slippageBps, feeMultiplier } = options;
  const maxPriorityFee = Math.floor(
    config.execution.buy.priorityFeeBaseLamports * feeMultiplier
  );

  log.debug({ mint, tokenAmount: tokenAmount.toString(), slippageBps, feeMultiplier }, 'Standard sell');

  // Fresh quote — token → SOL
  const quoteUrl = `${JUPITER_QUOTE}?inputMint=${mint}&outputMint=${SOL_MINT}` +
    `&amount=${tokenAmount.toString()}&slippageBps=${slippageBps}&maxAccounts=64`;
  const quoteResponse = await fetch(quoteUrl).then((r) => {
    if (!r.ok) throw new Error(`Jupiter quote HTTP ${r.status}`);
    return r.json();
  });

  const swapResponse = await fetch(JUPITER_SWAP, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
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
    }),
  }).then((r) => {
    if (!r.ok) throw new Error(`Jupiter swap HTTP ${r.status}`);
    return r.json() as Promise<{ swapTransaction: string }>;
  });

  const txBytes = Buffer.from(swapResponse.swapTransaction, 'base64');
  const tx = VersionedTransaction.deserialize(txBytes);
  const result = await broadcastAndConfirm(tx, wallet, connections);
  return result.signature;
}
