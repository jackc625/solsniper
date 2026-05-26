import type { CheckResult } from '../../types/index.js';
import type { MetricsTracker } from '../../monitoring/metrics-tracker.js';
import type { ApiAlertCallback } from '../../core/fee-estimator.js';
import { createModuleLogger } from '../../core/logger.js';

const log = createModuleLogger('tier2-rugcheck');
const RUGCHECK_BASE_URL = 'https://api.rugcheck.xyz/v1/tokens';
const DEFAULT_COOLDOWN_MS = 30_000; // 30s cooldown after consecutive failures
const RETRY_DELAY_MS = 300;         // 300ms backoff before single retry

// D-10: Module-level monitoring state (set from index.ts)
let _metricsTracker: MetricsTracker | undefined;
let _onApiAlert: ApiAlertCallback | undefined;
let _apiFailureThreshold = 5;
let consecutiveFailures = 0;
let cooldownUntil = 0;

export function setRugCheckMonitoring(mt: MetricsTracker, cb: ApiAlertCallback, threshold = 5): void {
  _metricsTracker = mt;
  _onApiAlert = cb;
  _apiFailureThreshold = threshold;
}

/** Exposed for testing only. */
export function _resetCircuitBreaker(): void {
  consecutiveFailures = 0;
  cooldownUntil = 0;
}

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
  apiFailureThreshold?: number,
): Promise<[CheckResult, RugCheckResultData | null]> {
  const mt = metricsTracker ?? _metricsTracker;
  const alertCb = onApiAlert ?? _onApiAlert;
  const threshold = apiFailureThreshold ?? _apiFailureThreshold;

  // Circuit breaker: skip API call during cooldown
  if (Date.now() < cooldownUntil) {
    log.debug({ mint }, 'RugCheck circuit breaker active -- skipping API call');
    return [{
      pass: true,
      score: 0,
      source: 'rugcheck',
      detail: 'circuit_breaker_open',
    }, null];
  }

  // RugCheck documents the key as a ?key= query parameter (not a header).
  // Mirror tier3-creator's query-param auth. Empty/whitespace key => clean public mode.
  const trimmedKey = apiKey?.trim();
  const url = trimmedKey
    ? `${RUGCHECK_BASE_URL}/${mint}/report/summary?key=${trimmedKey}`
    : `${RUGCHECK_BASE_URL}/${mint}/report/summary`;

  const start = Date.now();
  let success = false;
  try {
    let response = await fetch(url, { signal });

    // Single retry on transient errors (429, 5xx) if time budget allows.
    // Retry re-fetches the SAME url (key already carried in the query string).
    if (!response.ok && (response.status === 429 || response.status >= 500) && !signal.aborted) {
      const retryAfter = response.headers.get('retry-after');
      const delayMs = retryAfter ? Math.min(Number(retryAfter) * 1000, 2000) : RETRY_DELAY_MS;
      await new Promise(r => setTimeout(r, delayMs));
      if (!signal.aborted) {
        response = await fetch(url, { signal });
      }
    }

    success = response.ok;

    // D-10: HTTP 429 rate limit detection
    if (response.status === 429) {
      alertCb?.('rugcheck:report', 'rate_limit', 'HTTP 429 rate limit from rugcheck:report');
    }

    // Auth failure (rejected/expired key): make it LOUD and diagnosable.
    // SAFETY INVARIANT: still returns { pass: true, score: 0 } -- diagnosability only,
    // never a hard block. An auth failure must not be silently swallowed as a max-risk token.
    if (response.status === 401 || response.status === 403) {
      log.error({ mint, status: response.status }, 'RugCheck API key rejected -- check RUGCHECK_API_KEY');
      alertCb?.('rugcheck:report', 'auth_failure',
        `RugCheck API key rejected (HTTP ${response.status}) -- check RUGCHECK_API_KEY`);
      return [{
        pass: true,
        score: 0,
        source: 'rugcheck',
        detail: `HTTP ${response.status}`,
      }, null];
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
    // Secret hygiene: the key now lives in the URL. Scrub it and never log the raw
    // err object (its stack can carry the unredacted URL).
    const safeUrl = url.replace(/key=[^&]+/, 'key=***');
    log.warn({ mint, url: safeUrl, err: err instanceof Error ? err.message : String(err) },
      'RugCheck API fetch error or timeout');
    return [{
      pass: true,
      score: 0,
      source: 'rugcheck',
      detail: 'timeout_or_error',
    }, null];
  } finally {
    mt?.record('rugcheck:report', Date.now() - start, success);

    // D-10: Consecutive failure tracking + circuit breaker activation
    if (!success) {
      consecutiveFailures++;
      if (consecutiveFailures >= threshold) {
        cooldownUntil = Date.now() + DEFAULT_COOLDOWN_MS;
        alertCb?.('rugcheck:report', 'consecutive_failure',
          `${consecutiveFailures} consecutive failures on rugcheck:report -- circuit breaker open for ${DEFAULT_COOLDOWN_MS / 1000}s`);
      }
    } else {
      consecutiveFailures = 0;
      cooldownUntil = 0;
    }
  }
}
