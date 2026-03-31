import type { CheckResult } from '../../types/index.js';
import type { MetricsTracker } from '../../monitoring/metrics-tracker.js';
import type { ApiAlertCallback } from '../../core/fee-estimator.js';
import { createModuleLogger } from '../../core/logger.js';

const log = createModuleLogger('tier2-rugcheck');
const RUGCHECK_BASE_URL = 'https://api.rugcheck.xyz/v1/tokens';

// D-10: Module-level consecutive failure counter
let consecutiveFailures = 0;

interface RugCheckResponse {
  score: number;
  score_normalised: number;
  lpLockedPct: number;
  risks: Array<{ name: string; level: string; description: string; score: number }>;
}

/**
 * Structured RugCheck data subset for downstream checks (e.g., LP lock scoring).
 */
export interface RugCheckResultData {
  lpLockedPct: number;
  risks: Array<{ name: string }>;
}

/**
 * Queries the RugCheck API for a token safety report and converts the risk score
 * to a safety scale (higher = safer) by inverting: safetyScore = 100 - score_normalised.
 *
 * RugCheck scores are risk-oriented (higher = riskier), so we invert them.
 * This is a scoring signal (pass is always true) -- soft blocks are applied by the orchestrator.
 *
 * Pessimistic failure:
 * - Non-200 response: score = 0, detail = 'HTTP {status}'
 * - Fetch error or timeout: score = 0, detail = 'timeout_or_error'
 *
 * Satisfies: SAF-05
 */
export async function checkRugCheck(
  mint: string,
  apiKey: string | undefined,
  signal: AbortSignal,
  metricsTracker?: MetricsTracker,
  onApiAlert?: ApiAlertCallback,
  apiFailureThreshold = 5,
): Promise<[CheckResult, RugCheckResultData | null]> {
  const url = `${RUGCHECK_BASE_URL}/${mint}/report/summary`;

  const start = Date.now();
  let success = false;
  try {
    const response = await fetch(url, {
      signal,
      headers: {
        'X-API-KEY': apiKey ?? '',
      },
    });

    success = response.ok;

    // D-10: HTTP 429 rate limit detection
    if (response.status === 429) {
      onApiAlert?.('rugcheck:report', 'rate_limit', 'HTTP 429 rate limit from rugcheck:report');
    }

    if (!response.ok) {
      log.warn({ mint, status: response.status }, 'RugCheck API returned non-200 status');
      return [{
        pass: true,
        score: 0,
        source: 'rugcheck',
        detail: `HTTP ${response.status}`,
      }, null];
    }

    const data = (await response.json()) as RugCheckResponse;
    const safetyScore = Math.max(0, Math.min(100, Math.round(100 - data.score_normalised)));

    const resultData: RugCheckResultData = {
      lpLockedPct: data.lpLockedPct ?? 0,
      risks: data.risks.map(r => ({ name: r.name })),
    };

    return [{
      pass: true,
      score: safetyScore,
      source: 'rugcheck',
      detail: `score_normalised=${data.score_normalised} risks=${data.risks.length}`,
    }, resultData];
  } catch (err: unknown) {
    log.warn({ mint, err }, 'RugCheck API fetch error or timeout');
    return [{
      pass: true,
      score: 0,
      source: 'rugcheck',
      detail: 'timeout_or_error',
    }, null];
  } finally {
    metricsTracker?.record('rugcheck:report', Date.now() - start, success);

    // D-10: Consecutive failure tracking
    if (!success) {
      consecutiveFailures++;
      if (consecutiveFailures >= apiFailureThreshold) {
        onApiAlert?.('rugcheck:report', 'consecutive_failure',
          `${consecutiveFailures} consecutive failures on rugcheck:report`);
      }
    } else {
      consecutiveFailures = 0;
    }
  }
}
