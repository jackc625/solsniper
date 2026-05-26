---
phase: 18
slug: safety-pipeline-audit-enhancement
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-28
---

# Phase 18 — Validation Strategy

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
| 18-01-01 | 01 | 1 | SAF-10 | integration | `rtk vitest run tests/safety/audit` | ❌ W0 | ⬜ pending |
| 18-02-01 | 02 | 1 | SAF-12 | unit | `rtk vitest run tests/safety/tier1-liquidity` | ❌ W0 | ⬜ pending |
| 18-03-01 | 03 | 1 | SAF-13 | unit | `rtk vitest run tests/safety/tier2-lp-lock` | ❌ W0 | ⬜ pending |
| 18-03-02 | 03 | 1 | SAF-14 | unit | `rtk vitest run tests/safety/tier2-metadata` | ❌ W0 | ⬜ pending |
| 18-04-01 | 04 | 2 | SAF-12,SAF-13,SAF-14 | integration | `rtk vitest run tests/safety/safety-pipeline` | ✅ | ⬜ pending |
| 18-05-01 | 05 | 3 | SAF-11 | unit | `rtk vitest run tests/safety/calibration` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/safety/tier1-liquidity.test.ts` — stubs for SAF-12
- [ ] `tests/safety/tier2-lp-lock.test.ts` — stubs for SAF-13
- [ ] `tests/safety/tier2-metadata.test.ts` — stubs for SAF-14
- [ ] `tests/safety/audit.test.ts` — stubs for SAF-10 audit script validation

*Existing vitest infrastructure covers framework needs.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Dry-run validation of calibrated weights | SAF-11 | Requires live bot in dry-run mode with real market data | Run bot with `--dry-run`, compare safety pass/fail rates in logs against audit baseline |
| Audit report accuracy | SAF-10 | Requires real trade history in SQLite | Run audit script against production db, verify report sections exist |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
