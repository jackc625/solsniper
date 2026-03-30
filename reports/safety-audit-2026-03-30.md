# Safety Pipeline Audit Report

**Generated:** 2026-03-30
**Date range:** N/A

## Summary

| Metric | Value |
|--------|-------|
| Total tokens evaluated | 76 |
| Passed | 76 |
| Rejected | 0 |
| Rejection rate | 0.0% |
| Avg evaluation duration | 0ms |

## Trade Outcomes

Outcome analysis for tokens that passed the safety pipeline and were bought:

| Metric | Value |
|--------|-------|
| Total trades | 17 |
| Profitable | 3 |
| Loss | 14 |
| Win rate | 17.6% |
| Total SOL gained | 0.0030 |
| Total SOL lost | 0.0185 |
| Net P&L | -0.0155 SOL |

## Per-Check Accuracy

No per-check data available (log file not provided or no safety decisions in logs).

## Score Distribution

| Range | Count | Distribution |
|-------|-------|--------------|
| 0-9   |     0 |  |
| 10-19 |     0 |  |
| 20-29 |     0 |  |
| 30-39 |     0 |  |
| 40-49 |     0 |  |
| 50-59 |     0 |  |
| 60-69 |     0 |  |
| 70-79 |     0 |  |
| 80-89 |     0 |  |
| 90-100 |     0 |  |

## False Positive Estimate

No rejected mints sampled. Provide a log file with `--logs` for false positive analysis.

## Recommendations

- Low win rate (3.9%) suggests minSafetyScore threshold may be too low. Consider raising it to filter more marginal tokens.
- Low rejection rate (0.0%). Pipeline may be too permissive. Consider raising check thresholds.
