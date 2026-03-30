/**
 * jito-seller.ts — Jito MEV-protected bundle sell (EXE-07).
 *
 * Bundle = [swap_tx, tip_tx] — tip is a SEPARATE transaction (not embedded).
 * Both transactions share the same blockhash.
 * Tip goes to a randomly-selected Jito tip account from the known static list.
 * Polls getBundleStatuses until landed or timeout (timeout managed by SellLadder).
 *
 * Anti-patterns avoided:
 * - Tip NOT embedded in swap tx (must be a separate tx per Jito protocol)
 * - Tip tx placed LAST in bundle array (swap first, tip last)
 * - Fresh quote on every call — never reuses across attempts
 */
import { VersionedTransaction, Transaction, SystemProgram, PublicKey, ComputeBudgetProgram, MessageV0 } from '@solana/web3.js';
import type { Connection, Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import { broadcastAndConfirm } from '../broadcaster.js';
import { jupiterClient } from '../jupiter-client.js';
import type { TradingConfig } from '../../config/trading.js';
import { getRuntimeConfig } from '../../config/trading.js';
import type { FeeEstimator } from '../../core/fee-estimator.js';
import type { SellOutcome } from '../../types/index.js';
import { createModuleLogger } from '../../core/logger.js';

const log = createModuleLogger('jito-seller');
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const JITO_BUNDLE_URL = 'https://mainnet.block-engine.jito.wtf/api/v1/bundles';

// Known Jito tip accounts (stable as of 2026; getTipAccounts is the authoritative source)
const JITO_TIP_ACCOUNTS = [
  '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5',
  'HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe',
  'Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY',
  'ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49',
  'DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh',
  'ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt',
  'DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL',
  '3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT',
];

/**
 * Executes a sell via Jito bundle for MEV protection (EXE-07).
 * Bundle = [sell_swap_tx, tip_tx] — tip transaction is separate (not embedded).
 * Polls getBundleStatuses for landing confirmation.
 * Returns swap transaction signature on success, throws on failure/timeout.
 */
export async function jitoSell(
  mint: string,
  tokenAmount: bigint,
  config: TradingConfig,
  wallet: Keypair,
  connections: Connection[],
  feeEstimator: FeeEstimator
): Promise<SellOutcome> {
  const { sell } = config.execution;
  const slippageBps = sell.standardSlippageBps;  // Jito uses standard slippage
  // Jito swap uses highFeeMultiplier on dynamic base, capped (D-05, D-22)
  const feeEstimate = await feeEstimator.getEstimate(config);
  const maxPriorityFee = Math.min(
    Math.floor(feeEstimate.maxLamports * sell.highFeeMultiplier),
    config.execution.buy.maxPriorityFeeCapLamports,
  );
  log.debug({ feeSource: feeEstimate.source, baseLamports: feeEstimate.maxLamports, maxPriorityFee }, 'Dynamic fee for Jito sell'); // D-07

  log.debug({ mint, tokenAmount: tokenAmount.toString() }, 'Jito bundle sell');

  // DRY RUN GATE 2: intercept before Jupiter API call and Jito bundle submission
  if (getRuntimeConfig().dryRun) {
    const signature = `DRY_RUN_JITO_${Date.now()}`;
    log.info(
      { dryRun: true, mint, tokenAmount: tokenAmount.toString(), signature },
      '[DRY RUN] jitoSell intercepted — bundle NOT submitted'
    );
    return { signature, solReceived: undefined };
  }

  // Step 1: Get Jupiter quote + swap transaction
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
      priorityLevelWithMaxLamports: { priorityLevel: 'veryHigh', maxLamports: maxPriorityFee },
    },
    wrapAndUnwrapSol: true,
  });

  // Step 2: Sign the swap transaction (initial sign for simulation)
  const swapTxBytes = Buffer.from(swapResponse.swapTransaction, 'base64');
  let finalSwapTx = VersionedTransaction.deserialize(swapTxBytes);
  const { blockhash, lastValidBlockHeight } = await connections[0].getLatestBlockhash('processed');
  finalSwapTx.message.recentBlockhash = blockhash;
  finalSwapTx.sign([wallet]);

  // D-11: Simulate CU, then replace Jupiter's CU limit instruction with tighter value
  try {
    const simulation = await connections[0].simulateTransaction(finalSwapTx, {
      replaceRecentBlockhash: true,
      sigVerify: false,
    });
    const cuConsumed = simulation.value.unitsConsumed;
    if (cuConsumed != null && cuConsumed > 0) {
      const tighterCU = Math.ceil(cuConsumed * 1.15); // 15% buffer per D-11
      log.debug({ cuConsumed, tighterCU }, 'CU simulation — replacing Jupiter CU limit');

      // Find Jupiter's existing ComputeBudgetProgram.setComputeUnitLimit instruction
      const message = finalSwapTx.message as MessageV0;
      const cbProgramId = ComputeBudgetProgram.programId;

      // Find the account index for ComputeBudgetProgram in the message's account keys
      const cbAccountIndex = message.staticAccountKeys.findIndex(
        (key) => key.equals(cbProgramId),
      );

      if (cbAccountIndex !== -1) {
        // setComputeUnitLimit instruction: program ID index matches cbAccountIndex,
        // instruction data starts with discriminator byte 0x02 (SetComputeUnitLimit)
        const cuLimitInstructionIndex = message.compiledInstructions.findIndex(
          (ix) => ix.programIdIndex === cbAccountIndex && ix.data[0] === 0x02,
        );

        if (cuLimitInstructionIndex !== -1) {
          // Build replacement instruction data: discriminator 0x02 + u32 LE units
          const newCUInstruction = ComputeBudgetProgram.setComputeUnitLimit({ units: tighterCU });
          const newData = newCUInstruction.data;

          // Rebuild the compiled instructions array with the replacement
          const updatedInstructions = [...message.compiledInstructions];
          updatedInstructions[cuLimitInstructionIndex] = {
            ...updatedInstructions[cuLimitInstructionIndex],
            data: newData,
          };

          // Rebuild MessageV0 with updated instructions
          const rebuiltMessage = new MessageV0({
            header: message.header,
            staticAccountKeys: message.staticAccountKeys,
            recentBlockhash: message.recentBlockhash,
            compiledInstructions: updatedInstructions,
            addressTableLookups: message.addressTableLookups,
          });

          // Rebuild VersionedTransaction and re-sign
          const rebuiltTx = new VersionedTransaction(rebuiltMessage);
          rebuiltTx.sign([wallet]);
          finalSwapTx = rebuiltTx;

          log.debug({ originalCU: 'jupiter-default', newCU: tighterCU }, 'CU limit instruction replaced');
        } else {
          log.debug('No setComputeUnitLimit instruction found in swap tx — skipping CU replacement');
        }
      } else {
        log.debug('ComputeBudgetProgram not found in swap tx account keys — skipping CU replacement');
      }
    }
  } catch (simErr) {
    log.debug({ simErr }, 'CU simulation failed — continuing with Jupiter CU limit');
  }

  const signedSwapBytes = finalSwapTx.serialize();

  // Step 3: Build tip transaction (separate tx, goes LAST in bundle)
  const tipAccount = JITO_TIP_ACCOUNTS[Math.floor(Math.random() * JITO_TIP_ACCOUNTS.length)];
  const tipTx = new Transaction();
  tipTx.add(
    SystemProgram.transfer({
      fromPubkey: wallet.publicKey,
      toPubkey: new PublicKey(tipAccount),
      lamports: sell.jitoTipLamports,
    })
  );
  tipTx.recentBlockhash = blockhash;
  tipTx.feePayer = wallet.publicKey;
  tipTx.sign(wallet);

  // Step 4: Send bundle [swap, tip] — tip MUST be last
  const encodedSwap = bs58.encode(signedSwapBytes);
  const encodedTip = bs58.encode(tipTx.serialize());

  const bundleResponse = await fetch(JITO_BUNDLE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'sendBundle',
      params: [[encodedSwap, encodedTip]],
    }),
  }).then((r) => r.json() as Promise<{ result?: string; error?: { message: string } }>);

  if (bundleResponse.error) {
    throw new Error(`Jito sendBundle error: ${bundleResponse.error.message}`);
  }

  const bundleId = bundleResponse.result;
  if (!bundleId) throw new Error('Jito sendBundle returned no bundle ID');

  log.debug({ bundleId }, 'Jito bundle submitted');

  // Step 5: Poll for bundle landing (timedout by SellLadder via Promise.race)
  // We poll in a loop; SellLadder wraps this in a timeout race.
  const status = await pollBundleStatus(bundleId);
  if (status !== 'Landed') {
    throw new Error(`Jito bundle did not land: status=${status}`);
  }

  // Compute the swap transaction signature (deterministic from tx bytes)
  // Since we signed the tx ourselves, the signature is the first element of tx.signatures
  const swapSignature = bs58.encode(finalSwapTx.signatures[0]);
  log.info({ bundleId, swapSignature }, 'Jito bundle landed');
  return { signature: swapSignature, solReceived };
}

/** @internal Exported for testing only. */
export async function pollBundleStatus(bundleId: string): Promise<'Landed' | 'Failed' | 'Pending'> {
  const INITIAL_DELAY_MS = 1000;
  const MAX_DELAY_MS = 5000;
  let delay = INITIAL_DELAY_MS;

  // Loop indefinitely -- SellLadder's Promise.race timeout is the outer bound.
  // The while(true) is safe because the SellLadder timeout (jitoTimeoutMs) will always fire.
  while (true) {
    await new Promise(resolve => setTimeout(resolve, delay));

    const response = await fetch(JITO_BUNDLE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getBundleStatuses',
        params: [[bundleId]],
      }),
    });
    const json = await response.json();
    const status = (json?.result?.value?.[0]?.confirmation_status as string) ?? 'Pending';

    if (status === 'Landed' || status === 'Failed') {
      return status as 'Landed' | 'Failed';
    }

    // Backoff: 1s -> 2s -> 4s -> 5s (capped)
    delay = Math.min(delay * 2, MAX_DELAY_MS);
  }
}
