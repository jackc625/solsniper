import type { CheckResult, DetectionSource } from '../../types/index.js';
import { jupiterClient } from '../../execution/jupiter-client.js';

/**
 * Validates that a sell route exists for the given token mint on Jupiter.
 *
 * Uses the centralized JupiterClient for authenticated, rate-limit-aware requests.
 *
 * Source-aware behavior:
 * - source='pumpportal': Skip the check (pump.fun tokens newly created via create_v2 are not
 *   yet indexed by Jupiter at detection time — checking would cause false rejections).
 *   Sell route is verified post-buy instead.
 * - source='raydium' | 'pumpswap' | undefined: Run the Jupiter quote check as normal.
 *
 * Behavior per user decision (pessimistic failure handling):
 * - Quote resolves  → pass=true (route exists, can exit position)
 * - Quote throws    → pass=false (covers 429, 400, 5xx, network errors, and cooldown blocks)
 *
 * Satisfies: SAF-03
 */
export async function checkSellRoute(
  mint: string,
  signal?: AbortSignal,
  source?: DetectionSource,
): Promise<CheckResult> {
  // Pump.fun tokens (pumpportal source) are checked post-buy, not at detection time.
  // Jupiter hasn't indexed the new mint yet — checking would cause false rejections.
  if (source === 'pumpportal') {
    return {
      pass: true,
      source: 'jupiter_sell_route',
      detail: 'skipped for pumpportal (post-buy verification)',
    };
  }

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
