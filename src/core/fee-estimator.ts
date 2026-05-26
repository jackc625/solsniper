import { createModuleLogger } from './logger.js';
import type { TradingConfig } from '../config/trading.js';
import type { MetricsTracker } from '../monitoring/metrics-tracker.js';

const log = createModuleLogger('fee-estimator');
const ESTIMATED_CU = 200_000; // Standard swap CU estimate for conversion
const DEFAULT_COOLDOWN_MS = 30_000; // 30s cooldown after consecutive failures
const RETRY_DELAY_MS = 300;         // 300ms backoff before single retry

/** Callback for consecutive failure / rate limit / auth failure alert emission (wired in index.ts). */
export type ApiAlertCallback = (endpoint: string, type: 'consecutive_failure' | 'rate_limit' | 'auth_failure', message: string) => void;

export interface FeeEstimate {
  maxLamports: number;       // For Jupiter paths: total lamports cap
  priorityFeeSol: number;    // For PumpPortal paths: fee in SOL
  source: 'helius' | 'fallback';
}

export class FeeEstimator {
  private cache: { microlamportsPerCU: number; expiry: number } | null = null;
  private readonly ttlMs: number;
  private readonly rpcUrl: string;
  private readonly metricsTracker?: MetricsTracker;
  private readonly onApiAlert?: ApiAlertCallback;
  private readonly apiFailureThreshold: number;
  private consecutiveFailures = 0;
  private cooldownUntil = 0;

  constructor(
    rpcUrl: string,
    ttlMs = 5000,
    metricsTracker?: MetricsTracker,
    onApiAlert?: ApiAlertCallback,
    apiFailureThreshold = 5,
  ) {
    this.rpcUrl = rpcUrl;
    this.ttlMs = ttlMs;
    this.metricsTracker = metricsTracker;
    this.onApiAlert = onApiAlert;
    this.apiFailureThreshold = apiFailureThreshold;
  }

  async getEstimate(config: TradingConfig): Promise<FeeEstimate> {
    const { buy } = config.execution;
    const cap = buy.maxPriorityFeeCapLamports;

    // Check cache
    const now = Date.now();
    if (this.cache && now < this.cache.expiry) {
      const totalLamports = Math.ceil(this.cache.microlamportsPerCU * ESTIMATED_CU / 1_000_000);
      const capped = Math.min(totalLamports, cap);
      return { maxLamports: capped, priorityFeeSol: capped / 1e9, source: 'helius' };
    }

    // Circuit breaker: skip API call during cooldown, use fallback
    if (Date.now() < this.cooldownUntil) {
      log.debug('Helius fee-estimate circuit breaker active -- using static fallback');
      const fallbackLamports = Math.floor(buy.priorityFeeBaseLamports * buy.priorityFeeMultiplier);
      const capped = Math.min(fallbackLamports, cap);
      return { maxLamports: capped, priorityFeeSol: capped / 1e9, source: 'fallback' };
    }

    // Fetch from Helius
    const start = Date.now();
    let success = false;
    const rpcBody = JSON.stringify({
      jsonrpc: '2.0',
      id: 'fee-estimate',
      method: 'getPriorityFeeEstimate',
      params: [{ options: { priorityLevel: 'VeryHigh' } }],
    });
    try {
      let response = await fetch(this.rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: rpcBody,
      });

      // Single retry on transient errors (429, 5xx)
      if (!response.ok && (response.status === 429 || response.status >= 500)) {
        const retryAfter = response.headers.get('retry-after');
        const delayMs = retryAfter ? Math.min(Number(retryAfter) * 1000, 2000) : RETRY_DELAY_MS;
        await new Promise(r => setTimeout(r, delayMs));
        response = await fetch(this.rpcUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: rpcBody,
        });
      }

      success = response.ok;

      // D-10: HTTP 429 rate limit detection
      if (response.status === 429) {
        this.onApiAlert?.('helius:fee-estimate', 'rate_limit', 'HTTP 429 rate limit from helius:fee-estimate');
      }

      if (!response.ok) {
        throw new Error(`Helius HTTP ${response.status}`);
      }

      const json = await response.json();
      const microlamportsPerCU: number = json?.result?.priorityFeeEstimate;

      if (typeof microlamportsPerCU !== 'number' || microlamportsPerCU < 0) {
        throw new Error(`Invalid Helius response: ${JSON.stringify(json?.result)}`);
      }

      // Cache the raw value
      this.cache = { microlamportsPerCU, expiry: now + this.ttlMs };

      // Convert: microlamports/CU * estimatedCU / 1_000_000 = total lamports
      const totalLamports = Math.ceil(microlamportsPerCU * ESTIMATED_CU / 1_000_000);
      const capped = Math.min(totalLamports, cap);

      log.debug({ microlamportsPerCU, totalLamports, capped, source: 'helius' }, 'Fee estimate from Helius');

      return { maxLamports: capped, priorityFeeSol: capped / 1e9, source: 'helius' };
    } catch (err) {
      // Fall back to static config values
      const fallbackLamports = Math.floor(buy.priorityFeeBaseLamports * buy.priorityFeeMultiplier);
      const capped = Math.min(fallbackLamports, cap);

      log.warn({ err, fallbackLamports: capped, source: 'fallback' }, 'Helius fee estimate failed -- using static fallback');

      return { maxLamports: capped, priorityFeeSol: capped / 1e9, source: 'fallback' };
    } finally {
      this.metricsTracker?.record('helius:fee-estimate', Date.now() - start, success);

      // D-10: Consecutive failure tracking + circuit breaker activation
      if (!success) {
        this.consecutiveFailures++;
        if (this.consecutiveFailures >= this.apiFailureThreshold) {
          this.cooldownUntil = Date.now() + DEFAULT_COOLDOWN_MS;
          this.onApiAlert?.('helius:fee-estimate', 'consecutive_failure',
            `${this.consecutiveFailures} consecutive failures on helius:fee-estimate -- circuit breaker open for ${DEFAULT_COOLDOWN_MS / 1000}s`);
        }
      } else {
        this.consecutiveFailures = 0;
        this.cooldownUntil = 0;
      }
    }
  }
}
