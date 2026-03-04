---
phase: 14
slug: sell-price-bug-fixes
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-04
---

# Phase 14 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (already configured) |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run src/execution/sell/ src/dashboard/` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run src/execution/sell/ src/dashboard/`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 14-01-01 | 01 | 1 | Seller return type change | unit | `npx vitest run src/execution/sell/standard-seller.test.ts` | ❌ W0 | ⬜ pending |
| 14-01-02 | 01 | 1 | Jito seller outAmount extraction | unit | `npx vitest run src/execution/sell/jito-seller.test.ts` | ❌ W0 | ⬜ pending |
| 14-01-03 | 01 | 1 | PumpPortal on-chain parse | unit | `npx vitest run src/execution/sell/pump-portal-seller.test.ts` | ❌ W0 | ⬜ pending |
| 14-01-04 | 01 | 1 | Chunked seller accumulation | unit | `npx vitest run src/execution/sell/chunked-seller.test.ts` | ❌ W0 | ⬜ pending |
| 14-01-05 | 01 | 1 | SellLadder sellPriceSol threading | unit | `npx vitest run src/execution/sell/sell-ladder.test.ts` | ✅ partial | ⬜ pending |
| 14-01-06 | 01 | 1 | SellLadder pnlSol formula fix | unit | `npx vitest run src/execution/sell/sell-ladder.test.ts` | ❌ W0 | ⬜ pending |
| 14-02-01 | 02 | 2 | Dashboard SQL pnl_sol formula | integration | `npx vitest run src/dashboard/routes/trades.test.ts` | ❌ W0 | ⬜ pending |
| 14-02-02 | 02 | 2 | Win rate denominator fix | integration | `npx vitest run src/dashboard/routes/trades.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/execution/sell/standard-seller.test.ts` — covers new `{ signature, solReceived }` return type
- [ ] `src/execution/sell/chunked-seller.test.ts` — covers tranche accumulation with solReceived
- [ ] New assertions in `src/execution/sell/sell-ladder.test.ts` — verify `sellPriceSol` passed to `transition()` and correct pnlSol formula
- [ ] New assertions in `src/execution/sell/pump-portal-seller.test.ts` — verify on-chain parse path
- [ ] `src/dashboard/routes/trades.test.ts` — verify corrected SQL P&L formulas

*If none: "Existing infrastructure covers all phase requirements."*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| End-to-end sell → dashboard P&L display | Full flow | Requires live Solana connection + dashboard UI | Execute a real/dry-run sell, verify P&L appears on dashboard |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
