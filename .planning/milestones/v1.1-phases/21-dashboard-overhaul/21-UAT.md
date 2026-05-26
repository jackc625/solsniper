---
status: complete
phase: 21-dashboard-overhaul
source: [21-01-SUMMARY.md, 21-02-SUMMARY.md, 21-03-SUMMARY.md, 21-04-SUMMARY.md, 21-05-SUMMARY.md]
started: 2026-04-01T18:00:00Z
updated: 2026-05-26T20:29:32Z
---

## Current Test

[testing complete]

## Tests

### 1. Cold Start Smoke Test
expected: Stop any running bot, then run `pnpm start` from the repo root (builds dashboard + launches bot in-process; set "dryRun": true in config.jsonc to avoid live trades). Bot boots without errors, dashboard loads at http://localhost:3001, FEED page renders. Do NOT delete data/trades.db.
result: pass

### 2. Sidebar Shows 6 Navigation Items
expected: Sidebar displays 6 nav items: FEED, PERF, PIPE, CTRL, STAT, CONF. Clicking each one navigates to its respective page view.
result: pass

### 3. Health Dot on Status Nav Item
expected: The STAT nav item shows a small colored dot (green/yellow/red) reflecting aggregate health status from /api/health. Dot updates with polling.
result: pass

### 4. Emergency Stop Button in Sidebar
expected: A red EMERGENCY STOP button is visible at the bottom of the sidebar (above the connection bar). It has a red glow on hover and a 44px touch target.
result: pass

### 5. Connection Bar 3-State Display
expected: Connection bar at bottom of sidebar shows one of 3 states: CONNECTED (green) when SSE is active, PAUSED (yellow) when detection is paused, NO SIGNAL (red) when SSE connection is lost.
result: pass

### 6. Per-Source Stat Cards on Performance Page
expected: Navigate to PERF page. Below the aggregate stats, per-source stat cards appear for each detection source (pumpportal, raydium, pumpswap) showing P&L and W/L counts.
result: pass

### 7. Source Filter on Equity Curve Chart
expected: On PERF page, source toggle buttons (ALL, PUMP, RAY, PSWAP) appear above or near the equity chart. Clicking a source filters the chart to show only that source's equity curve. Active button has amber styling. Chart updates without flickering.
result: pass

### 8. Source Filter on Trade History Table
expected: On PERF page, a source dropdown filter appears in the trade history table header alongside the existing mint text filter. Selecting a source filters the table rows to that source only.
result: pass

### 9. Pipeline Page - Streaming Safety Evaluation Cards
expected: Navigate to PIPE page. Safety evaluation events stream in as cards showing PASS/FAIL badge, score/100, and token mint. Cards are expandable to reveal per-check detail tables with tier breakdown and timing. Auto-scroll with a LIVE indicator.
result: pass

### 10. Pipeline Stats Header
expected: Pipeline page shows a stats header with pass rate %, average score, and evals/min computed client-side from received events.
result: pass

### 11. Controls Page - Detection Pause/Resume Toggle
expected: Navigate to CTRL page. A detection pause/resume toggle is visible. Toggling it calls POST /api/controls/detection and the sidebar connection bar updates to PAUSED (yellow) or CONNECTED (green) accordingly.
result: pass

### 12. Controls Page - Force Sell with Inline Confirmation
expected: On CTRL page, an open positions table shows active positions. Each row has a FORCE SELL button. Clicking it shows CONFIRM SELL / KEEP POSITION inline. KEEP auto-dismisses after 5s. CONFIRM SELL triggers the sell and shows a SELLING... badge.
result: skipped
reason: No open position available to exercise force-sell (dryRun + minSafetyScore 80, positions table empty). Deferred -- can revisit by temporarily lowering minSafetyScore to create a dry-run position.

### 13. Emergency Stop Dialog
expected: Clicking the EMERGENCY STOP sidebar button (or controls page button) opens a modal overlay. User must type "STOP" to enable the EXECUTE STOP button. After confirmation, dialog shows EXECUTING state. Dialog is dismissable via overlay click or DISMISS button.
result: pass

### 14. System Status - Component Health Cards
expected: Navigate to STAT page. A grid of component health cards appears with 8px colored status dots (green/yellow/red) for each component. Cards poll /api/health every 10s.
result: pass

### 15. System Status - RPC Metrics Table
expected: On STAT page, an RPC Performance section shows a table with Endpoint, p50, p99, Error Rate, and Requests columns. Error rates above 10% are red, above 5% yellow.
result: pass

### 16. System Status - Paginated Alert History
expected: On STAT page, an alert history section shows alerts with FAILURE (red) and RATE LIMIT (yellow) type badges. A "Load more" button fetches additional pages of alerts.
result: pass

## Summary

total: 16
passed: 15
issues: 0
pending: 0
skipped: 1
blocked: 0

## Gaps

[none yet]
