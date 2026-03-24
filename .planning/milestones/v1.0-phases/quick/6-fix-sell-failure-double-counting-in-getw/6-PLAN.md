---
phase: quick-6
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/position/position-manager.ts
  - src/recovery/recovery-manager.ts
  - src/execution/sell/sell-ladder.ts
  - src/position/position-manager.test.ts
  - src/execution/sell/sell-ladder.test.ts
autonomous: true
requirements: [QUICK-6]

must_haves:
  truths:
    - "getWalletTokenBalance returns actual on-chain balance (not 2x) for Token-2022 tokens"
    - "Sell ladder re-queries fresh wallet balance before first sell step instead of trusting passed tokenAmount"
    - "Partial sell decrements by actual sold amount, not stale passed amount"
  artifacts:
    - path: "src/position/position-manager.ts"
      provides: "Fixed getWalletTokenBalance using mint-only query"
      contains: "getParsedTokenAccountsByOwner"
    - path: "src/recovery/recovery-manager.ts"
      provides: "Identical fix to recovery-manager copy"
      contains: "getParsedTokenAccountsByOwner"
    - path: "src/execution/sell/sell-ladder.ts"
      provides: "Fresh balance re-query at sell() entry"
      contains: "getParsedTokenAccountsByOwner"
  key_links:
    - from: "src/position/position-manager.ts"
      to: "Solana RPC"
      via: "getParsedTokenAccountsByOwner with mint filter only"
      pattern: "getParsedTokenAccountsByOwner.*mint"
    - from: "src/execution/sell/sell-ladder.ts"
      to: "Solana RPC"
      via: "Fresh balance query before step loop"
      pattern: "getParsedTokenAccountsByOwner"
---

<objective>
Fix double-counting bug in getWalletTokenBalance() and stale amount usage in sell ladder.

Purpose: getWalletTokenBalance() queries both by {mint} (returns all programs) and by {programId: TOKEN_2022} (returns same Token-2022 accounts again), summing to 2x actual balance. This causes Jupiter error 6024 (InsufficientFunds) when selling Token-2022 tokens. Additionally, sell-ladder steps blindly trust the passed tokenAmount instead of re-querying fresh balance.

Output: Fixed balance query (single mint-only RPC call), fresh balance re-query in sell ladder, updated tests.
</objective>

<execution_context>
@C:/Users/jackc/.claude/get-shit-done/workflows/execute-plan.md
@C:/Users/jackc/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@src/position/position-manager.ts
@src/recovery/recovery-manager.ts
@src/execution/sell/sell-ladder.ts
@src/execution/sell/chunked-seller.ts
@src/position/position-manager.test.ts
@src/execution/sell/sell-ladder.test.ts

<interfaces>
<!-- From position-manager.ts (lines 451-478): -->
```typescript
private async getWalletTokenBalance(mint: string): Promise<bigint>
// Queries getParsedTokenAccountsByOwner twice (legacy + Token-2022), sums both — BUG: double-counts Token-2022
```

<!-- From sell-ladder.ts (line 64): -->
```typescript
async sell(mint: string, tokenAmount: bigint, fallbackSolReceived?: number, partial = false): Promise<SellResult>
// tokenAmount is passed from position-manager's cached DB value — may be stale/doubled
```

<!-- From sell-ladder.ts constructor: -->
```typescript
constructor(wallet: Keypair, connections: Connection[], config: TradingConfig, tradeStore: TradeStore)
// Has this.connections[0] available for RPC queries
```

<!-- From chunked-seller.ts (lines 53-57) — correct pattern to follow: -->
```typescript
const ata = await getAssociatedTokenAddress(mintPubkey, wallet.publicKey, false, tokenProgramId);
const accountInfo = await getAccount(connections[0], ata, undefined, tokenProgramId);
const balance = accountInfo.amount;   // bigint -- exact raw token units
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Fix getWalletTokenBalance double-counting in both position-manager and recovery-manager</name>
  <files>src/position/position-manager.ts, src/recovery/recovery-manager.ts, src/position/position-manager.test.ts</files>
  <behavior>
    - Test: getWalletTokenBalance returns correct (1x) balance for a Token-2022 token (mock getParsedTokenAccountsByOwner with {mint} returning a Token-2022 account)
    - Test: getWalletTokenBalance returns correct balance for legacy SPL token
    - Test: getWalletTokenBalance returns 0n when no accounts found
  </behavior>
  <action>
    Replace the dual-query approach in getWalletTokenBalance() with a single query using {mint} filter only.

    The {mint} filter already searches ALL token programs (both SPL Token and Token-2022) per Solana docs and confirmed by https://github.com/solana-labs/solana/issues/31923. The second query by {programId: TOKEN_2022_PROGRAM_ID} is redundant and causes double-counting.

    In BOTH files (position-manager.ts:451-478 AND recovery-manager.ts:247-279):

    1. Remove the Promise.all with two queries
    2. Replace with single call: `this.connection.getParsedTokenAccountsByOwner(this.walletPubKey, { mint: mintPubKey })`
    3. Sum all returned accounts (covers both SPL and Token-2022 in one query)
    4. Update the JSDoc to explain why only {mint} is used (removes Token-2022 double-count risk)

    The fix is identical in both files since the code comment says "Identical dual-program query to RecoveryManager.getWalletTokenBalance()".

    For tests in position-manager.test.ts: getWalletTokenBalance is private, so test it indirectly through evaluatePosition() backfill path (amountTokens == null triggers getWalletTokenBalance). Mock connection.getParsedTokenAccountsByOwner to return a single account and verify the stored amount is 1x (not 2x). Ensure the mock only receives ONE call (not two).
  </action>
  <verify>
    <automated>cd C:/Users/jackc/Code/solsniper && rtk vitest run src/position/position-manager.test.ts</automated>
  </verify>
  <done>getWalletTokenBalance uses single mint-only query in both position-manager.ts and recovery-manager.ts. No Token-2022 double-counting possible. Tests verify 1x balance returned.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Add fresh balance re-query in sell-ladder and fix partial sell decrement</name>
  <files>src/execution/sell/sell-ladder.ts, src/execution/sell/sell-ladder.test.ts</files>
  <behavior>
    - Test: sell() re-queries on-chain balance and uses fresh value (not the passed tokenAmount) for STANDARD/HIGH_FEE/JITO/PUMPPORTAL/EMERGENCY steps
    - Test: When fresh balance is lower than passed tokenAmount, steps use fresh balance
    - Test: When fresh balance is 0, sell transitions to COMPLETED (wallet already empty)
    - Test: partial sell decrements by actual tokenAmount used (fresh balance), not originally passed amount
  </behavior>
  <action>
    Modify sell-ladder.ts sell() method to re-query actual wallet balance at entry, before building the step array.

    1. Add fresh balance query at the top of sell() (after transition to SELLING, before step array):
       - Use the same single-query pattern: `this.connections[0].getParsedTokenAccountsByOwner(walletPubKey, { mint: mintPubKey })` where walletPubKey = `this.wallet.publicKey`
       - Sum all returned accounts to get `freshBalance: bigint`
       - If freshBalance is 0n: log warning, transition SELLING -> COMPLETED (wallet is empty, possibly already sold), return early with success: true
       - If freshBalance < tokenAmount: log warning about stale amount, use freshBalance
       - Replace tokenAmount usage in step array with the verified amount
       - Import PublicKey from @solana/web3.js (already imported as type — change to value import)

    2. Fix partial sell decrement (line 227):
       - Change `this.tradeStore.decrementTokenAmount(mint, Number(tokenAmount))` to use the actual amount that was sold (the verified/fresh tokenAmount used in the step), not the originally passed value

    3. Add required import for PublicKey (ensure it's a value import, not just type import):
       - Line 15 currently has `import type { Connection, Keypair } from '@solana/web3.js'`
       - Change to: `import { PublicKey, type Connection, type Keypair } from '@solana/web3.js'`

    For tests: Mock connection's getParsedTokenAccountsByOwner on connections[0] to return controlled balances. Verify that when passed tokenAmount=200n but fresh balance=100n, the standardSell mock receives 100n (not 200n).
  </action>
  <verify>
    <automated>cd C:/Users/jackc/Code/solsniper && rtk vitest run src/execution/sell/sell-ladder.test.ts</automated>
  </verify>
  <done>Sell ladder re-queries fresh wallet balance before selling. STANDARD, HIGH_FEE, JITO, PUMPPORTAL, and EMERGENCY steps all use verified fresh amount. Partial sell decrement uses correct amount. Tests confirm fresh balance is used over stale passed value.</done>
</task>

</tasks>

<verification>
Run full test suite to confirm no regressions:
```bash
cd C:/Users/jackc/Code/solsniper && rtk vitest run
```

TypeScript compilation check:
```bash
cd C:/Users/jackc/Code/solsniper && rtk tsc --noEmit
```
</verification>

<success_criteria>
- getWalletTokenBalance makes exactly 1 RPC call (not 2) in both position-manager.ts and recovery-manager.ts
- Sell ladder queries fresh on-chain balance before executing any sell step
- All sell steps use the fresh balance, not the stale passed tokenAmount
- Partial sell decrement uses the amount actually sold
- All existing tests pass plus new tests for the fix
- TypeScript compiles cleanly
</success_criteria>

<output>
After completion, create `.planning/quick/6-fix-sell-failure-double-counting-in-getw/6-SUMMARY.md`
</output>
