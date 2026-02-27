import type { CheckResult } from '../../types/index.js';

const SOL_MINT = 'So11111111111111111111111111111111111111112';
const JUPITER_QUOTE_URL = 'https://api.jup.ag/swap/v1/quote';

/**
 * Validates that a sell route exists for the given token mint on Jupiter.
 *
 * GET https://api.jup.ag/swap/v1/quote?inputMint={mint}&outputMint={SOL}&amount=1000000&slippageBps=500
 *
 * Behavior per user decision (pessimistic failure handling):
 * - 200 response   → pass=true (route exists, can exit position)
 * - 400 response   → pass=false (no route — Jupiter: NO_ROUTES_FOUND, COULD_NOT_FIND_ANY_ROUTE)
 * - Any other HTTP → pass=false (unexpected error = block)
 * - Network error  → pass=false (cannot verify = block)
 *
 * Satisfies: SAF-03
 */
export async function checkSellRoute(mint: string, signal?: AbortSignal): Promise<CheckResult> {
  const url = `${JUPITER_QUOTE_URL}?inputMint=${mint}&outputMint=${SOL_MINT}&amount=1000000&slippageBps=500`;

  try {
    const response = await fetch(url, signal !== undefined ? { signal } : undefined);

    if (response.status === 400) {
      const body = await response.json().catch(() => ({}));
      return {
        pass: false,
        source: 'jupiter_sell_route',
        detail: `no route: ${JSON.stringify(body)}`,
      };
    }

    if (!response.ok) {
      // Pessimistic: any unexpected HTTP error = block
      return {
        pass: false,
        source: 'jupiter_sell_route',
        detail: `HTTP ${response.status}`,
      };
    }

    return {
      pass: true,
      source: 'jupiter_sell_route',
      detail: 'route exists',
    };
  } catch {
    // Pessimistic: network error, timeout, or abort = block
    return {
      pass: false,
      source: 'jupiter_sell_route',
      detail: 'fetch_error',
    };
  }
}
