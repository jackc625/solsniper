---
phase: 21
slug: dashboard-overhaul
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-03-31
audited: 2026-05-26
---

# Phase 21 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.0.18 |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run src/dashboard/routes/controls.test.ts` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run src/dashboard/routes/controls.test.ts`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 21-01-01 | 01 | 1 | DASH-08 | unit | `npx vitest run src/safety/safety-pipeline.test.ts -t "SAFETY_EVALUATION"` | ✅ | ✅ green |
| 21-01-02 | 01 | 1 | DASH-09 | unit | `npx vitest run src/dashboard/routes/controls.test.ts -t "pause"` | ✅ | ✅ green |
| 21-01-03 | 01 | 1 | DASH-09 | unit | `npx vitest run src/dashboard/routes/controls.test.ts -t "force-sell"` | ✅ | ✅ green |
| 21-01-04 | 01 | 1 | DASH-09 | unit | `npx vitest run src/dashboard/routes/controls.test.ts -t "409"` | ✅ | ✅ green |
| 21-01-05 | 01 | 1 | DASH-09 | unit | `npx vitest run src/dashboard/routes/controls.test.ts -t "emergency"` | ✅ | ✅ green |
| 21-01-06 | 01 | 1 | DASH-08 | unit | `npx vitest run src/position/position-manager.test.ts -t "isSellInFlight"` | ✅ | ✅ green |
| 21-01-09 | 01 | 1 | DASH-09 | unit | `npx vitest run src/dashboard/routes/controls.test.ts -t "already paused"` | ✅ | ✅ green |
| 21-01-10 | 01 | 1 | DASH-09 | unit | `npx vitest run src/dashboard/routes/controls.test.ts -t "already paused still"` | ✅ | ✅ green |
| 21-01-11 | 01 | 1 | DASH-09 | unit | `npx vitest run src/dashboard/routes/controls.test.ts -t "mixed sellResults"` | ✅ | ✅ green |
| 21-02-01 | 02 | 2 | DASH-09 | manual | Build dashboard, visual verify sidebar nav + e-stop + connection bar | N/A | Manual-only |
| 21-03-01 | 03 | 2 | DASH-07 | manual | Build dashboard, visual verify per-source analytics and chart stability | N/A | Manual-only |
| 21-04-01 | 04 | 2 | DASH-08 | manual | Build dashboard, visual verify Pipeline page streaming cards | N/A | Manual-only |
| 21-04-02 | 04 | 2 | DASH-09 | manual | Build dashboard, visual verify Controls page (toggle, force-sell, e-stop dialog) | N/A | Manual-only |
| 21-05-01 | 05 | 2 | DASH-10 | manual | Build dashboard, visual verify SystemStatus page health/metrics/alerts | N/A | Manual-only |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `src/dashboard/routes/controls.test.ts` — 11 tests for DASH-09 (pause, force-sell, 409, e-stop, idempotency, partial failure)
- [x] `src/safety/safety-pipeline.test.ts` — 3 tests for DASH-08 (SAFETY_EVALUATION emission)
- [x] `src/position/position-manager.test.ts` — 2 tests for isSellInFlight

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Sidebar shows 6 nav items, health dot, e-stop button, 3-state connection bar | DASH-09 | Client-side Preact UI rendering, no test framework for dashboard | Build dashboard, open in browser, verify nav items, health dot color, e-stop button, connection bar states |
| Per-source P&L chart renders correctly with source filter | DASH-07 | Client-side compute + chart rendering, no backend test needed | Build dashboard, open Performance page, verify per-source stat cards, toggle source filter buttons, verify chart updates without flicker |
| Pipeline page streams safety evaluation cards | DASH-08 | SSE stream rendering in Preact, no backend test needed | Build dashboard, open Pipeline page, verify streaming cards with PASS/FAIL badges, expandable detail, stats header |
| Controls page provides pause/resume, force-sell, e-stop dialog | DASH-09 | UI interaction flows in Preact, backend APIs tested separately | Build dashboard, open Controls page, verify pause toggle, positions table, force-sell confirmation flow, e-stop dialog requires STOP typing |
| SystemStatus page shows health/metrics/alerts | DASH-10 | Existing endpoints already tested in Phase 20; visual verification of aggregation | Build dashboard, open SystemStatus page, verify health cards with colored dots, RPC metrics table with threshold coloring, paginated alert history |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Manual-Only designation
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all backend requirements
- [x] No watch-mode flags
- [x] Feedback latency < 15s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** complete

---

## Validation Audit 2026-04-04

| Metric | Count |
|--------|-------|
| Gaps found | 3 |
| Resolved | 3 |
| Escalated | 0 |

**Details:** Added 3 missing tests to controls.test.ts: idempotent pause (Test 9), idempotent e-stop (Test 10), e-stop partial failure (Test 11). All 11 controls tests green. Full automated coverage for all backend requirements (DASH-08, DASH-09). Frontend requirements (DASH-07, DASH-10) correctly classified as manual-only.

---

## Validation Audit 2026-05-26

| Metric | Count |
|--------|-------|
| Gaps found | 0 |
| Resolved | 0 |
| Escalated | 0 |

**Details:** Re-audit after codebase drift since the 2026-04-04 audit (Phase 21 security re-verification + RugCheck API changes). Confirmed test infrastructure unchanged (Vitest 4.0.18, `vitest.config.ts`). Re-ran all three backend test files — **80 tests green** (`controls.test.ts` 11, `safety-pipeline.test.ts` 31, `position-manager.test.ts` 38); all 9 mapped automated checks present and passing. No regressions. The 5 manual-only entries (DASH-07 per-source analytics, DASH-08/09 frontend pages, DASH-10 system status) remain correctly classified: the `dashboard/` tree shares the root `package.json` with no frontend test framework (no jsdom/testing-library), and the testable pure logic (`sourceStats`, pipeline stats, connection-bar priority) is inline and unexported within Preact components — automated coverage would require modifying implementation files (out of scope) or standing up new test infrastructure. Phase 21 remains Nyquist-compliant; all backend requirements have automated verification.
