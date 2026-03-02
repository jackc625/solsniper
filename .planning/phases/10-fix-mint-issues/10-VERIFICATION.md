---
phase: 10-fix-mint-issues
verified: 2026-03-02T15:28:00Z
status: passed
score: 14/14 must-haves verified
re_verification: false
gaps: []
---

# Phase 10: Fix Mint Issues — Verification Report

**Phase Goal:** Fix Token-2022 compatibility bugs blocking pump.fun create_v2 tokens from the safety pipeline, add Jupiter error code parsing, skip sell-route for new pump.fun tokens, add PumpPortal sell fallback in the sell ladder, and thread token source/programId through the trade lifecycle
**Verified:** 2026-03-02T15:28:00Z
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Token-2022 mints pass Tier 1 authority checks via Pattern A (getAccountInfo + unpackMint with detected programId) | VERIFIED | `tier1-authority.ts` lines 57-69: getAccountInfo → owner detect → unpackMint(pubkey, info, programId) |
| 2 | Retry logic fires on account-not-found using instanceof TokenAccountNotFoundError, not string matching | VERIFIED | `tier1-authority.ts` line 21: `return err instanceof TokenAccountNotFoundError` |
| 3 | checkAuthorities returns detected programId alongside CheckResult tuple for downstream use | VERIFIED | `tier1-authority.ts` line 51: return type `Promise<[CheckResult, CheckResult, PublicKey]>`, line 89 returns `[mintAuthCheck, freezeAuthCheck, programId]` |
| 4 | Jupiter 400 errors throw JupiterRouteError with parsed errorCode (TOKEN_NOT_TRADABLE, NO_ROUTES_FOUND, ROUTE_NOT_FOUND) | VERIFIED | `jupiter-client.ts` lines 87-98 (quote) and 137-148 (swap): specific 400 handler parses JSON body errorCode, throws JupiterRouteError |
| 5 | Pump.fun tokens skip sell-route check at detection time — no false rejection from Jupiter indexing delay | VERIFIED | `tier1-sell-route.ts` lines 28-34: `if (source === 'pumpportal') return pass:true, skipped` |
| 6 | SQLite trades table has source and token_program_id columns; TradeStore stores and reads them | VERIFIED | `schema.ts` lines 18-19: columns declared; `trade-store.ts` lines 76-77: INSERT; lines 92-93: COALESCE UPDATE; lines 102-113: SELECT in get* queries |
| 7 | SafetyPipeline threads detected programId and token source through to TradeStore on BUYING transition | VERIFIED | `safety-pipeline.ts` line 72: checkSellRoute called with event.source; line 75: destructures detectedProgramId; lines 82/124/158/176: buildSafetyResult passes programId |
| 8 | index.ts createBuyingRecord call passes event.source and safetyResult.programId so source/tokenProgramId are persisted from detection time | VERIFIED | `index.ts` line 184: `tradeStore.createBuyingRecord(event.mint, event.source, result.programId)` |
| 9 | PumpPortal sell adapter sends action=sell with pool=auto to trade-local API and returns signature | VERIFIED | `pump-portal-seller.ts` lines 43-55: POST with action:sell, pool:auto; lines 62-67: deserializes bytes, broadcasts, returns signature |
| 10 | Chunked-seller passes correct programId to getAssociatedTokenAddress and getAccount for Token-2022 ATAs | VERIFIED | `chunked-seller.ts` lines 43-49: reads tokenProgramId from tradeStore.getTradeByMint; lines 54-55: passes tokenProgramId to getAssociatedTokenAddress and getAccount |
| 11 | Sell ladder includes PUMPPORTAL step between CHUNKED and EMERGENCY | VERIFIED | `sell-ladder.ts` lines 68-130: 6-step array, PUMPPORTAL at index 4 between CHUNKED(3) and EMERGENCY(5) |
| 12 | PUMPPORTAL step only fires for pumpportal-sourced tokens with Jupiter route failure error codes | VERIFIED | `sell-ladder.ts` lines 106-116: source check + JupiterRouteError instanceof + PUMPPORTAL_TRIGGER_CODES set |
| 13 | Post-buy sell-route verification runs for pumpportal tokens after MONITORING transition with retry/backoff | VERIFIED | `execution-engine.ts` lines 81-83: fire-and-forget void call; lines 110-130: 3 retries at 10s/15s/20s, warn-only on all-fail |
| 14 | SellStep type includes PUMPPORTAL variant | VERIFIED | `types/index.ts` line 94: `type SellStep = 'STANDARD' \| 'HIGH_FEE' \| 'JITO_BUNDLE' \| 'CHUNKED' \| 'PUMPPORTAL' \| 'EMERGENCY'` |

**Score:** 14/14 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/safety/checks/tier1-authority.ts` | Pattern A getMint with dual-program detection | VERIFIED | Exports checkAuthorities returning [CheckResult, CheckResult, PublicKey]; full getAccountInfo+unpackMint pattern; 113 lines, substantive |
| `src/execution/jupiter-client.ts` | JupiterRouteError class, 400 body parsing | VERIFIED | Exports JupiterClient, jupiterClient, JupiterRouteError; 400 handler in both quote() and swap() |
| `src/persistence/schema.ts` | Schema with source and token_program_id columns | VERIFIED | source TEXT and token_program_id TEXT in CREATE TABLE; MIGRATION_SQL array for existing DBs |
| `src/persistence/trade-store.ts` | TradeStore with source/tokenProgramId storage and retrieval | VERIFIED | createBuyingRecord(mint, source?, tokenProgramId?); transition() accepts source/tokenProgramId; getTradeByMint() method; mapRow() maps both columns |
| `src/safety/checks/tier1-sell-route.ts` | Source-aware sell route check | VERIFIED | checkSellRoute accepts source?: DetectionSource; pumpportal early return |
| `src/safety/safety-pipeline.ts` | Pipeline threading source and programId | VERIFIED | event.source passed to checkSellRoute; detectedProgramId destructured from authResults; programId in all buildSafetyResult calls |
| `src/execution/sell/pump-portal-seller.ts` | PumpPortal sell adapter mirroring pump-portal-buyer pattern | VERIFIED | New file; exports pumpPortalSell; 68 lines; mirrors buyer: POST to trade-local, raw bytes, VersionedTransaction, broadcastAndConfirm |
| `src/execution/sell/chunked-seller.ts` | Token-2022-aware ATA derivation using programId from trade record | VERIFIED | getTradeByMint lookup; PublicKey(trade.tokenProgramId) passed to getAssociatedTokenAddress and getAccount; defaults to TOKEN_PROGRAM_ID |
| `src/execution/sell/sell-ladder.ts` | 6-step sell ladder with PUMPPORTAL step and source-aware trigger | VERIFIED | PUMPPORTAL between CHUNKED and EMERGENCY; lastError tracking; PUMPPORTAL_TRIGGER_CODES set; chunkedSell called with this.tradeStore |
| `src/execution/execution-engine.ts` | Post-buy sell-route verification for pumpportal tokens | VERIFIED | schedulePostBuySellRouteVerification private method; fire-and-forget void call; 3 retries; warn-only on all-fail |
| `src/types/index.ts` | SellStep with PUMPPORTAL, Trade with source/tokenProgramId, SafetyResult with programId | VERIFIED | All three type additions present |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `tier1-authority.ts` | `@solana/spl-token unpackMint` | getAccountInfo + info.owner detection | WIRED | Line 65: `info.owner.equals(TOKEN_2022_PROGRAM_ID)` determines programId; line 69: `unpackMint(mintPubkey, info, programId)` |
| `safety-pipeline.ts` | `trade-store.ts` | evaluate() returns programId for TradeStore storage | WIRED | programId flows: checkAuthorities → detectedProgramId → buildSafetyResult(programId) → SafetyResult.programId → index.ts createBuyingRecord |
| `safety-pipeline.ts` | `tier1-sell-route.ts` | source parameter to skip check for pumpportal | WIRED | Line 72: `checkSellRoute(event.mint, undefined, event.source)` |
| `index.ts` | `trade-store.ts` | createBuyingRecord(mint, event.source, safetyResult.programId) | WIRED | Line 184: exact signature match |
| `sell-ladder.ts` | `pump-portal-seller.ts` | PUMPPORTAL step calls pumpPortalSell() | WIRED | Line 117: `return pumpPortalSell(mint, tokenAmount, this.config, this.wallet, this.connections)` |
| `sell-ladder.ts` | `jupiter-client.ts` | JupiterRouteError instanceof check for trigger logic | WIRED | Line 30: PUMPPORTAL_TRIGGER_CODES Set; line 111: `lastError instanceof JupiterRouteError` |
| `chunked-seller.ts` | `trade-store.ts` | getTradeByMint reads tokenProgramId for ATA derivation | WIRED | Lines 44-49: `tradeStore.getTradeByMint(mint)` → `trade.tokenProgramId` → `new PublicKey(...)` |
| `execution-engine.ts` | `jupiter-client.ts` | post-buy sell-route verification with retry | WIRED | Line 21: imports jupiterClient; line 121: `jupiterClient.quote(params)` inside schedulePostBuySellRouteVerification |

---

### Requirements Coverage

Phase 10 is declared a bugfix phase with no requirement IDs in either plan's frontmatter (`requirements: []`). No requirement cross-referencing is applicable. The phase goals are tracked via success criteria in the plan's `<success_criteria>` block rather than formal requirement IDs.

---

### Anti-Patterns Found

No anti-patterns detected in any phase 10 modified files.

| Category | Result |
|----------|--------|
| TODO/FIXME/PLACEHOLDER comments | None found |
| Empty implementations (return null/{}/ []) | None found |
| Console.log-only handlers | None found |
| Stub signatures without bodies | None found |

---

### Test Results

Full test suite executed: **229 tests, 21 test files — all passing, 0 failures**

Plan 01 added tests:
- `tier1-authority.test.ts`: 8 new tests (Token-2022, legacy SPL, instanceof retry, non-retryable)
- `trade-store.test.ts`: 7 new tests (source/tokenProgramId storage, getTradeByMint)
- `jupiter-client.test.ts`: 4 new tests (JupiterRouteError on 400, non-JSON body, 500 generic, instanceof)
- `tier1-sell-route.test.ts`: 3 new tests (pumpportal skip, raydium runs, undefined runs)
- `safety-pipeline.test.ts`: 2 new tests (source threading, programId in SafetyResult)

Plan 02 added tests:
- `pump-portal-seller.test.ts`: 4 new tests (success, HTTP error, body shape, slippage percent)
- `sell-ladder.test.ts`: 4 new tests (PUMPPORTAL fires for pumpportal+route-error, skips for raydium, skips without route error, chunked passes tradeStore)
- `execution-engine.test.ts`: 5 new tests (post-buy verification for pumpportal, not for raydium, fire-and-forget)

---

### Human Verification Required

None — all phase 10 changes are mechanical/algorithmic and fully verifiable via automated tests and static analysis.

---

### Commits Verified

| Commit | Description | Status |
|--------|-------------|--------|
| 1941070 | feat(10-01): fix tier1-authority Pattern A, schema migration, TradeStore source/programId | FOUND in git log |
| 5d15c41 | feat(10-01): Jupiter 400 error parsing, sell-route source skip, safety-pipeline programId threading | FOUND in git log |
| 3f0620e | feat(10-02): PumpPortal sell adapter and chunked-seller Token-2022 ATA fix | FOUND in git log |
| c8e5a01 | feat(10-02): sell ladder PUMPPORTAL step and post-buy sell-route verification | FOUND in git log |

---

### Gaps Summary

No gaps. All 14 must-have truths verified, all artifacts exist and are substantive (not stubs), all key links are wired, no anti-patterns found, and all 229 tests pass with no regressions.

---

_Verified: 2026-03-02T15:28:00Z_
_Verifier: Claude (gsd-verifier)_
