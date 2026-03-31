---
phase: 20
slug: reliability-monitoring
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-30
---

# Phase 20 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | vitest.config.ts |
| **Quick run command** | `rtk vitest run --reporter=verbose` |
| **Full suite command** | `rtk vitest run --reporter=verbose` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `rtk vitest run --reporter=verbose`
- **After every plan wave:** Run `rtk vitest run --reporter=verbose`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 20-01-01 | 01 | 1 | REL-02, REL-04 | unit | `rtk vitest run src/monitoring/alert-store.test.ts` | W0 | pending |
| 20-01-02 | 01 | 1 | REL-04 | unit | `rtk vitest run src/core/` | W0 | pending |
| 20-02-01 | 02 | 2 | REL-01, REL-02 | unit | `rtk vitest run src/monitoring/health-service.test.ts` | W0 | pending |
| 20-02-02 | 02 | 2 | REL-03 | unit | `rtk vitest run src/monitoring/metrics-tracker.test.ts` | W0 | pending |
| 20-03-01 | 03 | 3 | REL-01, REL-02, REL-03 | unit | `rtk vitest run src/dashboard/routes/health.test.ts src/dashboard/routes/alerts.test.ts src/dashboard/routes/metrics.test.ts` | W0 | pending |
| 20-03-02 | 03 | 3 | REL-01, REL-02, REL-03 | unit | `rtk vitest run src/dashboard/routes/` | W0 | pending |
| 20-04-01 | 04 | 4 | REL-02, REL-03 | integration | `rtk tsc --noEmit && rtk vitest run src/core/fee-estimator.test.ts` | existing | pending |
| 20-04-02 | 04 | 4 | REL-01, REL-02, REL-03, REL-04 | integration | `rtk tsc --noEmit && rtk vitest run --reporter=verbose` | existing | pending |

*Status: pending / green / red / flaky*

---

## Wave 0 Requirements

- [ ] `src/monitoring/alert-store.test.ts` -- stubs for REL-02 alert persistence (created by Plan 01)
- [ ] `src/monitoring/health-service.test.ts` -- stubs for REL-01 health checks, REL-02 alert transition (created by Plan 02)
- [ ] `src/monitoring/metrics-tracker.test.ts` -- stubs for REL-03 metrics tracking (created by Plan 02)
- [ ] `src/dashboard/routes/health.test.ts` -- stubs for /api/health route (created by Plan 03)
- [ ] `src/dashboard/routes/alerts.test.ts` -- stubs for /api/alerts route (created by Plan 03)
- [ ] `src/dashboard/routes/metrics.test.ts` -- stubs for /api/metrics route (created by Plan 03)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Log rotation at 50MB threshold | REL-04 | Requires producing 50MB of logs | Generate load; verify rotated file appears in logs/ dir |
| Detection disconnect alert | REL-02 | Requires killing WebSocket server | Stop PumpPortal feed; verify SYSTEM_ALERT in SSE stream |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
