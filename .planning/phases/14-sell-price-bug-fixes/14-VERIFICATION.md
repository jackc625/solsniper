---
phase: 14-sell-price-bug-fixes
verified: 2026-03-04T15:30:00Z
status: passed
score: 19/19 must-haves verified
gaps: []
human_verification: []
---

# Phase 14: Sell Price Bug Fixes Verification Report

**Phase Goal:** Fix sell price bugs — sellers return actual SOL received, P&L formula corrected throughout codebase (sell-ladder, trade-store, dashboard SQL)
**Verified:** 2026-03-04T15:30:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

All 19 truths from plans 14-01, 14-02, and 14-03 are verified.

**Plan 14-01 Truths**

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | standardSell returns `SellOutcome { signature, solReceived }` | VERIFIED | `standard-seller.ts:78` — `return { signature: result.signature, solReceived };` |
| 2 | jitoSell returns `SellOutcome { signature, solReceived }` from quoteResponse.outAmount | VERIFIED | `jito-seller.ts:79` — `const solReceived = Number(quoteResponse.outAmount) / 1e9`; `jito-seller.ts:149` — `return { signature: swapSignature, solReceived };` |
| 3 | pumpPortalSell returns `SellOutcome { signature, solReceived }` parsed from on-chain tx | VERIFIED | `pump-portal-seller.ts:69-72` — calls `parseSolReceived(result.signature, wallet.publicKey, connections[0])` then returns `{ signature: result.signature, solReceived }` |
| 4 | chunkedSell returns `ChunkedSellOutcome { confirmedTranches, solReceived }` accumulated | VERIFIED | `chunked-seller.ts:83-84,92` — accumulates `totalSolReceived` per tranche; returns `{ confirmedTranches, solReceived: totalSolReceived > 0 ? totalSolReceived : undefined }` |
| 5 | parseSolReceived is a shared utility reusable by both pump-portal-seller and sell-ladder | VERIFIED | `src/utils/parse-sol-received.ts` exists; imported in `pump-portal-seller.ts:14` and `sell-ladder.ts:27` |

**Plan 14-02 Truths**

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 6 | SellLadder passes sellPriceSol to tradeStore.transition() when a sell step succeeds | VERIFIED | `sell-ladder.ts:213-216` — `this.tradeStore.transition(mint, 'SELLING', 'COMPLETED', { sellSignature: signature, sellPriceSol: solReceived })` |
| 7 | SellLadder computes pnlSol as sellPriceSol - amountSol | VERIFIED | `sell-ladder.ts:221-223` — `pnlSol = completedTrade.sellPriceSol - completedTrade.amountSol` (comment explicitly notes it was wrong before) |
| 8 | SELL_CONFIRMED event carries correct pnlSol from sellPriceSol - amountSol | VERIFIED | `sell-ladder.ts:224` — `botEventBus.emit('event', { type: 'SELL_CONFIRMED', ..., pnlSol })` where pnlSol uses corrected formula |
| 9 | For tiered partial sells, sellPriceSol accumulates incrementally via addSellPrice() | VERIFIED | `sell-ladder.ts:197-209` — `hasPriorSellPrice` detection triggers `this.tradeStore.addSellPrice(mint, solReceived)` and SELL_PARTIAL emission |
| 10 | SELL_PARTIAL event is emitted per tier fire with SOL received for that tier | VERIFIED | `sell-ladder.ts:200-208` — emits `{ type: 'SELL_PARTIAL', ..., pnlSol: solReceived, detail: '${step.name}: +X SOL (total: Y SOL)' }` |
| 11 | TradeStore.addSellPrice() adds delta SOL to sell_price_sol without state change | VERIFIED | `trade-store.ts:134-139,287-294` — SQL uses `COALESCE(sell_price_sol, 0) + @delta`; method returns changes count, no state transition |
| 12 | EMERGENCY step uses on-chain parseSolReceived instead of quoteResponse.outAmount | VERIFIED | `sell-ladder.ts:168-177` — `if (step.name === 'EMERGENCY' && signature)` block calls `parseSolReceived` and overrides `solReceived` |
| 13 | On-chain parse failure falls back to lastKnownQuoteSol from PositionManager | VERIFIED | `sell-ladder.ts:182-185` — `if (stepSucceeded && solReceived == null && fallbackSolReceived != null) solReceived = fallbackSolReceived` |

**Plan 14-03 Truths**

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 14 | Dashboard history endpoint computes pnl_sol as sell_price_sol - amount_sol | VERIFIED | `trades.ts:45-47` — `CASE WHEN sell_price_sol IS NOT NULL AND amount_sol IS NOT NULL THEN sell_price_sol - amount_sol ELSE NULL END as pnl_sol` |
| 15 | Dashboard stats endpoint computes total_pnl_sol as SUM(sell_price_sol - amount_sol) | VERIFIED | `trades.ts:71-72` — `SUM(CASE WHEN sell_price_sol IS NOT NULL AND amount_sol IS NOT NULL THEN sell_price_sol - amount_sol ELSE 0 END) as total_pnl_sol` |
| 16 | Win rate denominator only counts trades with sell_price_sol IS NOT NULL | VERIFIED | `trades.ts:75,82-83` — `total_with_pnl = SUM(CASE WHEN sell_price_sol IS NOT NULL THEN 1 ELSE 0 END)`; win rate uses `completedRow.total_with_pnl` as denominator |
| 17 | Legacy trades with NULL sell_price_sol show NULL pnl_sol (not zero) | VERIFIED | `trades.ts:47` — `ELSE NULL END as pnl_sol` (history endpoint); stats uses `ELSE 0` only for SUM aggregate (conventional) |

**Additional Cross-Cutting Truths**

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 18 | PositionManager tracks lastKnownQuoteSol and passes as fallback to SellLadder.sell() | VERIFIED | `position-manager.ts:54` — `private readonly lastKnownQuoteSol = new Map<string, number>()`; `position-manager.ts:232` — `this.lastKnownQuoteSol.set(mint, currentValueSol)`; `position-manager.ts:393-394` — `const fallbackSolValue = this.lastKnownQuoteSol.get(mint)`; `this.sellLadder.sell(mint, tokensToSell, fallbackSolValue)` |
| 19 | SellOutcome and ChunkedSellOutcome interfaces exist in src/types/index.ts | VERIFIED | `types/index.ts:117-127` — both interfaces defined with correct optional `solReceived` field |

**Score:** 19/19 truths verified

---

## Required Artifacts

### Plan 14-01 Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/types/index.ts` | SellOutcome and ChunkedSellOutcome interfaces | VERIFIED | Lines 117-127 — both interfaces present with correct shapes |
| `src/utils/parse-sol-received.ts` | Shared on-chain SOL balance delta parser | VERIFIED | 56-line implementation; exports `parseSolReceived` async function |
| `src/execution/sell/standard-seller.ts` | standardSell returning SellOutcome with solReceived | VERIFIED | Line 59 extracts `solReceived = Number(quoteResponse.outAmount) / 1e9`; line 78 returns `{ signature, solReceived }` |
| `src/execution/sell/jito-seller.ts` | jitoSell returning SellOutcome with solReceived | VERIFIED | Line 79 extracts solReceived; line 149 returns `{ signature: swapSignature, solReceived }`; dry-run returns `{ signature, solReceived: undefined }` at line 66 |
| `src/execution/sell/pump-portal-seller.ts` | pumpPortalSell returning SellOutcome via parseSolReceived | VERIFIED | Imports `parseSolReceived` at line 14; calls it at line 69; returns `{ signature, solReceived }` at line 72 |
| `src/execution/sell/chunked-seller.ts` | chunkedSell returning ChunkedSellOutcome with accumulated solReceived | VERIFIED | Imports `ChunkedSellOutcome` at line 17; accumulates across tranches; returns `{ confirmedTranches, solReceived }` |
| `src/execution/sell/standard-seller.test.ts` | Tests for SellOutcome return type | VERIFIED | 3 substantive tests asserting `{ signature, solReceived }` shape and lamport-to-SOL conversion |
| `src/execution/sell/chunked-seller.test.ts` | Tests for ChunkedSellOutcome return type | VERIFIED | 3 substantive tests including partial-tranche accumulation test |

### Plan 14-02 Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/execution/sell/sell-ladder.ts` | SellLadder with solReceived threading, SELL_PARTIAL, EMERGENCY on-chain parse | VERIFIED | 244 lines; imports `parseSolReceived`; full implementation of all requirements |
| `src/persistence/trade-store.ts` | addSellPrice method for incremental sell_price_sol accumulation | VERIFIED | Method at lines 287-294; stmtAddSellPrice prepared statement at lines 134-139 |
| `src/dashboard/bot-event-bus.ts` | SELL_PARTIAL added to BotEventType union | VERIFIED | Line 9 — `'SELL_PARTIAL'` in BotEventType with comment |
| `src/position/position-manager.ts` | lastKnownQuoteSol Map tracking and passing to SellLadder | VERIFIED | Map at line 54; set at line 232; passed to sell() at line 394 |
| `src/execution/sell/sell-ladder.test.ts` | Tests verifying sellPriceSol threading, pnlSol formula | VERIFIED | New Plan 02 tests at lines 396-480+ cover: sellPriceSol threading, pnlSol formula correctness, chunked sellPriceSol accumulation, fallbackSolReceived usage |

### Plan 14-03 Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/dashboard/routes/trades.ts` | Corrected SQL for P&L computation and win rate | VERIFIED | Both SQL query blocks use `sell_price_sol - amount_sol`; win rate uses `total_with_pnl` denominator and `wins` numerator |
| `src/dashboard/routes/trades.test.ts` | Tests verifying corrected SQL formulas | VERIFIED | 5 tests asserting formula correctness via source-reading approach |

---

## Key Link Verification

### Plan 14-01 Key Links

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `standard-seller.ts` | `jupiterClient.quote` | `Number(quoteResponse.outAmount) / 1e9` | WIRED | Line 59 — pattern matches `Number.*outAmount` then divides by `1e9` |
| `pump-portal-seller.ts` | `parse-sol-received.ts` | `parseSolReceived` import + call | WIRED | Import at line 14; called at line 69 with `result.signature, wallet.publicKey, connections[0]` |
| `chunked-seller.ts` | `standard-seller.ts` | Destructures SellOutcome from standardSell calls | WIRED | Line 75-84 — `const outcome = await standardSell(...)`; `if (outcome.solReceived != null) totalSolReceived += outcome.solReceived` |

### Plan 14-02 Key Links

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `sell-ladder.ts` | `trade-store.ts` | `transition()` with `sellPriceSol: solReceived` | WIRED | Line 213-216 — `this.tradeStore.transition(mint, 'SELLING', 'COMPLETED', { sellSignature: signature, sellPriceSol: solReceived })` |
| `sell-ladder.ts` | `parse-sol-received.ts` | Imports `parseSolReceived` for EMERGENCY step | WIRED | Import at line 27; called at line 169 inside EMERGENCY step override block |
| `sell-ladder.ts` | `bot-event-bus.ts` | `SELL_PARTIAL` event emission per tiered TP fire | WIRED | Line 201-208 — emits `{ type: 'SELL_PARTIAL', ... }` within `hasPriorSellPrice` block |
| `position-manager.ts` | `sell-ladder.ts` | Passes `lastKnownQuoteSol` when calling `sell()` | WIRED | Line 394 — `this.sellLadder.sell(mint, tokensToSell, fallbackSolValue)` where `fallbackSolValue = this.lastKnownQuoteSol.get(mint)` |
| `trade-store.ts` | SQLite | `addSellPrice` uses `COALESCE(sell_price_sol, 0) + delta` | WIRED | Lines 134-139 — prepared statement SQL: `sell_price_sol = COALESCE(sell_price_sol, 0) + @delta` |

### Plan 14-03 Key Links

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `trades.ts` | SQLite trades table | SQL queries using `sell_price_sol - amount_sol` | WIRED | History query line 45-47; stats query lines 71-74; both use corrected formula |

---

## Requirements Coverage

All three plans declare `requirements: []`. No requirement IDs were claimed by any plan for phase 14.

Checked REQUIREMENTS.md for any phase 14 references — none found. This is documented as a bugfix phase with no new requirements.

**Result:** No orphaned requirements to report.

---

## Anti-Patterns Found

None detected in any phase 14 modified files:

- No `TODO`, `FIXME`, `XXX`, `HACK`, or `PLACEHOLDER` comments
- No `return null`, `return {}`, or `return []` stub returns in seller functions
- No empty handlers or unimplemented placeholders
- No `console.log`-only implementations

---

## Human Verification Required

None. All automated checks passed. The following items are verifiable programmatically and were confirmed:

- SQL formula correctness (verified by source-reading tests in `trades.test.ts`)
- `SellOutcome`/`ChunkedSellOutcome` return types (verified by seller-level unit tests)
- `sellPriceSol` threading to `tradeStore.transition()` (verified by sell-ladder tests)
- `pnlSol = sellPriceSol - amountSol` formula (verified by sell-ladder test with captured events)
- EMERGENCY on-chain parse override (wired via grep and code inspection)
- `parseSolReceived` fallback chain (wired via grep and code inspection)

---

## Commit Verification

All implementation commits exist and match the file modifications documented in SUMMARYs:

| Commit | Description | Status |
|--------|-------------|--------|
| `81a849b` | Wave 0 test scaffolds for standard-seller and chunked-seller | VERIFIED |
| `f23a685` | SellOutcome/ChunkedSellOutcome from all sellers + parseSolReceived utility | VERIFIED |
| `97d6a45` | addSellPrice, SELL_PARTIAL event, lastKnownQuoteSol tracking | VERIFIED |
| `dab54e6` | Thread solReceived through SellLadder, fix pnlSol formula, EMERGENCY on-chain parse | VERIFIED |
| `f358697` | Dashboard P&L SQL formula tests (Wave 0) | VERIFIED |
| `e32a1ba` | Fix dashboard P&L SQL and win rate denominator | VERIFIED |

---

## Summary

Phase 14 fully achieves its goal. The root bug — `sell_price_sol` staying NULL in SQLite because sellers returned bare strings instead of structured outcomes — is fixed at every layer:

1. **Seller layer (Plan 01):** All four sellers (`standardSell`, `jitoSell`, `pumpPortalSell`, `chunkedSell`) now return structured `SellOutcome` or `ChunkedSellOutcome` objects containing `solReceived`. The `parseSolReceived` shared utility enables on-chain pre/post balance delta parsing for PumpPortal sells and the EMERGENCY ladder step.

2. **SellLadder/persistence layer (Plan 02):** SellLadder extracts `solReceived` from seller outcomes and passes it as `sellPriceSol` to `tradeStore.transition()` on every successful sell. The pnlSol formula is corrected from `sellPriceSol - buyPriceSol` (wrong: per-token unit comparison) to `sellPriceSol - amountSol` (correct: total received minus total spent). TradeStore gains `addSellPrice()` for crash-safe incremental accumulation in tiered TP scenarios. PositionManager provides a fallback SOL quote value when on-chain parse fails.

3. **Dashboard layer (Plan 03):** Both SQL queries in the dashboard routes are corrected from `sell_price_sol - buy_price_sol` to `sell_price_sol - amount_sol`. Win rate denominator now excludes legacy trades with NULL `sell_price_sol`.

---

_Verified: 2026-03-04T15:30:00Z_
_Verifier: Claude (gsd-verifier)_
