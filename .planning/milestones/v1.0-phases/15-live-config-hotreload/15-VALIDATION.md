---
phase: 15
slug: live-config-hotreload
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-22
---

# Phase 15 — Validation Strategy

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
| 15-01-01 | 01 | 1 | DASH-04 | unit | `rtk vitest run src/safety/safety-pipeline.test.ts` | ✅ | ⬜ pending |
| 15-01-02 | 01 | 1 | DASH-04 | unit | `rtk vitest run src/execution/execution-engine.test.ts` | ✅ | ⬜ pending |
| 15-01-03 | 01 | 1 | DASH-04 | unit | `rtk vitest run src/position/position-manager.test.ts` | ✅ | ⬜ pending |
| 15-02-01 | 02 | 1 | DASH-05 | unit | `rtk vitest run src/dashboard/routes/config.test.ts` | ❌ W0 | ⬜ pending |
| 15-02-02 | 02 | 1 | DASH-05 | unit | `rtk vitest run src/events/bot-events.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- Existing test infrastructure covers core module tests (safety-pipeline, execution-engine, position-manager)
- CONFIG_CHANGED event emission tests may need new test files or additions to existing test files

*Existing infrastructure covers most phase requirements. New tests needed for CONFIG_CHANGED event and config route emission.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Dashboard settings update reflects immediately in bot behavior | DASH-04 | Requires running bot + dashboard | 1. Start bot with dashboard 2. Change stopLossPct via Settings 3. Verify next position tick uses new value |
| CONFIG_CHANGED event appears in Live Feed | DASH-05 | Requires SSE stream in browser | 1. Open dashboard 2. Change a setting 3. Verify feed card appears with changed field names |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
