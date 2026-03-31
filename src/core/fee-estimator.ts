import { createModuleLogger } from './logger.js';
import type { TradingConfig } from '../config/trading.js';
import type { MetricsTracker } from '../monitoring/metrics-tracker.js';

const log = createModuleLogger('fee-estimator');
const ESTIMATED_CU = 200_000; // Standard swap CU estimate for conversion

/** Callback for consecutive failure / rate limit alert emission (wired in index.ts). */
export type ApiAlertCallback = (endpoint: string, type: 'consecutive_failure' | 'rate_limit', message: string) => void;

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

    // Fetch from Helius
    const start = Date.now();
    let success = false;
    try {
      const response = await fetch(this.rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'fee-estimate',
          method: 'getPriorityFeeEstimate',
          params: [{ options: { priorityLevel: 'VeryHigh' } }],
        }),
      });

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

      // D-10: Consecutive failure tracking
      if (!success) {
        this.consecutiveFailures++;
        if (this.consecutiveFailures >= this.apiFailureThreshold) {
          this.onApiAlert?.('helius:fee-estimate', 'consecutive_failure',
            `${this.consecutiveFailures} consecutive failures on helius:fee-estimate`);
        }
      } else {
        this.consecutiveFailures = 0;
      }
    }
  }
}
