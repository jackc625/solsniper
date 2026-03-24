---
phase: 07-position-management
verified: 2026-02-27T20:45:00Z
status: passed
score: 13/13 must-haves verified
gaps: []
human_verification:
  - test: "Live Jupiter quote polling at 5 s interval under real network conditions"
    expected: "Each MONITORING trade fetched once per poll cycle; no rate-limit errors on free-tier Jupiter with <=5 positions"
    why_human: "Cannot invoke real Jupiter API or measure timing in static analysis"
  - test: "Stop-loss fires on mainnet with a real token position that has dropped 50%"
    expected: "SellLadder.sell() is called with full token amount and MONITORING→SELLING transition completes"
    why_human: "Requires live Solana connection, real wallet, and real token position"
---

# Phase 7: Position Management Verification Report

**Phase Goal:** Autonomous position exit management — bot monitors open positions via Jupiter price quotes and automatically fires sells on stop-loss, take-profit, or trailing stop conditions
**Verified:** 2026-02-27T20:45:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | config.jsonc loads and validates the positionManagement block without error | VERIFIED | `TradingConfigSchema.safeParse` at line 110 of trading.ts; positionManagement block present in config.jsonc lines 124-146; `pnpm tsc --noEmit` exits 0 |
| 2 | TradingConfig type exposes positionManagement.pollIntervalMs, stopLossPct, tieredTp, trailingStopPct | VERIFIED | `PositionManagementConfigSchema` defined at lines 70-79 of trading.ts; `positionManagement` field on `TradingConfigSchema` at line 93; type inferred via `z.infer` |
| 3 | TradeStore.updateMonitoringAmount() writes amountTokens without changing state | VERIFIED | Dedicated `stmtSetMonitoringAmount` prepared statement at lines 116-119 of trade-store.ts; `updateMonitoringAmount()` method at lines 230-237; WHERE clause restricts to `state = 'MONITORING'` with no state column update |
| 4 | PositionManager polls active positions at the configured interval (recursive setTimeout pattern) | VERIFIED | `scheduleTick()` at lines 105-115 of position-manager.ts uses `setTimeout` with `config.positionManagement.pollIntervalMs`; reschedules in `finally` block — NOT setInterval |
| 5 | Stop-loss fires a sell when position value drops below configured threshold | VERIFIED | Lines 244-259 of position-manager.ts; unit test "fires sell when position value drops below stop-loss threshold" passes (ratio 0.4 < threshold 0.5) |
| 6 | Tiered take-profit sells the configured token percentage at each multiplier, advances to next tier | VERIFIED | Lines 200-223 of position-manager.ts; `calcTieredTpTokens()` at lines 283-287; `tierIndices.set(mint, nextTierIndex)` advances tier; tests for tier 0, tier 1, tier advancement, tier exhaustion all pass |
| 7 | Trailing stop fires a sell when price drops below high watermark by the configured percentage | VERIFIED | Lines 226-242 of position-manager.ts; `newWatermark * (1 - trailingStopPct / 100)` threshold; test "fires sell when price drops below high watermark" passes |
| 8 | TP takes priority over SL when both would trigger in the same poll cycle | VERIFIED | Tiered TP evaluated first at line 203, returns early on trigger; SL check at line 246 is never reached when TP fires; TP-over-SL priority test passes |
| 9 | sellsInFlight guard prevents double-sell on same position | VERIFIED | `sellsInFlight` Set at line 42; guard check at line 144; `fireSell()` adds to Set, `.finally()` removes it; "prevents double-sell" test passes |
| 10 | PumpPortal positions with missing amountTokens are backfilled via on-chain query before monitoring | VERIFIED | Lines 150-160 of position-manager.ts; dual-program query in `getWalletTokenBalance()` at lines 319-346 (TOKEN_PROGRAM_ID + TOKEN_2022_PROGRAM_ID); backfill and zero-balance skip tests pass |
| 11 | Jupiter quote failure on a tick is skipped (returns null), position retried on next tick | VERIFIED | `getPositionValueSol()` returns null on `!resp.ok` or any exception; `evaluatePosition()` returns immediately at line 167; "skips tick when Jupiter quote fails" test passes |
| 12 | Bot rejects new buys when active MONITORING trade count reaches maxConcurrentPositions | VERIFIED | index.ts lines 155-160: `tradeStore.getMonitoringTrades().length >= tradingConfig.maxConcurrentPositions` guard with `log.info` and early return; POS-06 comment present |
| 13 | PositionManager starts after crash recovery and stops as first action in shutdown | VERIFIED | index.ts: `positionManager.start()` at line 141 after `recoveryManager.run()` at line 129; `positionManager.stop()` at line 43 is first action in `shutdown()` function |

**Score:** 13/13 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/config/trading.ts` | PositionManagementConfigSchema, TierSchema, updated TradingConfigSchema and TradingConfig type | VERIFIED | TierSchema at line 65; PositionManagementConfigSchema at line 70; `positionManagement` field at line 93; `PositionManagementConfig` exported type at line 81 |
| `config.jsonc` | positionManagement config block with defaults | VERIFIED | Lines 124-146; pollIntervalMs=5000, stopLossPct=-50, tieredTp=[2x/5x/10x], trailingStopPct=0 |
| `src/persistence/trade-store.ts` | updateMonitoringAmount() prepared statement for PumpPortal token backfill | VERIFIED | `stmtSetMonitoringAmount` private field at line 47; prepared at lines 116-119; `updateMonitoringAmount()` public method at lines 230-237 |
| `src/position/position-manager.ts` | PositionManager class with start/stop, polling loop, price fetch, all exit triggers | VERIFIED | 347-line implementation; all five triggers present; exports `PositionManager` |
| `src/position/position-manager.test.ts` | Unit tests covering all exit trigger branches | VERIFIED | 529-line test file; 16 tests; covers SL, tiered TP (tier 0, tier 1, exhausted, advance), trailing stop, TP priority, sellsInFlight guard, Jupiter failure, PumpPortal backfill, float→bigint, multi-position, lifecycle |
| `src/index.ts` | PositionManager wired into startup sequence and shutdown handler | VERIFIED | Import at line 16; init at lines 113-119; start at line 141 (post-recovery); POS-06 guard at lines 155-160; stop at line 43 in shutdown |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/config/trading.ts` | `config.jsonc` | `TradingConfigSchema.safeParse` at module load | VERIFIED | Line 110: `const configResult = TradingConfigSchema.safeParse(rawConfig)` |
| `src/position/position-manager.ts` | `src/config/trading.ts` | `config.positionManagement` fields | VERIFIED | Lines 66, 78-81, 114, 197: multiple references to `this.config.positionManagement.*` |
| `src/position/position-manager.ts` | `https://api.jup.ag/swap/v1/quote` | global fetch, token→SOL direction | VERIFIED | Line 299: `https://api.jup.ag/swap/v1/quote?inputMint=${mint}&outputMint=${SOL_MINT}&amount=...` |
| `src/position/position-manager.ts` | `src/execution/sell/sell-ladder.ts` | `sellLadder.sell(mint, tokensToSell)` fire-and-forget | VERIFIED | Line 270: `const p = this.sellLadder.sell(mint, tokensToSell)` with `.finally()` cleanup |
| `src/position/position-manager.ts` | `src/persistence/trade-store.ts` | `tradeStore.getMonitoringTrades()` and `tradeStore.updateMonitoringAmount()` | VERIFIED | Line 122: `this.tradeStore.getMonitoringTrades()`; line 158: `this.tradeStore.updateMonitoringAmount(mint, Number(balance))` |
| `src/index.ts (token event handler)` | `tradeStore.getMonitoringTrades()` | position limit guard before createBuyingRecord() | VERIFIED | Line 155: `const activePositions = tradeStore.getMonitoringTrades().length` |
| `src/index.ts (shutdown)` | `positionManager.stop()` | shutdown() function call | VERIFIED | Line 43: `positionManager.stop()` — first action in try block |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| POS-01 | 07-01, 07-02 | Bot monitors active positions by polling Jupiter quotes at configurable intervals | SATISFIED | `scheduleTick()` recursive setTimeout using `positionManagement.pollIntervalMs`; `tick()` calls `getMonitoringTrades()` then evaluates each |
| POS-02 | 07-01, 07-02 | Bot automatically sells when position drops below configurable stop-loss threshold | SATISFIED | Stop-loss check in `evaluatePosition()` at lines 244-259; configurable via `positionManagement.stopLossPct` |
| POS-03 | 07-01, 07-02 | Bot automatically sells when position reaches configurable take-profit target | SATISFIED | Tiered TP at lines 200-223; first tier (at=2) constitutes a standard take-profit |
| POS-04 | 07-01, 07-02 | Bot supports tiered take-profit (e.g., sell 33% at 2x, 33% at 5x, rest at 10x) | SATISFIED | `tieredTp` array config; `tierIndices` Map advances through tiers; `calcTieredTpTokens()` computes per-tier token amount |
| POS-05 | 07-01, 07-02 | Bot supports trailing stop-loss that follows price upward and sells on reversal | SATISFIED | `highWatermarks` Map tracks peak; trailing stop check at lines 226-242; initialized to entry price on first tick |
| POS-06 | 07-03 | Bot enforces configurable maximum concurrent position limit | SATISFIED | index.ts lines 154-160: `getMonitoringTrades().length >= maxConcurrentPositions` guard with log and early return |

No orphaned requirements found. All six POS-0x requirements are accounted for across the three plans.

---

### Anti-Patterns Found

No blocking anti-patterns detected.

| File | Pattern | Severity | Notes |
|------|---------|----------|-------|
| `src/position/position-manager.ts` | `return null` (lines 304, 308) | Info | Intentional — `getPositionValueSol()` returns null on Jupiter failure; caller skips the tick gracefully. Not a stub. |

---

### Human Verification Required

#### 1. Live Jupiter Quote Polling

**Test:** Start the bot with 1-2 real MONITORING positions in the DB and observe logs over 15 seconds.
**Expected:** Log lines at DEBUG level showing "PositionManager tick: evaluating positions" every 5 seconds; `api.jup.ag/swap/v1/quote` requests visible in network traffic.
**Why human:** Cannot invoke real Jupiter API or verify network timing in static analysis.

#### 2. Stop-Loss End-to-End on Mainnet

**Test:** Place a small buy (0.01 SOL) into a low-liquidity token, wait for price to drop below 50% of entry, observe bot behavior.
**Expected:** PositionManager logs "stop-loss triggered" and SellLadder escalates through the sell ladder until COMPLETED.
**Why human:** Requires live Solana RPC, funded wallet, and a real position that declines in value.

---

### Commit Verification

All commits documented in SUMMARYs verified present in git log:

| Commit | Tag | Description |
|--------|-----|-------------|
| `f935e4c` | feat(07-01) | Add PositionManagementConfigSchema to TradingConfig |
| `0d3cafb` | feat(07-01) | Add positionManagement block to config.jsonc |
| `81a7695` | feat(07-01) | Add updateMonitoringAmount() to TradeStore |
| `ba2ba08` | feat(07-02) | Implement PositionManager class with all exit triggers |
| `b417e90` | test(07-02) | Unit tests for PositionManager (16 tests) |
| `cead934` | feat(07-03) | Wire PositionManager into index.ts |

---

### Test Suite Results

- **Total tests:** 178/178 passed (zero failures)
- **PositionManager tests:** 16/16 passed
- **Regressions:** 0 (pre-existing 162 tests all pass)
- **TypeScript:** `pnpm tsc --noEmit` — 0 errors

---

## Gaps Summary

No gaps. All 13 observable truths are VERIFIED. All 6 artifacts pass existence, substance, and wiring checks. All 6 requirements (POS-01 through POS-06) are satisfied with direct code evidence. Two items flagged for human verification are confirmations in a live environment, not blockers to goal achievement — the goal is demonstrably achieved at the code level.

---

_Verified: 2026-02-27T20:45:00Z_
_Verifier: Claude (gsd-verifier)_
