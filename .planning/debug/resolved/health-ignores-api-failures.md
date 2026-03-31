---
status: resolved
trigger: "Health providers don't reflect API failure state. External APIs with 28+ consecutive failures and 100% error rate still show 'healthy' on GET /api/health."
created: 2026-03-31T00:00:00Z
updated: 2026-03-31T17:15:00Z
---

## Current Focus

hypothesis: Health providers only check activity timestamps and RPC failover state; they never consult MetricsTracker error rates or consecutive failure counts
test: Read all 4 health provider registrations in index.ts and confirm none reference metricsTracker
expecting: Zero references to metricsTracker.getStats() or metricsTracker.getAllStats() in any provider callback
next_action: Return diagnosis

## Symptoms

expected: When external APIs (rugcheck:report, helius:das-api) have 28+ consecutive failures with 100% error rate, GET /api/health should report affected components as "degraded" or "down"
actual: GET /api/health reports all components as "healthy" regardless of API failure rates
errors: N/A (no crash -- silent misreporting)
reproduction: Trigger sustained API failures (e.g., network block rugcheck API), then GET /api/health -- still shows healthy
started: Always -- health providers were implemented without API failure awareness

## Eliminated

(none -- root cause confirmed on first hypothesis)

## Evidence

- timestamp: 2026-03-31T00:00:00Z
  checked: src/index.ts lines 228-274 -- all 4 health provider registrations
  found: |
    1. detection provider (line 231): checks (Date.now() - lastDetectionActivity) > 600_000ms. Returns degraded only on detection silence.
    2. rpc provider (line 244): checks rpcDegraded flag (set by RpcManager failover/recovered events) and rpcManager.getState(). No API metrics.
    3. safety provider (line 256): checks (Date.now() - lastSafetyActivity) > 600_000ms. Returns degraded only on safety pipeline silence.
    4. execution provider (line 268): checks (Date.now() - lastExecutionActivity) > 1_800_000ms. Returns degraded only on execution silence.
  implication: No provider references metricsTracker, getStats(), getAllStats(), or any error rate / consecutive failure data. All are pure timestamp-since-last-activity or RPC-failover checks.

- timestamp: 2026-03-31T00:00:00Z
  checked: src/monitoring/metrics-tracker.ts -- available API
  found: |
    MetricsTracker exposes:
    - record(endpoint, latencyMs, success) -- called by all API modules
    - getStats(endpoint) -> { p50, p99, errorRate, count } -- per-endpoint sliding window
    - getAllStats() -> Record<string, EndpointStats> -- all endpoints
    These methods are available but never called from any health provider.
  implication: The data needed to detect API failures EXISTS in MetricsTracker but is simply not queried by health providers.

- timestamp: 2026-03-31T00:00:00Z
  checked: All metricsTracker.record() call sites
  found: |
    6 endpoint names are tracked:
    - rugcheck:report (tier2-rugcheck.ts)
    - helius:das-api (tier3-creator.ts)
    - helius:fee-estimate (fee-estimator.ts)
    - pumpportal:buy (pump-portal-buyer.ts)
    - pumpportal:sell (pump-portal-seller.ts)
    - jupiter:* (jupiter-client.ts, dynamic endpoint names)
    - jito:* (jito-seller.ts, dynamic endpoint names)
  implication: Rich per-endpoint error rate data is being recorded but never surfaces to health status.

- timestamp: 2026-03-31T00:00:00Z
  checked: src/monitoring/health-service.ts -- HealthProvider interface
  found: |
    HealthProvider = () => ComponentHealth where ComponentHealth = { status: 'healthy' | 'degraded' | 'down', detail?: string }.
    The check() method iterates all providers, takes worst-of, detects transitions, emits alerts.
    The interface is simple -- providers just return a status object. Adding MetricsTracker data requires the provider closures in index.ts to capture and query the metricsTracker instance.
  implication: The HealthService framework already supports degraded/down status from any provider -- the plumbing is fine, the provider callbacks just don't use it.

- timestamp: 2026-03-31T00:00:00Z
  checked: src/dashboard/routes/health.ts -- GET /api/health endpoint
  found: |
    Simply calls healthService.check() and returns the result with 503 if status is 'down', 200 otherwise.
  implication: The API endpoint faithfully returns whatever the health providers report. The problem is upstream in the providers.

## Resolution

root_cause: |
  The 4 health providers registered in src/index.ts (lines 228-274) only check:
  - detection: time since last token detection event (>10min = degraded)
  - rpc: RpcManager failover state (backup = degraded)
  - safety: time since last safety pipeline evaluation (>10min = degraded)
  - execution: time since last execution activity (>30min = degraded)

  None of them consult MetricsTracker.getStats() or MetricsTracker.getAllStats().
  MetricsTracker records per-endpoint error rates and counts for all 6+ API endpoints
  (rugcheck:report, helius:das-api, helius:fee-estimate, pumpportal:buy, pumpportal:sell,
  jupiter:*, jito:*), but this data is completely invisible to the health system.

  As a result, an API endpoint can have 100% error rate with 28+ consecutive failures
  and the health system will still report "healthy" as long as detection/safety/execution
  events keep flowing (which they do, because safety checks return score=0 on API failure
  rather than blocking the pipeline).

fix: Plan 20-05 added 5th 'apis' health provider querying metricsTracker.getAllStats() with configurable degraded/down thresholds (0.5/0.9). 11 test files updated for new config fields.
verification: tsc --noEmit clean, 461/461 tests pass, 7 new apis provider unit tests
files_changed: [src/config/trading.ts, src/index.ts, src/monitoring/health-service.ts, src/monitoring/health-service.test.ts, src/dashboard/routes/health.test.ts]
