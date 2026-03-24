---
phase: quick-6
plan: "01"
subsystem: position-manager, recovery-manager, sell-ladder
tags: [bug-fix, token-2022, solana-rpc, sell-execution]
dependency_graph:
  requires: []
  provides: [correct-wallet-balance-query, fresh-sell-balance]
  affects: [sell-ladder, position-manager, recovery-manager]
tech_stack:
  added: []
  patterns: [single-mint-only-rpc-query, fresh-on-chain-balance-before-sell]
key_files:
  created: []
  modified:
    - src/position/position-manager.ts
    - src/recovery/recovery-manager.ts
    - src/execution/sell/sell-ladder.ts
    - src/position/position-manager.test.ts
    - src/execution/sell/sell-ladder.test.ts
decisions:
  - "Single {mint} filter in getParsedTokenAccountsByOwner covers both SPL Token and Token-2022 per Solana RPC behaviour -- no dual-query needed"
  - "Fresh balance re-query in sell() entry uses same single-mint pattern -- avoids stale DB tokenAmount and double-counting"
  - "Early-return COMPLETED (not FAILED) when fresh balance is 0 -- wallet empty means sell already landed"
  - "verifiedAmount = min(freshBalance, tokenAmount) -- preserves correct behavior when fresh balance matches or exceeds DB amount"
  - "MINT test fixture changed from TestMint111...11 to valid base58 USDC address -- PublicKey constructor validates base58"
metrics:
  duration_min: 8
  completed_date: "2026-03-08"
  tasks_completed: 2
  files_changed: 5
---

# Quick-6 Summary: Fix sell failure double-counting in getWalletTokenBalance

**One-liner:** Fixed Token-2022 double-counting bug by replacing dual-query (mint + programId) with single mint-only RPC call in position-manager and recovery-manager; added fresh on-chain balance re-query in sell-ladder before executing any sell step.

## What Was Built

### Task 1: Fix getWalletTokenBalance double-counting

**Root cause:** `getWalletTokenBalance()` in both `position-manager.ts` and `recovery-manager.ts` ran two parallel `getParsedTokenAccountsByOwner` calls:
1. One with `{ mint: mintPubKey }` -- returns accounts from ALL token programs (SPL Token AND Token-2022)
2. One with `{ programId: TOKEN_2022_PROGRAM_ID }` -- returns Token-2022 accounts again

For Token-2022 tokens (pump.fun create_v2, Nov 2025+), the same account was counted twice, reporting 2x the actual balance. This caused Jupiter error 6024 (InsufficientFunds) when trying to sell because Jupiter was given a quoted-amount double the actual wallet balance.

**Fix:** Replace dual `Promise.all` with a single `getParsedTokenAccountsByOwner({ mint: mintPubKey })` call. Per Solana RPC documentation and [issue #31923](https://github.com/solana-labs/solana/issues/31923), the `{mint}` filter already searches all token programs. The second query by `{programId: TOKEN_2022_PROGRAM_ID}` was entirely redundant.

Applied to both files (identical fix):
- `src/position/position-manager.ts` (backfill path for PumpPortal trades missing `amountTokens`)
- `src/recovery/recovery-manager.ts` (balance check for BUYING/SELLING trade recovery)

**Tests added (position-manager.test.ts):**
- `makes exactly ONE RPC call (not two) when backfilling Token-2022 token balance` -- asserts `getParsedTokenAccountsByOwner` called exactly once with `{mint}` filter only
- `returns 1x balance for Token-2022 token (not 2x double-count)` -- asserts `updateMonitoringAmount` called with 5000000, not 10000000
- `returns 0n when no accounts found (mint-only query returns empty)` -- asserts no monitoring update on 0 balance

### Task 2: Add fresh balance re-query in sell-ladder

**Root cause:** `SellLadder.sell()` blindly trusted the `tokenAmount` parameter passed from `PositionManager`. This value came from the database and could be:
1. Stale after a prior partial sell (decremented in DB but sell-ladder re-uses old value)
2. Doubled by the position-manager double-counting bug (now fixed in Task 1)

**Fix:** At the entry of `sell()` (after `MONITORING -> SELLING` transition, before building the step array), query the actual on-chain balance using the same single-mint pattern. The `verifiedAmount = min(freshBalance, tokenAmount)` is used for all 6 sell steps (STANDARD, HIGH_FEE, JITO_BUNDLE, CHUNKED, PUMPPORTAL, EMERGENCY).

Additional behavior:
- If `freshBalance === 0n`: transition `SELLING -> COMPLETED` immediately (wallet already empty -- sell may have previously landed)
- If `freshBalance < tokenAmount`: log warning about stale amount, use fresh balance
- Fix partial sell `decrementTokenAmount` to use `verifiedAmount` (fresh) not the stale `tokenAmount` parameter

**Import fix:** Changed `import type { Connection, Keypair }` to `import { PublicKey, type Connection, type Keypair }` -- `PublicKey` is needed as a value (not just a type) for `new PublicKey(mint)`.

**Test fixture fix:** Changed `MINT = 'TestMint111...11'` to valid USDC mainnet address `'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'` -- `new PublicKey(mint)` in sell-ladder now validates base58 encoding.

**Tests added (sell-ladder.test.ts):**
- `sell() re-queries on-chain balance before steps -- uses fresh balance when lower than passed amount`
- `sell() uses fresh balance for all sell steps when stale amount was higher`
- `sell() transitions to COMPLETED when fresh balance is 0 (wallet already empty)`
- `partial sell decrements by fresh balance amount (not stale passed amount)`

## Success Criteria Verification

- [x] `getWalletTokenBalance` makes exactly 1 RPC call (not 2) in both `position-manager.ts` and `recovery-manager.ts`
- [x] Sell ladder queries fresh on-chain balance before executing any sell step
- [x] All sell steps use the fresh balance, not the stale passed `tokenAmount`
- [x] Partial sell decrement uses the amount actually sold (verified/fresh amount)
- [x] All existing tests pass plus new tests for the fix (303/303 tests green)
- [x] TypeScript compiles cleanly (`tsc --noEmit` produces no errors)

## Commits

| Task | Hash | Message |
|------|------|---------|
| 1 | d453d73 | fix(quick-6): fix getWalletTokenBalance double-counting Token-2022 tokens |
| 2 | 9e18473 | feat(quick-6): add fresh balance re-query in sell-ladder before steps |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Changed MINT test fixture to valid base58 pubkey**
- **Found during:** Task 2 GREEN phase
- **Issue:** `MINT = 'TestMint111111111111111111111111111111111111'` is not valid base58. After adding `new PublicKey(mint)` to `sell-ladder.ts`, all 19 existing tests threw `Error: Invalid public key input`
- **Fix:** Changed to valid USDC mainnet address `'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'`
- **Files modified:** `src/execution/sell/sell-ladder.test.ts`
- **Commit:** 9e18473

**2. [Rule 2 - Enhancement] Added mockWallet.publicKey to sell-ladder test fixtures**
- **Found during:** Task 2 RED phase setup
- **Issue:** `mockWallet = {} as unknown as Keypair` had no `publicKey` field. The new `sell()` code accesses `this.wallet.publicKey` for the RPC query
- **Fix:** Added `WALLET_PUBKEY` const and `mockWallet = { publicKey: WALLET_PUBKEY }` and `mockConnection = { getParsedTokenAccountsByOwner: mockGetParsedTokenAccountsByOwner }` with proper setup
- **Files modified:** `src/execution/sell/sell-ladder.test.ts`
- **Commit:** 9e18473

## Self-Check

### Files exist:
- `src/position/position-manager.ts` -- FOUND (modified)
- `src/recovery/recovery-manager.ts` -- FOUND (modified)
- `src/execution/sell/sell-ladder.ts` -- FOUND (modified)
- `src/position/position-manager.test.ts` -- FOUND (modified)
- `src/execution/sell/sell-ladder.test.ts` -- FOUND (modified)

### Commits exist:
- d453d73 -- FOUND
- 9e18473 -- FOUND

## Self-Check: PASSED
