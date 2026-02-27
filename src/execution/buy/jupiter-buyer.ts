/**
 * jupiter-buyer.ts — Executes buy transactions via Jupiter Swap API.
 *
 * EXE-01: Jupiter Swap API for migrated tokens (raydium, pumpswap).
 * Response is base64-encoded JSON field — use Buffer.from(base64, 'base64').
 * Slippage is BASIS POINTS passed in quoteResponse; dynamicSlippage: false.
 */
import { VersionedTransaction } from '@solana/web3.js';
import type { Connection, Keypair } from '@solana/web3.js';
import { broadcastAndConfirm } from '../broadcaster.js';
import type { BuyResult } from '../../types/index.js';
import type { TradingConfig } from '../../config/trading.js';
import { createModuleLogger } from '../../core/logger.js';

const log = createModuleLogger('jupiter-buyer');
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const JUPITER_QUOTE = 'https://api.jup.ag/swap/v1/quote';
const JUPITER_SWAP = 'https://api.jup.ag/swap/v1/swap';

export async function jupiterBuy(
  mint: string,
  config: TradingConfig,
  wallet: Keypair,
  connections: Connection[]
): Promise<BuyResult> {
  const { buy } = config.execution;
  const lamports = Math.floor(config.buyAmountSol * 1e9);
  const maxPriorityFeeLamports = Math.floor(buy.priorityFeeBaseLamports * buy.priorityFeeMultiplier);

  log.debug({ mint, lamports, slippageBps: buy.slippageBps }, 'Jupiter buy initiated');

  // Step 1: Get quote
  const quoteUrl = `${JUPITER_QUOTE}?inputMint=${SOL_MINT}&outputMint=${mint}` +
    `&amount=${lamports}&slippageBps=${buy.slippageBps}&maxAccounts=64`;
  const quoteResponse = await fetch(quoteUrl).then((r) => {
    if (!r.ok) throw new Error(`Jupiter quote HTTP ${r.status}`);
    return r.json();
  });

  // Step 2: Build swap transaction
  const swapResponse = await fetch(JUPITER_SWAP, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userPublicKey: wallet.publicKey.toBase58(),
      quoteResponse,
      dynamicComputeUnitLimit: true,
      dynamicSlippage: false,   // We control slippage explicitly per step
      prioritizationFeeLamports: {
        priorityLevelWithMaxLamports: {
          priorityLevel: 'veryHigh',
          maxLamports: maxPriorityFeeLamports,
        },
      },
      wrapAndUnwrapSol: true,
    }),
  }).then((r) => {
    if (!r.ok) throw new Error(`Jupiter swap HTTP ${r.status}`);
    return r.json() as Promise<{ swapTransaction: string }>;
  });

  // Step 3: Deserialize — base64 JSON field (NOT raw bytes)
  const txBytes = Buffer.from(swapResponse.swapTransaction, 'base64');
  const tx = VersionedTransaction.deserialize(txBytes);

  const result = await broadcastAndConfirm(tx, wallet, connections);

  // Estimate token amount from quoteResponse.outAmount if present
  const amountTokens = quoteResponse?.outAmount
    ? Number(quoteResponse.outAmount)
    : undefined;

  log.info({ mint, signature: result.signature }, 'Jupiter buy confirmed');
  return { success: true, signature: result.signature, amountTokens };
}
