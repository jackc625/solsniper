/**
 * broadcaster.ts — Blockhash-last signing + multi-RPC parallel broadcast + confirmation.
 *
 * EXE-04: Blockhash fetched as absolute last step before tx.sign().
 * EXE-05: Fire to all RPC connections simultaneously via Promise.allSettled.
 * EXE-08: Caller always passes a freshly-deserialized tx — blockhash overwritten here.
 *
 * Anti-patterns avoided:
 * - NO pre-fetched blockhash passed in (would violate EXE-04)
 * - NO sequential RPC send (would add latency)
 */
import { type VersionedTransaction, type Connection, type Keypair } from '@solana/web3.js';
import type { BroadcastResult } from '../types/index.js';
import { createModuleLogger } from '../core/logger.js';
import { getRuntimeConfig } from '../config/trading.js';

const log = createModuleLogger('broadcaster');

/**
 * Error class with metadata indicating whether the transaction landed on-chain.
 * - landed: true  → tx confirmed but failed (slippage, etc.) — do NOT retry
 * - landed: false → tx never confirmed (timeout/expiry) — safe to retry
 */
export class BroadcastError extends Error {
  public readonly signature: string | undefined;
  public readonly landed: boolean;

  constructor(message: string, signature: string | undefined, landed: boolean) {
    super(message);
    this.name = 'BroadcastError';
    this.signature = signature;
    this.landed = landed;
  }
}

export interface BroadcastOptions {
  /** Override maxRetries passed to sendRawTransaction (default: 0). */
  sendMaxRetries?: number;
  /** Timeout (ms) for confirmTransaction — resolves with timeout error if exceeded. */
  confirmTimeoutMs?: number;
}

/**
 * Signs and broadcasts a VersionedTransaction to all provided RPC connections in parallel.
 * Fetches blockhash immediately before signing (EXE-04).
 * Returns on the first fulfilled signature (all connections return the same signature).
 * Throws BroadcastError if all RPC connections reject or confirmation fails.
 */
export async function broadcastAndConfirm(
  tx: VersionedTransaction,
  wallet: Keypair,
  connections: Connection[],
  options: BroadcastOptions = {}
): Promise<BroadcastResult> {
  if (connections.length === 0) {
    throw new Error('broadcastAndConfirm: no RPC connections provided');
  }

  // DRY RUN GATE 1: intercept before signing/broadcasting
  if (getRuntimeConfig().dryRun) {
    const { blockhash, lastValidBlockHeight } = await connections[0].getLatestBlockhash('processed');
    const signature = `DRY_RUN_${Date.now()}`;
    log.info(
      { dryRun: true, signature, blockhash },
      '[DRY RUN] broadcastAndConfirm intercepted — tx NOT signed or broadcast'
    );
    return { signature, blockhash, lastValidBlockHeight };
  }

  const { sendMaxRetries = 0, confirmTimeoutMs } = options;

  // EXE-04: Fetch blockhash as the ABSOLUTE LAST step before signing.
  // Use 'processed' commitment for a fresher blockhash (faster than 'confirmed').
  const { blockhash, lastValidBlockHeight } = await connections[0].getLatestBlockhash('processed');
  tx.message.recentBlockhash = blockhash;
  tx.sign([wallet]);

  const serialized = tx.serialize();

  // EXE-05: Send to ALL connections simultaneously.
  // skipPreflight: true — Jupiter has already simulated; skip for speed.
  const results = await Promise.allSettled(
    connections.map((conn) =>
      conn.sendRawTransaction(serialized, {
        skipPreflight: true,
        maxRetries: sendMaxRetries,
      })
    )
  );

  const success = results.find((r) => r.status === 'fulfilled');
  if (!success || success.status !== 'fulfilled') {
    const errors = results
      .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      .map((r) => String(r.reason))
      .join('; ');
    throw new BroadcastError(`All RPC connections rejected transaction: ${errors}`, undefined, false);
  }

  const signature = success.value;
  log.debug({ signature, blockhash }, 'Transaction broadcast to all RPCs');

  // Confirm using the first connection (all sigs are identical — any connection works).
  const confirmPromise = connections[0].confirmTransaction(
    { signature, blockhash, lastValidBlockHeight },
    'confirmed'
  );

  let confirmation: { value: { err: unknown } };
  if (confirmTimeoutMs !== undefined) {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new BroadcastError(
        `Confirmation timed out after ${confirmTimeoutMs}ms`,
        signature,
        false
      )), confirmTimeoutMs)
    );
    confirmation = await Promise.race([confirmPromise, timeout]);
  } else {
    confirmation = await confirmPromise;
  }

  if (confirmation.value.err !== null) {
    throw new BroadcastError(
      `Transaction confirmed but failed on-chain: ${JSON.stringify(confirmation.value.err)}`,
      signature,
      true
    );
  }

  log.info({ signature }, 'Transaction confirmed');
  return { signature, blockhash, lastValidBlockHeight };
}

const RETRY_ATTEMPTS = 3;
const CONFIRM_TIMEOUT_MS = 15_000;
const SEND_MAX_RETRIES = 2;

/**
 * Checks whether any prior attempt signatures have landed on-chain.
 * Returns the first confirmed signature, or undefined if none landed.
 */
async function checkPriorSignatures(
  signatures: string[],
  connection: Connection
): Promise<string | undefined> {
  if (signatures.length === 0) return undefined;

  const statuses = await connection.getSignatureStatuses(signatures);
  for (let i = 0; i < signatures.length; i++) {
    const status = statuses.value[i];
    if (status != null && status.confirmationStatus != null) {
      return signatures[i];
    }
  }
  return undefined;
}

/**
 * Buy-path retry wrapper. Makes up to RETRY_ATTEMPTS attempts with fresh blockhashes
 * and per-attempt confirmation timeouts. Between retries, checks whether prior attempt
 * signatures landed late (prevents double-buy).
 *
 * On BroadcastError { landed: true } → rethrows immediately (on-chain failure, no retry).
 * On timeout/expiry → logs warning, retries with fresh blockhash.
 */
export async function broadcastWithRetry(
  tx: VersionedTransaction,
  wallet: Keypair,
  connections: Connection[]
): Promise<BroadcastResult> {
  const priorSignatures: string[] = [];
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
    // Between retries, check if a prior attempt landed late
    if (priorSignatures.length > 0) {
      const landed = await checkPriorSignatures(priorSignatures, connections[0]);
      if (landed) {
        log.info({ signature: landed, attempt }, 'Prior attempt landed between retries');
        return { signature: landed, blockhash: '', lastValidBlockHeight: 0 };
      }
    }

    try {
      log.debug({ attempt, maxAttempts: RETRY_ATTEMPTS }, 'Buy broadcast attempt');
      const result = await broadcastAndConfirm(tx, wallet, connections, {
        confirmTimeoutMs: CONFIRM_TIMEOUT_MS,
        sendMaxRetries: SEND_MAX_RETRIES,
      });
      return result;
    } catch (err) {
      lastError = err as Error;

      // On-chain failure (slippage, etc.) — do NOT retry
      if (err instanceof BroadcastError && err.landed) {
        throw err;
      }

      // Capture signature for late-landing check on next iteration
      if (err instanceof BroadcastError && err.signature) {
        priorSignatures.push(err.signature);
      }

      if (attempt < RETRY_ATTEMPTS) {
        log.warn({ attempt, error: (err as Error).message }, 'Buy broadcast failed, retrying with fresh blockhash');
      }
    }
  }

  // All attempts exhausted
  log.error({ attempts: RETRY_ATTEMPTS }, 'All buy broadcast attempts failed');
  throw lastError!;
}
