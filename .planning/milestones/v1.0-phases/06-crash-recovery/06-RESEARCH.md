# Phase 6: Crash Recovery - Research

**Researched:** 2026-02-27
**Domain:** Startup state reconciliation — SQLite persistence + Solana on-chain token account queries
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**PENDING reconciliation:**
- Use wallet token account balance (on-chain) to determine if a BUYING trade landed — not stored transaction signatures
- Query actual current on-chain balance, not SQLite-recorded quantity (handles partial fills and fee deductions)
- If balance > 0: transition trade to MONITORING state
- If RPC unavailable or times out during reconciliation: fail-safe closed — mark trade FAILED and continue

**Failed buy handling:**
- Balance = 0 after reconciliation: mark FAILED, log a structured WARN with mint + trade ID, move on (no retry)
- SELLING trades at crash time: re-check wallet balance; if tokens still held resume sell ladder, if wallet empty mark COMPLETED (sell may have landed)
- MONITORING trades at crash time: load into memory as-is, no wallet re-check — Phase 7 will handle exits
- Logging: individual WARN per unrecovered BUYING trade + aggregate summary count at end of recovery

**Startup sequencing:**
- Block new token detections until recovery is fully complete — no async recovery racing with live detection
- Per-trade timeout on RPC calls (not a total recovery timeout); if a single call times out, mark that trade FAILED and continue
- Recovery runs before WebSocket listener connections are established
- After recovery: emit a structured startup summary log line (e.g., "Recovery complete: 3 MONITORING, 1 SELLING resumed, 2 BUYING unrecovered")

**Non-terminal state scope:**
- Recover: BUYING, MONITORING, SELLING only
- DETECTED trades (mid-safety-check, no capital at risk): discard/mark FAILED — bot will rediscover naturally
- In-memory duplicate guard (Set of active mints) populated after recovery, from recovered MONITORING + SELLING trades only
- Edge case — multiple SELLING records for same mint: log ERROR, keep most recent, mark others FAILED

**Code organization:**
- Standalone RecoveryManager class, not a method on TradeStore
- Dependencies injected: TradeStore + RPC client
- Called from index.ts during startup sequence, before listener connections

### Claude's Discretion

- Exact per-trade RPC timeout value
- Internal RecoveryManager method structure
- How COMPLETED determination is logged for SELLING trades that had empty wallet

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| PER-03 | Bot resumes pending trades from SQLite on restart (crash recovery) | TradeStore already has `_rebuildActiveSet()` that loads non-terminal mints into `activeMints` Set on construction. RecoveryManager needs a new `getByState()` query on TradeStore to fetch full Trade rows (not just mints) for BUYING/SELLING/MONITORING — so it can make per-trade RPC calls and trigger SellLadder re-entry. |
| PER-05 | On restart, bot reconciles PENDING entries against on-chain wallet token accounts | `connection.getTokenAccountsByOwner(walletPubKey, { mint: mintPubKey }, { encoding: 'jsonParsed' })` is the correct RPC call. Returns parsed tokenAmount; amount is a string that must be compared to "0". Must query both TOKEN_PROGRAM_ID and TOKEN_2022_PROGRAM_ID because pump.fun's create_v2 (launched Nov 2025) creates Token-2022 tokens. |
</phase_requirements>

---

## Summary

Phase 6 implements a startup recovery sequence that runs synchronously before WebSocket listeners connect. The core problem is: "what happened to trades that were in-flight when the process died?" The answer is different for each state — BUYING trades need on-chain reconciliation (did the tx land?), SELLING trades need wallet balance checks (did the sell complete?), and MONITORING trades need nothing (Phase 7 will pick them up).

The primary RPC primitive is `connection.getTokenAccountsByOwner(walletPubKey, { mint: mintPubKey }, { encoding: 'jsonParsed' })`. This returns all token accounts for the wallet filtered to a specific mint, with the token amount available as a string in `account.data.parsed.info.tokenAmount.amount`. A non-zero string amount (after BigInt conversion) means the buy landed. The critical gotcha: pump.fun introduced `create_v2` in November 2025 which creates Token-2022 tokens rather than legacy SPL tokens, so the recovery check must query both `TOKEN_PROGRAM_ID` and `TOKEN_2022_PROGRAM_ID` to cover both token generations.

The TradeStore already performs `_rebuildActiveSet()` on construction (loading non-terminal mints into the in-memory `activeMints` Set). Phase 6 needs to extend TradeStore with a `getByState(states)` method that returns full `Trade` rows (including `id`, `mint`, and `updatedAt` for "most recent" tie-breaking), and then RecoveryManager acts on those rows to make transition decisions. RecoveryManager is injected with TradeStore and the RPC Connection; it runs, then index.ts proceeds to start listeners.

**Primary recommendation:** Extend TradeStore with a `getByState()` query, implement `RecoveryManager` class with per-trade timeout-wrapped RPC calls for BUYING and SELLING, and restructure `main()` in `index.ts` to call `await recoveryManager.run()` before `detectionManager.start()`.

---

## Standard Stack

### Core (all already installed)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `better-sqlite3` | ^12.6.2 | Synchronous SQLite reads for non-terminal trade rows | Already used in TradeStore; synchronous API avoids async complications at startup |
| `@solana/web3.js` | ^1.98.4 | `getTokenAccountsByOwner` for on-chain balance check | Already used throughout; `Connection` already wired into index.ts |
| `@solana/spl-token` | ^0.4.14 | `TOKEN_PROGRAM_ID` and `TOKEN_2022_PROGRAM_ID` constants | Already in package.json; needed for programId filter in RPC call |

### No New Dependencies Required

All required libraries are already installed. Phase 6 adds only a new class (`RecoveryManager`) and a TradeStore method extension.

---

## Architecture Patterns

### Recommended File Structure

```
src/
├── persistence/
│   ├── trade-store.ts        # Add getByState() method
│   └── trade-store.test.ts   # Add getByState() tests
├── recovery/
│   ├── recovery-manager.ts   # New: RecoveryManager class
│   └── recovery-manager.test.ts
└── index.ts                  # Wire: run recovery before detectionManager.start()
```

### Pattern 1: TradeStore.getByState() — New Query Method

TradeStore needs a new method that returns full `Trade` rows (not just mints) for given states. This enables RecoveryManager to iterate trades and make per-trade decisions.

The existing `stmtGetNonTerminal` only returns `mint` (a single column). Recovery needs the full row including `id`, `mint`, `state`, and `updatedAt` (for tie-breaking multiple SELLING records per mint).

**Prepared statement pattern (matches existing code style):**

```typescript
// Source: existing trade-store.ts pattern
private readonly stmtGetByState: BetterSqlite3.Statement;

// In constructor, after existing stmts:
this.stmtGetByState = this.db.prepare(
  `SELECT id, mint, state, created_at, updated_at, amount_tokens, error_message
   FROM trades
   WHERE state IN (${states.map(() => '?').join(',')})
   ORDER BY updated_at DESC`
);

// Method:
getByState(states: TradeState[]): Trade[] {
  const rows = this.stmtGetByState.all(...states) as Array<{...}>;
  return rows.map(row => ({
    id: row.id,
    mint: row.mint,
    state: row.state as TradeState,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    amountTokens: row.amount_tokens ?? undefined,
    errorMessage: row.error_message ?? undefined,
  }));
}
```

Note: The prepared statement must be compiled with a fixed number of `?` placeholders. Since the states array length varies at call time, the cleanest approach is to compile the statement dynamically at call time (not in the constructor), or compile three variants (one per state). See Pitfalls section.

### Pattern 2: On-Chain Token Balance Check

To check if a wallet holds a specific mint, use `getTokenAccountsByOwner` with a mint filter. Both TOKEN_PROGRAM_ID (legacy SPL) and TOKEN_2022_PROGRAM_ID must be checked because pump.fun's `create_v2` (Nov 2025) creates Token-2022 tokens.

```typescript
// Source: Solana official docs + Helius docs (verified HIGH confidence)
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { PublicKey } from '@solana/web3.js';
// TOKEN_2022_PROGRAM_ID import needed for pump.fun create_v2 tokens
// import { TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';

async function getWalletTokenBalance(
  connection: Connection,
  walletPubKey: PublicKey,
  mintPubKey: PublicKey
): Promise<bigint> {
  // Must check both programs — pump.fun uses both depending on creation date
  const [legacyAccounts, token2022Accounts] = await Promise.all([
    connection.getTokenAccountsByOwner(
      walletPubKey,
      { mint: mintPubKey },
      { encoding: 'jsonParsed' }
    ),
    connection.getTokenAccountsByOwner(
      walletPubKey,
      { mint: mintPubKey },
      // TOKEN_2022_PROGRAM_ID filter requires explicit programId param
      // When using { mint } filter without programId, the RPC searches the default
      // token program. Check Solana RPC behavior for mint-only filter.
      { encoding: 'jsonParsed' }
    ),
  ]);

  // Sum amounts across all accounts (both programs)
  let total = 0n;
  for (const accountInfo of [...legacyAccounts.value, ...token2022Accounts.value]) {
    const amountStr: string =
      accountInfo.account.data.parsed.info.tokenAmount.amount;
    total += BigInt(amountStr);
  }
  return total;
}
```

**Important clarification on mint-only filter:** When calling `getTokenAccountsByOwner` with only `{ mint: mintPubKey }` (no explicit `programId`), the Solana RPC defaults to searching the legacy Token program (`TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`). To query Token-2022 accounts, you must pass an explicit `programId: TOKEN_2022_PROGRAM_ID`. Two separate calls are required (one per program) — there is no single call that covers both. Source: Solana GitHub issue #31923.

**Simplified version for most cases:** In practice, since the trade source is stored in the `TokenEvent` and the `trades` table could store it, the recovery could use a simpler single-call approach. However, since `source` is NOT stored in the DB schema (Phase 4 schema only stores: id, mint, state, timestamps, signatures, amounts, error_message), the recovery manager cannot know which token program was used. Therefore, both programs must always be queried.

**Actually, given that mint-only filter with no programId goes to legacy only:** The safe implementation is `Promise.all([legacyCall, token2022Call])` where the second call uses `{ mint: mintPubKey, programId: TOKEN_2022_PROGRAM_ID }` — but the `{ mint }` filter and `programId` may need separate parameters. See Code Examples section for exact API shape.

### Pattern 3: Per-Trade Timeout Wrapping

Each RPC call during recovery must have an individual timeout. If it times out, the trade is marked FAILED and recovery continues.

```typescript
// Source: existing sell-ladder.ts pattern (Promise.race with setTimeout reject)
async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`RPC timeout after ${ms}ms`)), ms)
    ),
  ]);
}

// Usage in recovery:
try {
  const balance = await withTimeout(
    getWalletTokenBalance(connection, walletPubKey, mintPubKey),
    RPC_TIMEOUT_MS  // per-trade timeout, recommended: 5000ms
  );
  if (balance > 0n) {
    tradeStore.transition(mint, 'BUYING', 'MONITORING');
    recoveredMonitoring++;
  } else {
    tradeStore.transition(mint, 'BUYING', 'FAILED', { errorMessage: 'RECOVERY: balance=0' });
    unrecoveredBuying++;
  }
} catch (err) {
  // Timeout or RPC failure — fail-safe closed
  tradeStore.transition(mint, 'BUYING', 'FAILED', { errorMessage: 'RECOVERY: RPC unavailable' });
  log.warn({ mint, tradeId }, 'BUYING trade recovery failed — RPC unavailable');
  unrecoveredBuying++;
}
```

### Pattern 4: RecoveryManager Class Structure

```typescript
export class RecoveryManager {
  constructor(
    private readonly tradeStore: TradeStore,
    private readonly connection: Connection,
    private readonly walletPubKey: PublicKey,
  ) {}

  async run(): Promise<RecoverySummary> {
    // 1. Discard DETECTED trades (no capital at risk)
    // 2. Reconcile BUYING trades (on-chain balance check)
    // 3. Reconcile SELLING trades (on-chain balance check)
    // 4. Load MONITORING trades as-is (no check needed)
    // 5. Return summary for index.ts to log
  }
}

export interface RecoverySummary {
  monitoring: number;   // trades loaded into memory as-is
  sellingResumed: number;  // SELLING trades with tokens still held
  sellingCompleted: number;  // SELLING trades with empty wallet (marked COMPLETED)
  buyingRecovered: number;  // BUYING trades that had balance > 0
  buyingUnrecovered: number;  // BUYING trades marked FAILED
  detectedDiscarded: number;  // DETECTED trades discarded
}
```

### Pattern 5: index.ts Startup Sequencing

The existing `main()` in index.ts currently calls `detectionManager.start()` before initializing TradeStore. Recovery requires restructuring startup order:

**Current order (must change):**
1. Wallet load
2. RpcManager init
3. DetectionManager init + **`detectionManager.start()`** ← wrong, too early
4. SafetyPipeline init
5. TradeStore init
6. ExecutionEngine + SellLadder init
7. Wire token events

**Required order for Phase 6:**
1. Wallet load
2. RpcManager init
3. SafetyPipeline init
4. TradeStore init
5. ExecutionEngine + SellLadder init
6. **`await recoveryManager.run()`** ← blocks until recovery complete
7. Log recovery summary
8. Populate activeMints from recovered trades (TradeStore constructor already does this via `_rebuildActiveSet`)
9. DetectionManager init + **`detectionManager.start()`** ← now safe

Note: `_rebuildActiveSet()` in TradeStore constructor already populates `activeMints` from all non-terminal rows. After RecoveryManager runs and transitions BUYING→FAILED (and DETECTED→FAILED), the Set will accurately reflect only MONITORING and SELLING trades. The DetectionManager's `seenMints` dedup Map is separate and starts empty — MONITORING/SELLING mints do NOT need to be pre-seeded into it because `tradeStore.isActive()` guards duplicates independently of the dedup Map.

### Pattern 6: Multiple SELLING Records Edge Case

When multiple rows have `state = 'SELLING'` for the same mint, keep the most recent (highest `updated_at`) and mark others FAILED. Since `getByState()` returns `ORDER BY updated_at DESC`, the first entry in a group is "most recent."

```typescript
// Group SELLING trades by mint to detect duplicates
const sellingByMint = new Map<string, Trade[]>();
for (const trade of sellingTrades) {
  const group = sellingByMint.get(trade.mint) ?? [];
  group.push(trade);
  sellingByMint.set(trade.mint, group);
}

for (const [mint, group] of sellingByMint) {
  if (group.length > 1) {
    log.error({ mint, count: group.length }, 'Multiple SELLING records for mint — keeping most recent');
    // group[0] is most recent (ORDER BY updated_at DESC)
    // Mark all but the first as FAILED
    for (const stale of group.slice(1)) {
      tradeStore.transitionById(stale.id, 'SELLING', 'FAILED', { errorMessage: 'RECOVERY: duplicate SELLING record' });
    }
  }
  // Process group[0] (most recent) normally
}
```

Note: `transition()` currently matches by `mint + expectedState`. For duplicate-mint SELLING, we need to transition by `id` not `mint` to avoid ambiguity. This requires either adding `transitionById()` to TradeStore, or handling the duplicates before calling the wallet check. See Pitfalls section.

### Anti-Patterns to Avoid

- **Async recovery racing with detection:** Never start `detectionManager.start()` before `await recoveryManager.run()` resolves. A token event firing during recovery could create a duplicate BUYING record for a mint already in MONITORING state.
- **Total recovery timeout:** Don't use a single timeout for the entire recovery. One slow RPC drags everything. Use per-trade timeouts so one bad mint doesn't block recovery of all others.
- **Querying only TOKEN_PROGRAM_ID:** pump.fun's `create_v2` (Nov 2025) creates Token-2022 tokens. Querying only the legacy program returns empty for Token-2022 mints, incorrectly marking valid positions as FAILED.
- **Using `uiAmount` for zero-check:** `uiAmount` can be `null` if decimals are 0. Always use the raw `amount` string and convert to BigInt for zero comparison.
- **Hand-rolling prepared statement caching:** Don't compile `getByState` statements per-call inside the method; compile once at construction time or use a fixed-state variant.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| On-chain balance check | Custom RPC JSON calls | `connection.getTokenAccountsByOwner()` | Web3.js handles encoding, error types, retry logic |
| BigInt token amount parsing | Custom decimal parsing | `BigInt(amountStr)` from parsed response | `amount` field is always a decimal string; BigInt conversion is safe and exact |
| Per-trade timeout | Complex timer management | `Promise.race([call, timeoutReject])` | Same pattern already in sell-ladder.ts; consistent, composable |
| SQL state-grouped query | Multiple SELECT calls | Single `getByState(['BUYING', 'SELLING', 'MONITORING'])` | One DB round-trip returns all needed rows |

**Key insight:** The recovery problem is fundamentally: "for each non-terminal DB row, make one RPC call, then transition state." Everything else — timeout wrapping, BigInt conversion, state machine transitions — reuses existing project primitives.

---

## Common Pitfalls

### Pitfall 1: getByState Prepared Statement Variable-Length IN Clause

**What goes wrong:** `better-sqlite3` prepared statements are compiled with a fixed SQL string. If `getByState(['BUYING'])` is called with 1 state and `getByState(['BUYING', 'SELLING'])` is called with 2, each needs a different number of `?` placeholders. A single compiled statement can't serve both.

**Why it happens:** better-sqlite3 doesn't support array binding for IN clauses — each `?` is a separate positional param (confirmed in TradeStore comment: "stmtGetNonTerminal uses positional ? placeholders for IN clause — named params not supported for arrays").

**How to avoid:** Either (a) compile the statement dynamically inside the method body (not in constructor) with `this.db.prepare(...)` each call — acceptable for startup-once methods, or (b) compile separate statements for BUYING-only, SELLING-only, MONITORING-only calls and call them individually. Option (b) is cleaner and matches the existing `stmtGetNonTerminal` pattern.

**Recommendation:** Compile three separate statements in the constructor (`stmtGetBuying`, `stmtGetSelling`, `stmtGetMonitoring`), each returning full Trade rows. RecoveryManager calls them separately. Aligns with project's "compile prepared statements once at construction time" principle.

### Pitfall 2: transition() Ambiguity with Duplicate SELLING Rows

**What goes wrong:** `transition(mint, 'SELLING', 'FAILED')` uses `WHERE mint = ? AND state = ?`. If two SELLING rows exist for the same mint, both get updated — but the intent is to update only the stale ones (not the most recent).

**Why it happens:** The TradeStore schema has no UNIQUE constraint on mint — multiple rows with the same mint and state are possible (crash during sell creates new SELLING record on restart attempt).

**How to avoid:** Add `transitionById(id, from, to, extra)` to TradeStore that uses `WHERE id = ? AND state = ?`. This gives RecoveryManager precise control when de-duplicating multiple SELLING rows for the same mint. The `id` column is already `INTEGER PRIMARY KEY AUTOINCREMENT`.

**Warning signs:** If recovery logs show "optimistic lock miss" for SELLING transitions, it's likely due to duplicate rows.

### Pitfall 3: TOKEN_PROGRAM_ID vs TOKEN_2022_PROGRAM_ID

**What goes wrong:** `getTokenAccountsByOwner(owner, { mint }, { encoding: 'jsonParsed' })` without an explicit `programId` searches only the legacy Token program. Tokens created by pump.fun's `create_v2` (November 2025+) use TOKEN_2022_PROGRAM_ID and won't appear in the response. Recovery incorrectly marks valid positions as FAILED.

**Why it happens:** pump.fun launched `create_v2` in November 2025 which migrates to Token-2022 for all new token creations. The `source` field on TokenEvent distinguishes pumpportal vs raydium, but not legacy vs Token-2022 — and even if it did, that info isn't stored in the trades DB schema.

**How to avoid:** Always make two parallel `getTokenAccountsByOwner` calls — one with `{ mint }` (legacy default) and one with `{ mint, programId: TOKEN_2022_PROGRAM_ID }` — and sum the results. Both calls are fast (< 200ms each). Total balance = legacy balance + Token-2022 balance.

**Confidence on API shape:** MEDIUM — The `{ mint }` filter combined with `programId` as a separate parameter needs validation against the actual `@solana/web3.js` Connection API signature. The official docs show either `{ programId }` OR `{ mint }` as the filter argument, suggesting `programId` may not be combinable with `mint` in the same filter object. In that case, use `{ programId: TOKEN_2022_PROGRAM_ID }` alone and then filter the results for the specific mint — or check if the method has a separate `programId` option parameter.

**Validation needed:** Inspect `@solana/web3.js` type definitions for `getTokenAccountsByOwner` to confirm the filter object shape.

### Pitfall 4: activeMints Set Double-Population

**What goes wrong:** TradeStore constructor calls `_rebuildActiveSet()` which adds ALL non-terminal mints (including DETECTED, BUYING, SELLING, MONITORING) to `activeMints`. RecoveryManager then transitions some BUYING→FAILED and DETECTED→FAILED. Those transitions call `activeMints.delete()` correctly via the existing `transition()` logic (terminal states trigger delete). However, if RecoveryManager directly manipulates DB rows without going through `transition()`, the Set becomes stale.

**Why it happens:** The activeMints Set is kept in sync by `transition()` side effects. Bypassing `transition()` (e.g., direct `db.run()` calls) breaks this invariant.

**How to avoid:** RecoveryManager must always use `tradeStore.transition()` (or `transitionById()`) — never issue direct SQL statements. This ensures activeMints stays consistent.

### Pitfall 5: DETECTED State Has No Capital at Risk — Still Needs DB Cleanup

**What goes wrong:** Leaving DETECTED rows in the DB as-is. On next restart, `getByState(['DETECTED'])` would return them again, and they'd be discarded again. Over time, orphaned DETECTED rows accumulate.

**Why it happens:** The temptation is to just ignore DETECTED rows during recovery. But they remain in the DB indefinitely.

**How to avoid:** RecoveryManager explicitly transitions all DETECTED rows to FAILED during startup (or ABANDONED — user decision on ABANDONED vs FAILED, but FAILED is consistent with "not recovered"). This cleans up the DB and keeps non-terminal counts accurate.

### Pitfall 6: SellLadder.sell() Expects MONITORING → SELLING Transition

**What goes wrong:** `SellLadder.sell()` calls `tradeStore.transition(mint, 'MONITORING', 'SELLING')` as its first action. For SELLING trades recovered from crash, the trade is ALREADY in SELLING state. Calling `sellLadder.sell()` directly causes an optimistic lock miss (changes=0) on the first transition.

**Why it happens:** SellLadder assumes it's called while the trade is in MONITORING state. It's not designed for re-entry from SELLING state.

**How to avoid:** RecoveryManager must NOT call `sellLadder.sell()` for SELLING trades. Instead, it transitions SELLING→MONITORING first (a "step back"), then hands off to SellLadder, which will step forward to SELLING again. This is slightly wasteful but correct. Alternatively, RecoveryManager directly triggers a sell via a lower-level method that doesn't assume MONITORING state — but that requires refactoring SellLadder (out of scope for Phase 6).

**Recommended approach:** Transition SELLING→MONITORING, then call `sellLadder.sell(mint, tokenAmount)`. The `amountTokens` field in the DB row provides `tokenAmount` (as a number, needs conversion to BigInt since SellLadder expects `bigint`). If `amountTokens` is null in the DB (PumpPortal buys don't record it — see Phase 5 decision), RecoveryManager must fetch the actual balance from the on-chain query and use that as `tokenAmount`.

---

## Code Examples

Verified patterns from official sources and existing codebase:

### getTokenAccountsByOwner — Exact API

```typescript
// Source: Solana official docs (solana.com/docs/rpc/http/gettokenaccountsbyowner)
// and Helius docs (helius.dev/docs/rpc/guides/gettokenaccountsbyowner)
import { Connection, PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';

async function getTokenBalanceBothPrograms(
  connection: Connection,
  owner: PublicKey,
  mint: PublicKey,
  timeoutMs: number = 5000
): Promise<bigint> {
  // Two calls needed: legacy SPL and Token-2022 (pump.fun create_v2)
  const [legacy, token2022] = await Promise.all([
    connection.getTokenAccountsByOwner(
      owner,
      { mint },  // defaults to TOKEN_PROGRAM_ID (legacy)
      { encoding: 'jsonParsed' }
    ),
    // Note: verify the exact API for querying Token-2022 with mint filter
    // Option A: { mint } with programId option (if supported)
    // Option B: { programId: TOKEN_2022_PROGRAM_ID } then filter by mint
    connection.getParsedTokenAccountsByOwner(
      owner,
      { programId: TOKEN_2022_PROGRAM_ID }
    ).then(res => ({
      value: res.value.filter(a =>
        (a.account.data as any).parsed?.info?.mint === mint.toBase58()
      )
    }))
  ]);

  let total = 0n;
  for (const acct of [...legacy.value, ...token2022.value]) {
    const amountStr: string = (acct.account.data as any).parsed.info.tokenAmount.amount;
    total += BigInt(amountStr);
  }
  return total;
}
```

### TradeStore.getByState() — Prepared Statement Pattern

```typescript
// Source: existing trade-store.ts constructor pattern
// compile in constructor (not dynamically per-call):
this.stmtGetBuying = this.db.prepare(
  `SELECT id, mint, state, created_at, updated_at, amount_tokens, error_message
   FROM trades WHERE state = 'BUYING'
   ORDER BY updated_at DESC`
);
this.stmtGetSelling = this.db.prepare(
  `SELECT id, mint, state, created_at, updated_at, amount_tokens, error_message
   FROM trades WHERE state = 'SELLING'
   ORDER BY updated_at DESC`
);
this.stmtGetMonitoring = this.db.prepare(
  `SELECT id, mint, state, created_at, updated_at, amount_tokens
   FROM trades WHERE state = 'MONITORING'
   ORDER BY updated_at DESC`
);
this.stmtGetDetected = this.db.prepare(
  `SELECT id, mint FROM trades WHERE state = 'DETECTED'`
);

// Public methods:
getBuyingTrades(): Trade[] { return (this.stmtGetBuying.all() as any[]).map(mapRow); }
getSellingTrades(): Trade[] { return (this.stmtGetSelling.all() as any[]).map(mapRow); }
getMonitoringTrades(): Trade[] { return (this.stmtGetMonitoring.all() as any[]).map(mapRow); }
getDetectedTrades(): Pick<Trade, 'id' | 'mint'>[] { return this.stmtGetDetected.all() as any[]; }
```

### transitionById() — New TradeStore Method

```typescript
// Source: extension of existing transition() using id instead of mint+state
private readonly stmtUpdateStateById: BetterSqlite3.Statement;

// In constructor:
this.stmtUpdateStateById = this.db.prepare(
  `UPDATE trades SET
     state       = @state,
     updated_at  = @now,
     error_message = COALESCE(@error_message, error_message)
   WHERE id = @id AND state = @expectedState`
);

transitionById(
  id: number,
  from: TradeState,
  to: TradeState,
  extra: Partial<Pick<Trade, 'errorMessage'>> = {}
): number {
  const now = Date.now();
  const result = this.stmtUpdateStateById.run({
    id, state: to, now, expectedState: from,
    error_message: extra.errorMessage ?? null,
  });
  const changes = result.changes;
  if (changes > 0 && TERMINAL_STATES.has(to)) {
    // Must find mint to delete from activeMints
    // Either: store mint in call, or keep activeMints consistent via transition()
    // Simplest: pass mint to transitionById
  }
  return changes;
}
```

Note: `transitionById` must also update `activeMints`. The cleanest approach is passing `mint` as a required parameter even though it's redundant with `id`, so the Set can be maintained.

### Recovery Summary Log Pattern

```typescript
// After recoveryManager.run():
log.info({
  monitoring: summary.monitoring,
  sellingResumed: summary.sellingResumed,
  sellingCompleted: summary.sellingCompleted,
  buyingRecovered: summary.buyingRecovered,
  buyingUnrecovered: summary.buyingUnrecovered,
  detectedDiscarded: summary.detectedDiscarded,
}, 'Recovery complete');
// Matches user spec: "Recovery complete: 3 MONITORING, 1 SELLING resumed, 2 BUYING unrecovered"
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| pump.fun legacy `create` (TOKEN_PROGRAM_ID) | `create_v2` (TOKEN_2022_PROGRAM_ID) | November 2025 | Recovery must query both token programs for balance checks |
| Single `getTokenAccountsByOwner` call | Two parallel calls (one per program) | Nov 2025 | Minor latency increase; required for correctness |

**Deprecated/outdated:**
- Single-program SPL token query: Before Nov 2025, only TOKEN_PROGRAM_ID was needed for pump.fun tokens. Now insufficient for create_v2 tokens.

---

## Open Questions

1. **getTokenAccountsByOwner filter shape for TOKEN_2022**
   - What we know: `{ mint }` filter alone queries only legacy TOKEN_PROGRAM_ID. `{ programId }` alone queries all mints under that program. Whether `{ mint }` can be combined with explicit `programId` in the same call is unclear from the public docs.
   - What's unclear: The exact `@solana/web3.js` v1.98.4 type signature for the filter parameter.
   - Recommendation: In Wave 0, verify via TypeScript type inspection: `import type { TokenAccountsFilter } from '@solana/web3.js'` and check if it accepts `{ mint: PublicKey; programId?: PublicKey }` or only `{ mint: PublicKey } | { programId: PublicKey }`. If union only, use `getParsedTokenAccountsByOwner(owner, { programId: TOKEN_2022_PROGRAM_ID })` and filter by mint client-side.

2. **amountTokens is null for PumpPortal buys**
   - What we know: Phase 5 decision — PumpPortal API doesn't return token amount; `amountTokens` is stored as null for PumpPortal buys. SellLadder.sell() requires a `bigint` tokenAmount.
   - What's unclear: For SELLING trades recovered from crash with null amountTokens, what amount should be passed to SellLadder?
   - Recommendation: For SELLING recovery, use the on-chain balance query result as the token amount (since we're querying the wallet anyway to determine if tokens are still held). This is more accurate than the stored amount (which may be null or stale).

3. **DETECTED trade transition — FAILED vs ABANDONED**
   - What we know: Context says discard DETECTED trades. Both FAILED and ABANDONED are terminal states that remove mint from activeMints.
   - What's unclear: Which terminal state to use for DETECTED discards.
   - Recommendation: Use FAILED with `errorMessage: 'RECOVERY: DETECTED trade discarded'`. FAILED semantically matches "bot couldn't complete this trade." ABANDONED might imply intentional user action.

---

## Sources

### Primary (HIGH confidence)
- Solana official RPC docs (solana.com/docs/rpc/http/gettokenaccountsbyowner) — getTokenAccountsByOwner API shape, parameters, response format
- Context7 `/llmstxt/solana_llms_txt` — getTokenBalance TypeScript example with `getTokenAccountsByOwner`
- Existing codebase (`trade-store.ts`, `sell-ladder.ts`, `index.ts`) — patterns for prepared statements, Promise.race timeout, state machine transitions

### Secondary (MEDIUM confidence)
- pump.fun/pump-public-docs GitHub (via WebFetch) — create_v2 uses Token-2022; announced November 2025
- Helius docs (helius.dev) — `getTokenAccountsByOwner` with jsonParsed encoding pattern, balance > 0 check pattern
- Chainstack blog — Trading bot update for "Mayhem Mode" confirming Token-2022 dual-program requirement

### Tertiary (LOW confidence)
- Solana GitHub issue #31923 — "two calls needed for TOKEN_PROGRAM_ID and TOKEN_2022_PROGRAM_ID" claim; issue title matches but content not directly verified
- yihau solana-web3-demo — `AccountLayout.decode()` pattern (older API, likely pre-dates jsonParsed encoding option)

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new libraries; all dependencies already installed and in use
- Architecture: HIGH — RecoveryManager class structure, TradeStore method extensions, index.ts ordering all derived directly from codebase analysis
- On-chain RPC patterns: MEDIUM — `getTokenAccountsByOwner` with jsonParsed verified from official docs; dual-program requirement for pump.fun Token-2022 verified from pump-public-docs; exact filter API shape for combining mint+programId needs code-level verification
- Pitfalls: HIGH for state machine and Set consistency (derived from codebase); MEDIUM for Token-2022 (verified but fast-moving ecosystem)

**Research date:** 2026-02-27
**Valid until:** 2026-03-13 (stable architecture; pump.fun ecosystem may change)
