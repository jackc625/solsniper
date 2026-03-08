import { env } from '../config/env.js';
import { createModuleLogger } from '../core/logger.js';

const log = createModuleLogger('jupiter-client');

const JUPITER_BASE_URL = 'https://api.jup.ag/swap/v1';
const DEFAULT_COOLDOWN_MS = 10_000;

/**
 * Thrown when Jupiter returns HTTP 400 (bad route, token not tradable, etc.)
 *
 * .code is the errorCode from the Jupiter response body (e.g. 'TOKEN_NOT_TRADABLE',
 * 'NO_ROUTES_FOUND', 'ROUTE_NOT_FOUND'), or undefined if the body wasn't parseable JSON.
 */
export class JupiterRouteError extends Error {
  constructor(message: string, public readonly code: string | undefined) {
    super(message);
    this.name = 'JupiterRouteError';
  }
}

/**
 * Centralized Jupiter API client with authentication and global rate-limit handling.
 *
 * All Jupiter API calls (quote, swap) go through this client so that:
 * - The x-api-key header is always injected (required since Jan 31, 2026)
 * - A 429 response from any endpoint triggers a global cooldown that blocks ALL
 *   subsequent Jupiter requests (rate limits are per-key, not per-endpoint)
 * - Cooldown duration respects the Retry-After header, falling back to 10 seconds
 *
 * PositionManager can call isRateLimited() / cooldownRemainingMs() to stretch
 * its poll interval when approaching the rate limit budget.
 */
export class JupiterClient {
  private cooldownUntil: number = 0;

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private headers(): Record<string, string> {
    return { 'x-api-key': env.SOLSNIPER_JUPITER_API_KEY };
  }

  private isCoolingDown(): boolean {
    return Date.now() < this.cooldownUntil;
  }

  private triggerCooldown(retryAfterMs?: number): void {
    const duration = retryAfterMs ?? DEFAULT_COOLDOWN_MS;
    this.cooldownUntil = Date.now() + duration;
    log.warn({ cooldownMs: duration }, 'Jupiter rate limited -- entering cooldown');
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * GET /swap/v1/quote -- fetch a swap quote from Jupiter.
   *
   * @param params  URLSearchParams with inputMint, outputMint, amount, slippageBps, etc.
   * @param signal  Optional AbortSignal for safety pipeline timeout propagation.
   * @returns Parsed JSON response from Jupiter.
   * @throws Error('Jupiter rate limited -- cooldown active') if in cooldown.
   * @throws Error('Jupiter rate limited (429)') on a fresh 429 response.
   * @throws Error('Jupiter quote HTTP {status}') on any other non-2xx.
   */
  async quote(params: URLSearchParams, signal?: AbortSignal): Promise<unknown> {
    if (this.isCoolingDown()) {
      throw new Error('Jupiter rate limited -- cooldown active');
    }

    const url = `${JUPITER_BASE_URL}/quote?${params.toString()}`;
    const response = await fetch(url, {
      headers: this.headers(),
      ...(signal ? { signal } : {}),
    });

    if (response.status === 429) {
      const retryAfterHeader = response.headers.get('retry-after');
      const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : undefined;
      this.triggerCooldown(retryAfterMs);
      throw new Error('Jupiter rate limited (429)');
    }

    if (response.status === 400) {
      let errorCode: string | undefined;
      try {
        const body = await response.json() as { errorCode?: string };
        errorCode = body.errorCode;
      } catch { /* body not JSON */ }
      log.warn({ errorCode }, 'Jupiter quote 400');
      throw new JupiterRouteError(
        `Jupiter quote HTTP 400${errorCode ? `: ${errorCode}` : ''}`,
        errorCode,
      );
    }

    if (!response.ok) {
      throw new Error(`Jupiter quote HTTP ${response.status}`);
    }

    return response.json();
  }

  /**
   * POST /swap/v1/swap -- submit a swap transaction request to Jupiter.
   *
   * @param body  Request body (must include quoteResponse from quote()).
   * @returns Parsed JSON response containing { swapTransaction: string } (base64-encoded tx).
   * @throws Error('Jupiter rate limited -- cooldown active') if in cooldown.
   * @throws Error('Jupiter rate limited (429)') on a fresh 429 response.
   * @throws Error('Jupiter swap HTTP {status}') on any other non-2xx.
   */
  async swap(body: Record<string, unknown>): Promise<{ swapTransaction: string }> {
    if (this.isCoolingDown()) {
      throw new Error('Jupiter rate limited -- cooldown active');
    }

    const response = await fetch(`${JUPITER_BASE_URL}/swap`, {
      method: 'POST',
      headers: {
        ...this.headers(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (response.status === 429) {
      const retryAfterHeader = response.headers.get('retry-after');
      const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : undefined;
      this.triggerCooldown(retryAfterMs);
      throw new Error('Jupiter rate limited (429)');
    }

    if (response.status === 400) {
      let errorCode: string | undefined;
      try {
        const body = await response.json() as { errorCode?: string };
        errorCode = body.errorCode;
      } catch { /* body not JSON */ }
      log.warn({ errorCode }, 'Jupiter swap 400');
      throw new JupiterRouteError(
        `Jupiter swap HTTP 400${errorCode ? `: ${errorCode}` : ''}`,
        errorCode,
      );
    }

    if (!response.ok) {
      throw new Error(`Jupiter swap HTTP ${response.status}`);
    }

    return response.json() as Promise<{ swapTransaction: string }>;
  }

  /**
   * Returns true if the client is currently in a rate-limit cooldown.
   * PositionManager uses this to stretch its poll interval.
   */
  isRateLimited(): boolean {
    return this.isCoolingDown();
  }

  /**
   * Returns the number of milliseconds remaining in the cooldown, or 0 if not in cooldown.
   * PositionManager uses this to calculate how long to stretch the poll interval.
   */
  cooldownRemainingMs(): number {
    const remaining = this.cooldownUntil - Date.now();
    return remaining > 0 ? remaining : 0;
  }
}

/**
 * Module-level singleton -- use this in all production callers.
 * Tests should instantiate `new JupiterClient()` directly for isolation.
 */
export const jupiterClient = new JupiterClient();
