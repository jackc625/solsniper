---
phase: 19-execution-performance
verified: 2026-03-30T20:03:00Z
status: gaps_found
score: 9/10 must-haves verified
re_verification: false
gaps:
  - truth: "Jito seller replaces Jupiter's CU limit instruction with simulated CU + 15% buffer (test coverage)"
    status: partial
    reason: "Production code in jito-seller.ts fully implements CU replacement, but the jito-seller.test.ts is missing the 'CU replacement success' test case that Plan 02 acceptance criteria required — only graceful-failure and fee tests are present"
    artifacts:
      - path: "src/execution/sell/jito-seller.test.ts"
        issue: "Missing test case: 'replaces CU limit instruction' — should mock simulateTransaction returning unitsConsumed=150000 and verify rebuilt VersionedTransaction uses Math.ceil(150000*1.15)=172500 as CU limit"
    missing:
      - "Add test case verifying successful CU replacement: mock simulateTransaction to return { value: { unitsConsumed: 150000 } }, verify a new VersionedTransaction is constructed with ComputeBudgetProgram setComputeUnitLimit data containing 172500 units"
  - truth: "EXE-12 marked complete in REQUIREMENTS.md"
    status: failed
    reason: "REQUIREMENTS.md shows EXE-12 as unchecked '[ ]' and status 'Pending' in the phase table, but src/index.ts fully implements balance guard per plan spec"
    artifacts:
      - path: ".planning/REQUIREMENTS.md"
        issue: "Line 29: '- [ ] **EXE-12**' should be '- [x] **EXE-12**'; line 96: status 'Pending' should be 'Complete'"
    missing:
      - "Update REQUIREMENTS.md: mark EXE-12 as [x] and change phase table status from Pending to Complete"
human_verification:
  - test: "Verify balance guard fires correctly in live bot"
    expected: "When wallet SOL drops below buyAmountSol + minBalanceBufferSol, token detection events are skipped and LOW_BALANCE event appears in SSE feed"
    why_human: "Requires live wallet with controlled SOL balance and active token detection stream"
  - test: "Verify CU simulation + replacement reduces overpay in Jito sell path"
    expected: "After a Jito sell, the on-chain CU consumed matches approximately simulatedCU + 15% buffer rather than Jupiter's default 200K"
    why_human: "Requires live Jito bundle submission against mainnet to observe actual CU usage"
---

# Phase 19: Execution Performance Verification Report

**Phase Goal:** Bot lands buys with optimal fees and protects against wallet drain — dynamic priority fees replace static fees, compute units are precise, and a balance guard prevents buying below operational minimums
**Verified:** 2026-03-30T20:03:00Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | FeeEstimator fetches from Helius getPriorityFeeEstimate and converts microlamports/CU to total lamports | VERIFIED | `src/core/fee-estimator.ts` line 43: `method: 'getPriorityFeeEstimate'`; line 63: `Math.ceil(microlamportsPerCU * ESTIMATED_CU / 1_000_000)` |
| 2 | FeeEstimator falls back to static config values when Helius call fails | VERIFIED | `src/core/fee-estimator.ts` lines 69-76: catch block uses `buy.priorityFeeBaseLamports * buy.priorityFeeMultiplier` |
| 3 | FeeEstimator caches estimates with 5-second TTL | VERIFIED | `src/core/fee-estimator.ts` constructor default `ttlMs = 5000`; cache set at line 60 |
| 4 | FeeEstimator enforces maxPriorityFeeCapLamports ceiling | VERIFIED | `src/core/fee-estimator.ts` line 64: `Math.min(totalLamports, cap)` |
| 5 | All 4 buyer/seller paths use FeeEstimator instead of static calculation | VERIFIED | `jupiter-buyer.ts` line 29, `pump-portal-buyer.ts` line 29, `standard-seller.ts` line 46, `pump-portal-seller.ts` line 43, `jito-seller.ts` line 58 all call `feeEstimator.getEstimate(config)` |
| 6 | Jito seller simulates CU, replaces Jupiter's CU limit instruction with tighter value in MessageV0 | VERIFIED (code) | `src/execution/sell/jito-seller.ts` lines 108-170: full simulation, discriminator 0x02 matching, MessageV0 rebuild, re-sign implemented |
| 7 | Jito CU replacement test coverage exists | FAILED | `jito-seller.test.ts` has graceful-failure test and fixed-tip test but is missing the success-path CU replacement test required by Plan 02 acceptance criteria |
| 8 | BalanceGuard checks wallet SOL balance against buyAmountSol + minBalanceBufferSol | VERIFIED | `src/core/balance-guard.ts` line 37: `thresholdSol = buyAmountSol + minBufferSol` |
| 9 | Balance guard wired into detection handler after max-positions check, before safetyPipeline | VERIFIED | `src/index.ts` lines 185-206: EXE-12 block placed between max-positions guard (183) and `safetyPipeline.evaluate` (208) |
| 10 | EXE-12 status updated in REQUIREMENTS.md | FAILED | REQUIREMENTS.md line 29 still shows `[ ]` (unchecked); phase table line 96 shows `Pending` — code is fully implemented but tracking not updated |

**Score:** 8/10 truths verified (9/10 if counting the REQUIREMENTS.md mismatch separately from the test gap)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/core/fee-estimator.ts` | Helius fee estimation with cache, cap, fallback | VERIFIED | 80 lines, exports `FeeEstimator` class and `FeeEstimate` interface, full implementation |
| `src/core/fee-estimator.test.ts` | 6+ unit tests covering fetch, fallback, cache, cap, priorityFeeSol | VERIFIED | 207 lines, 7 test cases, all passing |
| `src/core/balance-guard.ts` | Wallet balance check with cache and threshold logic | VERIFIED | 53 lines, exports `BalanceGuard` and `BalanceCheckResult`, full implementation |
| `src/core/balance-guard.test.ts` | 5+ unit tests covering sufficient, insufficient, cache, invalidate | VERIFIED | 116 lines, 5 test cases, all passing |
| `src/config/trading.ts` | Contains `maxPriorityFeeCapLamports` and `minBalanceBufferSol` | VERIFIED | Line 47: `maxPriorityFeeCapLamports: z.number().int().positive().default(500000)`; line 97: `minBalanceBufferSol: z.number().positive().default(0.01)` |
| `src/dashboard/bot-event-bus.ts` | Contains `LOW_BALANCE` event type | VERIFIED | Line 14: `'LOW_BALANCE'; // EXE-12` in BotEventType union |
| `src/execution/buy/jupiter-buyer.ts` | Jupiter buy with dynamic Helius fee cap | VERIFIED | Line 29: `feeEstimator.getEstimate(config)`, static calc removed |
| `src/execution/buy/pump-portal-buyer.ts` | PumpPortal buy with dynamic Helius fee | VERIFIED | Line 29: `feeEstimator.getEstimate(config)`, static calc removed |
| `src/execution/sell/standard-seller.ts` | Jupiter sell with dynamic fee base + multiplier | VERIFIED | Lines 46-50: dynamic base, `feeMultiplier` applied, capped at `maxPriorityFeeCapLamports` |
| `src/execution/sell/pump-portal-seller.ts` | PumpPortal sell with dynamic Helius fee | VERIFIED | Line 43: `feeEstimator.getEstimate(config)` |
| `src/execution/sell/jito-seller.ts` | Jito sell with dynamic fee + CU simulation + CU instruction replacement | VERIFIED | Lines 58-62: dynamic fee; lines 108-170: full CU simulation + MessageV0 rebuild; `ComputeBudgetProgram.setComputeUnitLimit` at line 136 |
| `src/execution/sell/sell-ladder.ts` | SellLadder accepts and passes FeeEstimator | VERIFIED | Constructor field `feeEstimator: FeeEstimator` at line 40; passed to all sell functions |
| `src/execution/execution-engine.ts` | ExecutionEngine accepts and passes FeeEstimator | VERIFIED | Constructor field `feeEstimator: FeeEstimator` at line 37; passed to buy functions |
| `src/index.ts` | FeeEstimator and BalanceGuard instantiated and wired | VERIFIED | Line 106: `new FeeEstimator(env.SOLSNIPER_RPC_URL)`; line 128: `new BalanceGuard(5000)`; balance check at 185-206 |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/core/fee-estimator.ts` | Helius RPC | `fetch POST` with `getPriorityFeeEstimate` | WIRED | Line 43 in fee-estimator.ts confirms `method: 'getPriorityFeeEstimate'` |
| `src/core/balance-guard.ts` | `Connection.getBalance` | RPC call with `'processed'` commitment | WIRED | Line 32: `connection.getBalance(wallet, 'processed')` |
| `src/execution/buy/jupiter-buyer.ts` | `src/core/fee-estimator.ts` | `import FeeEstimator`, call `getEstimate` | WIRED | Line 14: type import; line 29: `feeEstimator.getEstimate(config)` |
| `src/execution/sell/jito-seller.ts` | `connection.simulateTransaction` | CU simulation then instruction replacement | WIRED | Lines 109-112: `connections[0].simulateTransaction(finalSwapTx, ...)` |
| `src/execution/sell/jito-seller.ts` | `ComputeBudgetProgram` | `setComputeUnitLimit` instruction replacement | WIRED | Lines 120, 136: `ComputeBudgetProgram.programId` and `.setComputeUnitLimit` |
| `src/index.ts` | `src/core/balance-guard.ts` | `import BalanceGuard`, call `check()` in token handler | WIRED | Line 21: import; lines 187-192: `balanceGuard.check(...)` |
| `src/index.ts` | `src/dashboard/bot-event-bus.ts` | emit `LOW_BALANCE` event when balance insufficient | WIRED | Lines 195-200: `botEventBus.emit('event', { type: 'LOW_BALANCE', ... })` |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `src/core/fee-estimator.ts` | `microlamportsPerCU` | Helius RPC JSON response `json.result.priorityFeeEstimate` | Yes (with fallback to config) | FLOWING |
| `src/core/balance-guard.ts` | `lamports` | `connection.getBalance(wallet, 'processed')` — live RPC call | Yes (with 5s cache) | FLOWING |
| `src/index.ts` | `balanceCheck` | `balanceGuard.check(...)` → live balance → threshold comparison | Yes | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| fee-estimator unit tests pass | `npx vitest run src/core/fee-estimator.test.ts` | 7/7 tests pass | PASS |
| balance-guard unit tests pass | `npx vitest run src/core/balance-guard.test.ts` | 5/5 tests pass | PASS |
| jupiter-buyer dynamic fee test passes | `npx vitest run src/execution/buy/jupiter-buyer.test.ts` | 6/6 tests pass including `uses dynamic fee from FeeEstimator` | PASS |
| pump-portal-buyer dynamic fee test passes | `npx vitest run src/execution/buy/pump-portal-buyer.test.ts` | 5/5 tests pass including `uses dynamic fee from FeeEstimator` | PASS |
| standard-seller dynamic fee + cap tests pass | `npx vitest run src/execution/sell/standard-seller.test.ts` | 5/5 tests pass including fee + cap cases | PASS |
| pump-portal-seller dynamic fee test passes | `npx vitest run src/execution/sell/pump-portal-seller.test.ts` | 5/5 tests pass | PASS |
| jito-seller CU failure graceful test passes | `npx vitest run src/execution/sell/jito-seller.test.ts` | 10/10 tests pass; graceful CU failure verified | PASS |
| jito-seller CU replacement success test | `npx vitest run src/execution/sell/jito-seller.test.ts` | No test exists for successful CU replacement path | FAIL (missing) |
| No static fee calculations in execution files | `grep "priorityFeeBaseLamports \*" src/execution/**/*.ts` | No matches | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|---------|
| EXE-10 | 19-01, 19-02 | Bot uses dynamic priority fees via Helius getPriorityFeeEstimate | SATISFIED | FeeEstimator wired into all 5 buyer/seller paths; static calcs removed |
| EXE-11 | 19-01, 19-02 | Bot sets precise compute unit limits via ComputeBudgetProgram | SATISFIED | jito-seller.ts lines 108-170 implement full CU simulation + MessageV0 rebuild + re-sign |
| EXE-12 | 19-01, 19-03 | Bot checks wallet SOL balance before buying — skips if below minimum | SATISFIED (code), NOT UPDATED (tracking) | `src/index.ts` lines 185-206 fully implement balance guard; REQUIREMENTS.md still marks as `[ ]` Pending |

**Note on EXE-12:** The implementation is complete and correct. REQUIREMENTS.md is simply stale — it was not updated after Plan 03 completed. This is a documentation gap, not an implementation gap.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `.planning/REQUIREMENTS.md` | 29, 96 | EXE-12 marked `[ ]` and `Pending` when code is fully implemented | Info | Misleading tracking state — future phases or reporting may incorrectly show EXE-12 as unimplemented |
| `src/execution/sell/jito-seller.test.ts` | — | Missing "CU replacement success" test case | Warning | The success path of CU instruction replacement in jito-seller is untested at the unit level — only the failure/graceful-degradation path is tested |

### Human Verification Required

#### 1. Balance Guard Live Behavior

**Test:** Run the bot with wallet balance set below `buyAmountSol + minBalanceBufferSol`. Trigger a token detection event.
**Expected:** Bot logs a warning, emits `LOW_BALANCE` event visible in the SSE stream at `/api/events`, and does not proceed to safety pipeline evaluation.
**Why human:** Requires live bot session with controlled wallet balance and active detection stream.

#### 2. Jito CU Simulation Reduces Transaction Cost

**Test:** Execute a Jito bundle sell on mainnet and compare the actual CU consumed (on-chain) to Jupiter's default CU allocation.
**Expected:** Actual CU consumed should be approximately `simulatedCU * 1.15` — substantially less than the Jupiter-default 200K, reducing transaction cost.
**Why human:** Requires live Jito bundle submission to mainnet; can't verify CU savings programmatically without executing transactions.

### Gaps Summary

Two gaps were found:

**Gap 1 — Missing test (warning severity):** `jito-seller.test.ts` is missing the "CU replacement success" test case that Plan 02 acceptance criteria explicitly required. The production code in `jito-seller.ts` lines 108-170 is complete and correct — it simulates the transaction, finds the `ComputeBudgetProgram.setComputeUnitLimit` instruction via discriminator byte `0x02`, replaces its data with `Math.ceil(cuConsumed * 1.15)`, rebuilds MessageV0, and re-signs. But there is no unit test that verifies this success path. The test suite only covers graceful degradation (simulation throws → falls back to original tx). This does not block EXE-11 from being considered satisfied at the implementation level, but the test coverage gap was an explicit deliverable.

**Gap 2 — Stale REQUIREMENTS.md (info severity):** EXE-12 is fully implemented in `src/index.ts` but REQUIREMENTS.md still shows it as unchecked `[ ]` with status `Pending` in the phase table. This is a documentation tracking issue — the code satisfies the requirement, the tracking just wasn't updated when Plan 03 completed.

Neither gap constitutes a functional regression. The phase goal — "Bot lands buys with optimal fees and protects against wallet drain" — is achieved in the implementation. The gaps are a missing unit test for an existing feature and a stale tracking file.

---

_Verified: 2026-03-30T20:03:00Z_
_Verifier: Claude (gsd-verifier)_
