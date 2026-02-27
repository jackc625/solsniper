/**
 * broadcaster.ts — Blockhash-last signing + multi-RPC parallel broadcast + confirmation.
 *
 * EXE-04: Blockhash fetched as absolute last step before tx.sign().
 * EXE-05: Fire to all RPC connections simultaneously via Promise.allSettled.
 * EXE-08: Caller always passes a freshly-deserialized tx — blockhash overwritten here.
 *
 * Anti-patterns avoided:
 * - NO pre-fetched blockhash passed in (would violate EXE-04)
 * - NO maxRetries > 0 on sendRawTransaction (stale blockhash issue)
 * - NO sequential RPC send (would add latency)
 */
import { type VersionedTransaction, type Connection, type Keypair } from '@solana/web3.js';
import type { BroadcastResult } from '../types/index.js';
import { createModuleLogger } from '../core/logger.js';

const log = createModuleLogger('broadcaster');

/**
 * Signs and broadcasts a VersionedTransaction to all provided RPC connections in parallel.
 * Fetches blockhash immediately before signing (EXE-04).
 * Returns on the first fulfilled signature (all connections return the same signature).
 * Throws if all RPC connections reject.
 */
export async function broadcastAndConfirm(
  tx: VersionedTransaction,
  wallet: Keypair,
  connections: Connection[]
): Promise<BroadcastResult> {
  if (connections.length === 0) {
    throw new Error('broadcastAndConfirm: no RPC connections provided');
  }

  // EXE-04: Fetch blockhash as the ABSOLUTE LAST step before signing.
  // Use 'processed' commitment for a fresher blockhash (faster than 'confirmed').
  const { blockhash, lastValidBlockHeight } = await connections[0].getLatestBlockhash('processed');
  tx.message.recentBlockhash = blockhash;
  tx.sign([wallet]);

  const serialized = tx.serialize();

  // EXE-05: Send to ALL connections simultaneously.
  // skipPreflight: true — Jupiter has already simulated; skip for speed.
  // maxRetries: 0 — we handle retries ourselves with fresh blockhash per retry.
  const results = await Promise.allSettled(
    connections.map((conn) =>
      conn.sendRawTransaction(serialized, {
        skipPreflight: true,
        maxRetries: 0,
      })
    )
  );

  const success = results.find((r) => r.status === 'fulfilled');
  if (!success || success.status !== 'fulfilled') {
    const errors = results
      .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      .map((r) => String(r.reason))
      .join('; ');
    throw new Error(`All RPC connections rejected transaction: ${errors}`);
  }

  const signature = success.value;
  log.debug({ signature, blockhash }, 'Transaction broadcast to all RPCs');

  // Confirm using the first connection (all sigs are identical — any connection works).
  const confirmation = await connections[0].confirmTransaction(
    { signature, blockhash, lastValidBlockHeight },
    'confirmed'
  );

  if (confirmation.value.err !== null) {
    throw new Error(`Transaction confirmed but failed on-chain: ${JSON.stringify(confirmation.value.err)}`);
  }

  log.info({ signature }, 'Transaction confirmed');
  return { signature, blockhash, lastValidBlockHeight };
}
