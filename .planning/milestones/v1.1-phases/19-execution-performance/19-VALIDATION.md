---
phase: 19
slug: execution-performance
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-30
---

# Phase 19 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest ^4.0.18 |
| **Config file** | vitest.config.ts |
| **Quick run command** | `pnpm vitest run src/core/fee-estimator.test.ts src/core/balance-guard.test.ts` |
| **Full suite command** | `pnpm vitest run` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `pnpm vitest run src/core/fee-estimator.test.ts src/core/balance-guard.test.ts`
- **After every plan wave:** Run `pnpm vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 19-01-01 | 01 | 1 | EXE-10 | unit | `pnpm vitest run src/core/fee-estimator.test.ts -t "fetches"` | ❌ W0 | ⬜ pending |
| 19-01-02 | 01 | 1 | EXE-10 | unit | `pnpm vitest run src/core/fee-estimator.test.ts -t "fallback"` | ❌ W0 | ⬜ pending |
| 19-01-03 | 01 | 1 | EXE-10 | unit | `pnpm vitest run src/core/fee-estimator.test.ts -t "cache"` | ❌ W0 | ⬜ pending |
| 19-01-04 | 01 | 1 | EXE-10 | unit | `pnpm vitest run src/core/fee-estimator.test.ts -t "cap"` | ❌ W0 | ⬜ pending |
| 19-01-05 | 01 | 1 | EXE-12 | unit | `pnpm vitest run src/core/balance-guard.test.ts -t "sufficient"` | ❌ W0 | ⬜ pending |
| 19-01-06 | 01 | 1 | EXE-12 | unit | `pnpm vitest run src/core/balance-guard.test.ts -t "insufficient"` | ❌ W0 | ⬜ pending |
| 19-01-07 | 01 | 1 | EXE-12 | unit | `pnpm vitest run src/core/balance-guard.test.ts -t "cache"` | ❌ W0 | ⬜ pending |
| 19-01-08 | 01 | 1 | EXE-12 | unit | `pnpm vitest run src/core/balance-guard.test.ts -t "event"` | ❌ W0 | ⬜ pending |
| 19-02-01 | 02 | 2 | EXE-10 | unit | `pnpm vitest run src/execution/buy/jupiter-buyer.test.ts -t "dynamic"` | ✅ (new test) | ⬜ pending |
| 19-02-02 | 02 | 2 | EXE-10 | unit | `pnpm vitest run src/execution/buy/pump-portal-buyer.test.ts -t "dynamic"` | ✅ (new test) | ⬜ pending |
| 19-02-03 | 02 | 2 | EXE-10 | unit | `pnpm vitest run src/execution/sell/standard-seller.test.ts -t "dynamic"` | ✅ (new test) | ⬜ pending |
| 19-02-04 | 02 | 2 | EXE-10 | unit | `pnpm vitest run src/execution/sell/pump-portal-seller.test.ts -t "dynamic"` | ✅ (new test) | ⬜ pending |
| 19-02-05 | 02 | 2 | EXE-11 | unit | `pnpm vitest run src/execution/sell/jito-seller.test.ts -t "compute"` | ✅ (new test) | ⬜ pending |
| 19-03-01 | 03 | 2 | EXE-12 | unit | `pnpm vitest run src/core/balance-guard.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/core/fee-estimator.test.ts` — stubs for EXE-10a through EXE-10d (fetch, fallback, cache, cap)
- [ ] `src/core/balance-guard.test.ts` — stubs for EXE-12a through EXE-12d (sufficient, insufficient, cache, event)

*Existing test files (buyer/seller tests) get new test cases added during implementation — not Wave 0.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Helius API returns real fee estimates | EXE-10 | Requires live RPC connection | Deploy to VPS, check logs for `source: 'helius'` entries |
| Dynamic fees improve landing rate | EXE-10 | Requires production traffic | Monitor buy success rate before/after deployment over 24h |
| Balance guard prevents wallet drain | EXE-12 | Requires real wallet with low balance | Set minBalanceBufferSol high, verify buys are skipped |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
