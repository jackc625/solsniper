import type { CheckResult } from '../../types/index.js';
import { jupiterClient } from '../../execution/jupiter-client.js';

/**
 * Validates that a sell route exists for the given token mint on Jupiter.
 *
 * Uses the centralized JupiterClient for authenticated, rate-limit-aware requests.
 *
 * Behavior per user decision (pessimistic failure handling):
 * - Quote resolves  → pass=true (route exists, can exit position)
 * - Quote throws    → pass=false (covers 429, 400, 5xx, network errors, and cooldown blocks)
 *
 * Satisfies: SAF-03
 */
export async function checkSellRoute(mint: string, signal?: AbortSignal): Promise<CheckResult> {
  const params = new URLSearchParams({
    inputMint: mint,
    outputMint: 'So11111111111111111111111111111111111111112',
    amount: '1000000',
    slippageBps: '500',
  });

  try {
    await jupiterClient.quote(params, signal);
    return { pass: true, source: 'jupiter_sell_route', detail: 'route exists' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { pass: false, source: 'jupiter_sell_route', detail: msg };
  }
}
