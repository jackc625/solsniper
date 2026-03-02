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
import { jupiterClient } from '../jupiter-client.js';
import type { BuyResult } from '../../types/index.js';
import type { TradingConfig } from '../../config/trading.js';
import { createModuleLogger } from '../../core/logger.js';

const log = createModuleLogger('jupiter-buyer');
const SOL_MINT = 'So11111111111111111111111111111111111111112';

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
  const params = new URLSearchParams({
    inputMint: SOL_MINT,
    outputMint: mint,
    amount: String(lamports),
    slippageBps: String(buy.slippageBps),
    maxAccounts: '64',
  });
  const quoteResponse = await jupiterClient.quote(params);

  // Step 2: Build swap transaction
  const swapResponse = await jupiterClient.swap({
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
  });

  // Step 3: Deserialize — base64 JSON field (NOT raw bytes)
  const txBytes = Buffer.from(swapResponse.swapTransaction, 'base64');
  const tx = VersionedTransaction.deserialize(txBytes);

  const result = await broadcastAndConfirm(tx, wallet, connections);

  // Estimate token amount from quoteResponse.outAmount if present
  const qr = quoteResponse as Record<string, unknown>;
  const amountTokens = qr?.outAmount
    ? Number(qr.outAmount)
    : undefined;

  log.info({ mint, signature: result.signature }, 'Jupiter buy confirmed');
  return { success: true, signature: result.signature, amountTokens };
}
