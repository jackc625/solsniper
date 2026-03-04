---
phase: 14-sell-price-bug-fixes
plan: "03"
subsystem: dashboard
tags: [bug-fix, sql, p&l, dashboard, trades]
dependency_graph:
  requires: []
  provides: [correct-pnl-sql, win-rate-fix]
  affects: [src/dashboard/routes/trades.ts]
tech_stack:
  added: []
  patterns: [source-reading-tests, sql-case-expressions]
key_files:
  created:
    - src/dashboard/routes/trades.test.ts
  modified:
    - src/dashboard/routes/trades.ts
decisions:
  - "Source-reading test approach chosen over database-backed tests — sufficient for SQL formula correctness, avoids Fastify/SQLite integration overhead"
  - "Win rate denominator changed to total_with_pnl (trades with sell data) to exclude legacy NULL rows from both numerator and denominator"
  - "Wins defined as COMPLETED trades with positive P&L (sell_price_sol - amount_sol > 0), not simply COMPLETED state"
metrics:
  duration: "4 min"
  completed_date: "2026-03-04"
  tasks_completed: 2
  files_modified: 2
---

# Phase 14 Plan 03: Dashboard P&L SQL Fix Summary

Dashboard P&L corrected from `sell_price_sol - buy_price_sol` (wrong unit: per-token price delta) to `sell_price_sol - amount_sol` (correct: total SOL received minus total SOL spent); win rate denominator changed to exclude legacy NULL sell_price_sol trades.

## What Was Built

Two SQL bugs in `src/dashboard/routes/trades.ts` were fixed and covered with tests:

1. **History endpoint** (`GET /api/trades/history`): `pnl_sol` now computes as `sell_price_sol - amount_sol`. The old formula `sell_price_sol - buy_price_sol` was wrong because `buy_price_sol` is a per-token unit price (e.g., `0.000001 SOL/token`), while `amount_sol` is total SOL spent on the buy (e.g., `0.10 SOL`). Example: for a trade that spent 0.10 SOL and received 0.15 SOL, correct P&L is `0.05`, wrong P&L was `0.149999`.

2. **Stats endpoint** (`GET /api/stats`): `total_pnl_sol` now uses the same corrected `SUM(sell_price_sol - amount_sol)` formula.

3. **Win rate**: Denominator changed from `total` (all terminal trades, including legacy NULLs) to `total_with_pnl` (only trades with `sell_price_sol IS NOT NULL`). Numerator changed from `completed` (all COMPLETED trades) to `wins` (COMPLETED trades with positive P&L). Legacy trades with no sell data are excluded from both.

4. **Test file**: `src/dashboard/routes/trades.test.ts` reads the source and verifies formula correctness using string/regex assertions. 5 tests, all green.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 0 | Create test scaffold for trades routes | f358697 | src/dashboard/routes/trades.test.ts |
| 1 | Fix dashboard SQL P&L formulas and win rate | e32a1ba | src/dashboard/routes/trades.ts |

## Decisions Made

- **Source-reading test approach**: The plan offered two choices (Fastify inject with real SQLite vs. source-reading). Source-reading was chosen: it proves the SQL formula is correct without requiring database setup, is deterministic, and is sufficient for the stated goal.
- **Win rate wins definition**: A "win" is a COMPLETED trade where `sell_price_sol - amount_sol > 0` (positive realized P&L), not simply a COMPLETED state. This is more semantically accurate.
- **NULL handling in history**: `ELSE NULL` (not `ELSE 0`) in the history pnl_sol CASE — legacy trades with no sell data get NULL P&L, not zero. Stats uses `ELSE 0` for aggregate sum (NULL in SUM would be fine too but 0 is conventional for aggregates).

## Deviations from Plan

None — plan executed exactly as written. The source-reading test approach was explicitly offered as an option in the plan spec.

## Pre-existing Test Failures (Out of Scope)

The following test files have failures unrelated to this plan's changes. They were failing before this plan started and are documented here for awareness:

- `src/execution/jupiter-client.test.ts` (3 failures)
- `src/execution/sell/standard-seller.test.ts` (2 failures)
- `src/execution/sell/chunked-seller.test.ts` (3 failures)
- `src/recovery/recovery-manager.test.ts` (2 failures)

These are not regressions from this plan.

## Self-Check: PASSED

- [x] `src/dashboard/routes/trades.ts` exists and contains `sell_price_sol - amount_sol`
- [x] `src/dashboard/routes/trades.test.ts` exists with 5 passing tests
- [x] Commit f358697 exists (test scaffold)
- [x] Commit e32a1ba exists (SQL fix)
