---
phase: 14
slug: sell-price-bug-fixes
status: draft
nyquist_compliant: true
wave_0_complete: true
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
| 14-01-00 | 01 | 1 | Wave 0 test scaffolds (standard-seller, chunked-seller) | unit | `npx vitest run src/execution/sell/standard-seller.test.ts src/execution/sell/chunked-seller.test.ts` | W0 creates | ⬜ pending |
| 14-01-01 | 01 | 1 | Seller return type change + shared parseSolReceived | unit | `npx vitest run src/execution/sell/standard-seller.test.ts src/execution/sell/chunked-seller.test.ts src/execution/sell/pump-portal-seller.test.ts src/execution/sell/jito-seller.test.ts` | ✅ (after W0) | ⬜ pending |
| 14-02-01 | 02 | 2 | TradeStore.addSellPrice + SELL_PARTIAL + PM lastKnownQuoteSol | unit | `npx vitest run src/persistence/trade-store` | ✅ existing | ⬜ pending |
| 14-02-02 | 02 | 2 | SellLadder threading + pnlSol fix + EMERGENCY parse + SELL_PARTIAL wiring | unit | `npx vitest run src/execution/sell/sell-ladder.test.ts` | ✅ existing | ⬜ pending |
| 14-03-00 | 03 | 1 | Wave 0 test scaffold (trades routes) | unit | `npx vitest run src/dashboard/routes/trades.test.ts` | W0 creates | ⬜ pending |
| 14-03-01 | 03 | 1 | Dashboard SQL pnl_sol + win rate formula fix | unit | `npx vitest run src/dashboard/routes/trades.test.ts` | ✅ (after W0) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `src/execution/sell/standard-seller.test.ts` — covers new `{ signature, solReceived }` return type (Plan 01 Task 0)
- [x] `src/execution/sell/chunked-seller.test.ts` — covers tranche accumulation with solReceived (Plan 01 Task 0)
- [x] New assertions in `src/execution/sell/sell-ladder.test.ts` — verify `sellPriceSol` passed to `transition()`, correct pnlSol formula, fallback, EMERGENCY override (Plan 02 Task 2)
- [x] New assertions in `src/execution/sell/pump-portal-seller.test.ts` — verify on-chain parse path (Plan 01 Task 1)
- [x] `src/dashboard/routes/trades.test.ts` — verify corrected SQL P&L formulas (Plan 03 Task 0)

*All Wave 0 gaps resolved in revised plans.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| End-to-end sell -> dashboard P&L display | Full flow | Requires live Solana connection + dashboard UI | Execute a real/dry-run sell, verify P&L appears on dashboard |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 15s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending (post-revision)
