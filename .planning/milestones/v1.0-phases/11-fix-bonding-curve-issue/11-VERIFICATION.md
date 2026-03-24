---
phase: 11-fix-bonding-curve-issue
verified: 2026-03-02T17:12:30Z
status: passed
score: 5/5 must-haves verified
re_verification: false
gaps: []
human_verification: []
---

# Phase 11: Fix Bonding Curve Issue — Verification Report

**Phase Goal:** Fix the holder concentration check that incorrectly counts the Pump.fun bonding curve PDA as a whale holder, causing ~90% of new Pump.fun tokens to fail. Derive bonding curve PDA per-mint and exclude it dynamically, add source-aware zero-holder handling for pumpportal tokens.
**Verified:** 2026-03-02T17:12:30Z
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| #  | Truth                                                                                                                        | Status     | Evidence                                                                                                                                                       |
|----|------------------------------------------------------------------------------------------------------------------------------|------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------|
| 1  | Bonding curve PDA is excluded from holder concentration for all tokens (standard and Token-2022)                             | VERIFIED   | `tier2-holder.ts` lines 107-108 (Token-2022 filter) and lines 149-152 (standard filter) both include `h.owner !== bondingCurvePdaStr`. Tests confirm at lines 245-321. |
| 2  | Pump.fun tokens with only bonding curve + system accounts as holders pass with score=50 when source=pumpportal               | VERIFIED   | `tier2-holder.ts` lines 156-165 return `{pass:true, score:50, detail:'insufficient data...'}` when `source === 'pumpportal'` and `userHolders.length === 0`. Test at line 323 passes. |
| 3  | Non-pumpportal tokens with zero user holders still fail with pass=false, score=0                                             | VERIFIED   | `tier2-holder.ts` lines 167-172 return `{pass:false, score:0}` for all non-pumpportal sources. Test at line 344 (source='raydium') passes. Test for undefined source (existing 8 tests) also passes. |
| 4  | event.source is threaded from SafetyPipeline.evaluate() to checkHolderConcentration()                                       | VERIFIED   | `safety-pipeline.ts` line 105: `checkHolderConcentration(event.mint, this.connection, this.tradingConfig.safety.holder, detectedProgramId, event.source)`. Test at line 384 asserts 5th arg = 'pumpportal'. |
| 5  | All existing tests pass without regression                                                                                   | VERIFIED   | Full suite: 235/235 tests pass across 21 test files. No regressions. TypeScript compiles cleanly (0 errors).                                                 |

**Score:** 5/5 truths verified

---

### Required Artifacts

| Artifact                                    | Expected                                                                          | Status     | Details                                                                                                                                                     |
|---------------------------------------------|-----------------------------------------------------------------------------------|------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `src/safety/checks/tier2-holder.ts`         | Bonding curve PDA derivation and exclusion, source-aware zero-holder logic        | VERIFIED   | File exists, 224 lines. Contains `findProgramAddressSync` (line 58), `PUMP_FUN_PROGRAM_ID` constant (line 19), `source?: string` param (line 50), PDA exclusion in both code paths, and source-aware zero-holder branch. |
| `src/safety/checks/tier2-holder.test.ts`    | 12 tests: 8 existing + 4 new (PDA exclusion standard, PDA exclusion Token-2022, pumpportal zero-holder pass, raydium zero-holder fail) | VERIFIED   | File exists, 432 lines. BONDING_CURVE_ADDR pre-computed at lines 11-16. 4 new tests at lines 245-362. All 12 tests pass.                                    |
| `src/safety/safety-pipeline.ts`             | Source parameter threading to checkHolderConcentration                            | VERIFIED   | File exists, 253 lines. Contains `event.source` as 5th arg on line 105.                                                                                    |
| `src/safety/safety-pipeline.test.ts`        | Updated 'passes detectedProgramId' test to assert 5th arg                        | VERIFIED   | File exists, 413 lines. Test at lines 368-391 asserts 5 args including `'pumpportal'`. All 12 tests pass.                                                   |

---

### Key Link Verification

| From                          | To                                           | Via                                              | Status  | Details                                                                          |
|-------------------------------|----------------------------------------------|--------------------------------------------------|---------|----------------------------------------------------------------------------------|
| `src/safety/safety-pipeline.ts` | `src/safety/checks/tier2-holder.ts`        | `checkHolderConcentration` 5th arg `event.source` | WIRED   | Line 105: `checkHolderConcentration(event.mint, ..., detectedProgramId, event.source)`. Pattern `event\.source` confirmed in call site. Test asserts the arg is passed correctly. |

---

### Requirements Coverage

Phase 11 is declared as a bugfix phase with no new requirements (`requirements: []` in PLAN frontmatter, "None (bugfix phase — no new requirements)" in ROADMAP.md).

REQUIREMENTS.md assigns no requirement IDs to Phase 11. No orphaned requirements found — all v1 requirement IDs are mapped to Phases 1-8 in the traceability table.

**Result:** Requirements coverage check is N/A for this phase. No requirement IDs to account for.

---

### Anti-Patterns Found

| File                                          | Line | Pattern | Severity | Impact |
|-----------------------------------------------|------|---------|----------|--------|
| None found in any modified file               | —    | —       | —        | —      |

Scan covered: `tier2-holder.ts`, `safety-pipeline.ts` — no TODOs, FIXMEs, placeholders, console.log statements, empty implementations, or return stubs detected.

---

### Human Verification Required

None. All goal truths are verifiable programmatically through code inspection and test execution. The fix is a deterministic logic change with unit test coverage for every behavioral branch.

---

### Summary

Phase 11 fully achieves its goal. The three-part fix lands cleanly:

1. **Pump.fun program ID removed from `SYSTEM_ACCOUNTS`** — The static address `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P` was never a token account owner and never matched the filter; it is now repurposed as `PUMP_FUN_PROGRAM_ID` for PDA derivation.

2. **Per-mint bonding curve PDA derived and excluded in both code paths** — `PublicKey.findProgramAddressSync` derives the PDA from `['bonding-curve', mintPubkey]` (CPU-only, zero RPC cost) at lines 58-62, and the resulting address string is excluded from both the Token-2022 filter (line 108) and the standard token filter (line 151).

3. **Source-aware zero-holder logic** — When all holders are filtered out (bonding curve or system accounts only), pumpportal tokens return `pass=true, score=50` with an "insufficient data" detail instead of a hard block. All other sources retain the original `pass=false, score=0` behavior.

4. **`event.source` threaded through** — `SafetyPipeline.evaluate()` passes `event.source` as the optional 5th argument to `checkHolderConcentration`, completing the wiring from detection event to holder check.

The full test suite passes: 235/235 tests across 21 files, TypeScript compiles cleanly. Phase 11 goal is achieved.

---

_Verified: 2026-03-02T17:12:30Z_
_Verifier: Claude (gsd-verifier)_
