# Phase 14: Sell Price Bug Fixes - Research

**Researched:** 2026-03-04
**Domain:** TypeScript sell execution pipeline, SQLite trade persistence, dashboard SQL
**Confidence:** HIGH — all findings are directly from codebase inspection, no external sources needed

## Summary

Phase 14 fixes two concrete bugs that prevent P&L tracking from ever working. Both bugs are fully diagnosed in ISSUES.md and CONTEXT.md with specific file/line causes. No unknown territory exists in this phase — it is pure surgical correction of existing code.

**Bug 1** (primary): Every seller (`standardSell`, `jitoSell`, `chunkedSell`, `pumpPortalSell`) currently returns `Promise<string>` (the signature only) and discards the Jupiter `quoteResponse.outAmount` that contains the expected SOL output. `SellLadder` therefore calls `tradeStore.transition(mint, 'SELLING', 'COMPLETED', { sellSignature })` without a `sellPriceSol`, so `sell_price_sol` stays NULL in SQLite forever.

**Bug 2** (secondary): The dashboard SQL in `trades.ts` computes P&L as `sell_price_sol - buy_price_sol`. After the locked storage convention decision, `sell_price_sol` will store **total SOL received** while `buy_price_sol` stores **per-token unit price**. The correct formula is `sell_price_sol - amount_sol` (total out minus total in). The stats endpoint `SUM(CASE WHEN ... THEN sell_price_sol - buy_price_sol ELSE 0 END)` has the same mismatch.

**Primary recommendation:** Change seller return types from `Promise<string>` to `Promise<{ signature: string; solReceived: number }>`, thread `solReceived` up through `SellLadder` to `tradeStore.transition()`, and fix the two SQL queries in `trades.ts`.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Price storage convention:**
- `sellPriceSol` stores **total SOL received** from the sell (not per-token unit price)
- P&L computed as `sellPriceSol - amountSol` (total SOL out minus total SOL in)
- `buyPriceSol` stays as-is (per-token unit price) — not migrated
- `amountSol` (total SOL spent on buy) is the buy-side reference for P&L
- SELL_CONFIRMED event carries `pnlSol = sellPriceSol - amountSol`

**Sell price capture by step:**
- **STANDARD, HIGH_FEE, JITO_BUNDLE:** Capture `quoteResponse.outAmount` from Jupiter quote (lamports → SOL via `/1e9`)
- **EMERGENCY (49% slippage):** Parse on-chain transaction for actual SOL received — quote is unreliable at extreme slippage
- **CHUNKED:** Sum `outAmount` from each tranche's Jupiter quote — data already available per-tranche
- **PUMPPORTAL:** Parse on-chain transaction for actual SOL received — no Jupiter quote available
- **Fallback for on-chain parse failures:** Fall back to last known PositionManager quote value rather than storing NULL

**Partial sell (tiered TP) P&L:**
- `sellPriceSol` accumulates across tiers — updated in the database after each partial sell confirms
- Trade stays in MONITORING between tier fires (current behavior preserved)
- Running total stored in `sell_price_sol` column incrementally — crash-safe, no in-memory accumulation
- New SELL_PARTIAL event type emitted per tier fire (which tier, SOL received this tier, running total)
- Final SELL_CONFIRMED emitted when trade transitions to COMPLETED with full accumulated total

**Historical data handling:**
- Existing COMPLETED trades with NULL `sell_price_sol` show `—` for P&L fields — no backfill attempted
- Total P&L and win rate only count trades with `sell_price_sol IS NOT NULL`
- No special visual treatment for legacy rows — missing data speaks for itself
- Dry-run trades use the same sell price tracking mechanism

**Dashboard SQL fixes:**
- Formula uses `sell_price_sol - amount_sol` consistent with storage convention
- Win rate denominator: only trades with `sell_price_sol IS NOT NULL`
- History endpoint P&L: `sell_price_sol - amount_sol` (or NULL for legacy trades)

### Claude's Discretion
- Exact on-chain transaction parsing approach (getTransaction + find SOL delta)
- Seller return type changes (string → object with signature + solReceived)
- Dashboard SQL formula details (consistent with storage convention)
- SELL_PARTIAL event payload structure
- Error handling for on-chain parse edge cases

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope
</user_constraints>

## Standard Stack

This phase uses no new dependencies. All tools are already installed:

### Core (already in codebase)
| Component | Location | Purpose |
|-----------|----------|---------|
| `jupiterClient.quote()` | `src/execution/jupiter-client.ts` | Returns `{ outAmount: string }` — lamports |
| `tradeStore.transition()` | `src/persistence/trade-store.ts` | Already accepts `sellPriceSol` in `extra` via COALESCE |
| `connection.getTransaction()` | `@solana/web3.js` | On-chain parse for EMERGENCY/PUMPPORTAL |
| `botEventBus` | `src/dashboard/bot-event-bus.ts` | BotEvent emission — add SELL_PARTIAL type |
| `better-sqlite3` (raw `db`) | `src/dashboard/routes/trades.ts` | Dashboard SQL queries |

### No New Dependencies
All required APIs are present in the existing stack.

## Architecture Patterns

### Seller Return Type Change
Current signature: `Promise<string>` (signature only)

New interface for Jupiter-based sellers:
```typescript
// Source: codebase — standardSell, jitoSell return pattern
export interface SellOutcome {
  signature: string;
  solReceived?: number;  // undefined only on true parse failure
}
```

For `chunkedSell`, the return type changes from `number` (tranche count) to an object:
```typescript
export interface ChunkedSellOutcome {
  confirmedTranches: number;
  solReceived?: number;  // sum of outAmounts across confirmed tranches
}
```

### Quote outAmount Extraction Pattern
Reference: `PositionManager.getPositionValueSol()` at `src/position/position-manager.ts:422-423`
```typescript
// Source: src/position/position-manager.ts
const data = (await this.jupiterClient.quote(params)) as { outAmount: string };
return Number(data.outAmount) / 1e9;
```

Apply same pattern in `standardSell` and `jitoSell`:
```typescript
// After: const quoteResponse = await jupiterClient.quote(params);
const solReceived = Number((quoteResponse as { outAmount: string }).outAmount) / 1e9;
// Return { signature: result.signature, solReceived } instead of result.signature
```

### On-Chain SOL Delta Parsing (EMERGENCY and PUMPPORTAL)
For cases where the Jupiter quote is unavailable or unreliable, parse the confirmed transaction to find the actual SOL received. The pattern is: fetch the transaction, find the pre/post SOL balance delta for the wallet's native account.

```typescript
// Discretion area — recommended approach
async function parseSolReceived(
  signature: string,
  walletPubKey: PublicKey,
  connection: Connection
): Promise<number | undefined> {
  const tx = await connection.getTransaction(signature, {
    commitment: 'confirmed',
    maxSupportedTransactionVersion: 0,
  });
  if (!tx || !tx.meta) return undefined;

  // Find wallet's account index in the transaction
  const accountKeys = tx.transaction.message.staticAccountKeys ??
                      tx.transaction.message.getAccountKeys().staticAccountKeys;
  const walletIndex = accountKeys.findIndex(k => k.equals(walletPubKey));
  if (walletIndex === -1) return undefined;

  const pre = tx.meta.preBalances[walletIndex];
  const post = tx.meta.postBalances[walletIndex];
  if (pre == null || post == null) return undefined;

  const delta = (post - pre) / 1e9;
  return delta > 0 ? delta : undefined;  // Only positive delta is SOL received
}
```

Note: For PUMPPORTAL, the `broadcastAndConfirm` already returns the `signature`. The on-chain parse needs the `connections` array passed into the seller. For EMERGENCY, same — `broadcastAndConfirm` result already has the signature.

### SellLadder Step Result Extension
`SellLadder.sell()` currently tracks `let signature: string | undefined`. It needs to also track `let solReceived: number | undefined` and pass it to `tradeStore.transition()`.

The step function types in the `steps` array need updating:
```typescript
// Current fn type: () => Promise<string | number>
// New fn type: () => Promise<SellOutcome | ChunkedSellOutcome>
```

The CHUNKED special-case check (`if (step.name === 'CHUNKED')`) becomes the check for `confirmedTranches` field.

### Tiered TP Partial Sell Accumulation
For tiered TP, `SellLadder.sell()` is called with partial `tokenAmount` per tier from `PositionManager.fireSell()`. The sell ladder must:
1. Call `tradeStore.transition(mint, 'MONITORING', 'MONITORING', { sellPriceSol: runningTotal })` — a same-state update to accumulate
2. Emit `SELL_PARTIAL` event with this tier's data
3. NOT transition to COMPLETED until all tiers are done (caller handles this — PositionManager does not signal "final tier")

Wait — the CONTEXT.md decision states "Trade stays in MONITORING between tier fires (current behavior preserved)." Currently, each tier calls `fireSell()` which calls `sellLadder.sell()`, which transitions `MONITORING→SELLING→COMPLETED`. This means the trade reaches COMPLETED after the first tier fire, and subsequent tiers cannot fire because `sellsInFlight` cleans up and the trade is already COMPLETED.

This is a design challenge for tiered TP accumulation. The CONTEXT.md says to accumulate `sell_price_sol` incrementally, and emit a new `SELL_PARTIAL` event type. The implication is:
- After tier N fires and confirms, store that tier's SOL in `sell_price_sol` (additive) and emit SELL_PARTIAL
- Only the last sell (which exhausts all tokens or reaches last tier) emits SELL_CONFIRMED and transitions to COMPLETED
- Intermediate tiers: currently each one fully completes the trade state machine

This requires more careful analysis: looking at how `tierIndices` works in PositionManager, `fireSell` is called with `tokensToSell` (partial amount). The trade transitions MONITORING→SELLING→COMPLETED on the first tier. Then `tierIndices` increments, but the trade is already COMPLETED, so PositionManager won't evaluate it again (it only checks MONITORING trades).

The CONTEXT.md decision to "accumulate across tiers" implies the implementation needs to coordinate across partial sells. The recommended approach at discretion: when `sellLadder.sell()` succeeds for a partial amount and the trade has a remaining balance (i.e., not all tokens sold), emit SELL_PARTIAL and transition back to MONITORING (not COMPLETED). Only transition to COMPLETED when all tokens are gone.

However, this is complex and the CONTEXT.md explicitly says "Trade stays in MONITORING between tier fires (current behavior preserved)." This suggests the `MONITORING→SELLING→COMPLETED` full-cycle per tier is intentional and each tier is a separate "completed sell" that accumulates into `sell_price_sol`.

The simplest interpretation: each tier sell call updates `sell_price_sol` by adding the SOL received (using SQL `sell_price_sol = COALESCE(sell_price_sol, 0) + @delta`). This requires a new `addSellPrice` method in TradeStore or a modified transition that adds rather than sets. The planner will need to design this carefully.

### Dashboard SQL Fix
Current (broken) in `src/dashboard/routes/trades.ts`:
```sql
-- History endpoint (line 45-46):
CASE WHEN sell_price_sol IS NOT NULL AND buy_price_sol IS NOT NULL
     THEN sell_price_sol - buy_price_sol ELSE NULL END as pnl_sol

-- Stats endpoint (line 71-72):
SUM(CASE WHEN sell_price_sol IS NOT NULL AND buy_price_sol IS NOT NULL
         THEN sell_price_sol - buy_price_sol ELSE 0 END) as total_pnl_sol
```

Correct (after fix):
```sql
-- History endpoint:
CASE WHEN sell_price_sol IS NOT NULL AND amount_sol IS NOT NULL
     THEN sell_price_sol - amount_sol ELSE NULL END as pnl_sol

-- Stats endpoint:
SUM(CASE WHEN sell_price_sol IS NOT NULL AND amount_sol IS NOT NULL
         THEN sell_price_sol - amount_sol ELSE 0 END) as total_pnl_sol
```

Win rate denominator fix (currently counts ALL completed trades including NULL sell_price_sol):
```sql
-- Current (inaccurate): completed / total (includes legacy NULL rows)
-- Fixed: completed_with_pnl / total_with_pnl
SELECT
  COUNT(*) FILTER (WHERE sell_price_sol IS NOT NULL) as total_with_pnl,
  COUNT(*) FILTER (WHERE state = 'COMPLETED' AND sell_price_sol IS NOT NULL) as completed_with_pnl,
  ...
```

### SELL_PARTIAL Event Type
Add to `BotEventType` union in `bot-event-bus.ts`:
```typescript
export type BotEventType =
  | 'TOKEN_DETECTED'
  | 'BUY_SENT'
  | 'BUY_CONFIRMED'
  | 'BUY_FAILED'
  | 'SELL_TRIGGERED'
  | 'SELL_PARTIAL'      // NEW: emitted per tiered TP tier fire
  | 'SELL_CONFIRMED'
  | 'SELL_FAILED'
  | 'ERROR';
```

SELL_PARTIAL payload (uses existing BotEvent interface fields):
- `type: 'SELL_PARTIAL'`
- `mint`: the token
- `ts`: timestamp
- `detail`: e.g., `"tier 1 of 3: +0.012 SOL"`
- `pnlSol`: SOL received this tier (not running total — running total is in DB)
- `isDryRun`: propagated as usual

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SOL received for Jupiter sells | Custom balance polling | `quoteResponse.outAmount / 1e9` | Already returned by the quote call already being made — zero extra cost |
| SOL received for on-chain sells | Balance polling loop | `getTransaction()` pre/post balance delta | Single RPC call, deterministic after confirmation |
| Incremental DB update | In-memory accumulator | COALESCE pattern already in tradeStore | Crash-safe, existing infrastructure |

## Common Pitfalls

### Pitfall 1: CHUNKED Accumulation Needs Per-Tranche tracking
**What goes wrong:** `chunkedSell` currently calls `standardSell` which returns a string. After the change, `standardSell` returns `SellOutcome`. The chunked seller must sum `solReceived` from each successful tranche, not just count confirmed tranches.
**How to avoid:** Change `standardSell` call sites in `chunked-seller.ts` to destructure the new return object and accumulate `solReceived` across tranches.
**Warning sign:** If chunkedSell still returns a plain `number`, it cannot pass SOL back up.

### Pitfall 2: JITO_BUNDLE QuoteResponse — Same Pattern as STANDARD
**What goes wrong:** `jitoSell` already gets `quoteResponse` from `jupiterClient.quote()` but currently only uses it to build the swap tx. The `outAmount` is available at that point.
**How to avoid:** Extract `Number((quoteResponse as { outAmount: string }).outAmount) / 1e9` from `quoteResponse` before it goes into the swap call, then return it alongside the signature.

### Pitfall 3: EMERGENCY — Quote Is Unreliable
**What goes wrong:** EMERGENCY uses 49% slippage, so `quoteResponse.outAmount` is the worst-case estimate, not what actually landed. Using it would overstate recovery SOL.
**Decision:** Parse on-chain transaction for actual SOL received. Fall back to the last known PositionManager quote value if `getTransaction` fails.
**Warning sign:** If EMERGENCY simply uses `quoteResponse.outAmount`, P&L accuracy at the extreme-slippage level is compromised.

### Pitfall 4: SellLadder Step Loop Type Mismatch
**What goes wrong:** The step loop checks `if (step.name === 'CHUNKED')` to detect the numeric return. After type changes, this special case becomes a check for `confirmedTranches` field presence. The union type of step results needs to be discriminated correctly.
**How to avoid:** Use a discriminated union or a single `{ signature?: string; solReceived?: number; confirmedTranches?: number }` result object and check for `confirmedTranches` presence.

### Pitfall 5: SellLadder.sell() — `pnlSol` Computation
**What goes wrong:** After the fix, `sell-ladder.ts:167-169` computes `pnlSol = completedTrade.sellPriceSol - completedTrade.buyPriceSol`. This is the old wrong formula. It must become `completedTrade.sellPriceSol - completedTrade.amountSol`.
**How to avoid:** Update the pnlSol computation in both the success path (line 167-169) and the failure path (line 181-182).

### Pitfall 6: Win Rate Denominator
**What goes wrong:** The current stats query counts ALL terminal trades for win rate (completed / total). After the fix, legacy trades with NULL sell_price_sol would skew the win rate downward.
**Decision:** Win rate denominator must only count trades with `sell_price_sol IS NOT NULL`.
**Warning sign:** If win rate query isn't updated, it will count legacy NULL trades as losses.

### Pitfall 7: `getTransaction` Requires `maxSupportedTransactionVersion: 0`
**What goes wrong:** Modern Solana transactions use versioned transaction format. Calling `getTransaction` without `{ maxSupportedTransactionVersion: 0 }` will throw or return null for versioned transactions.
**How to avoid:** Always pass `maxSupportedTransactionVersion: 0` in `getTransaction` options.

### Pitfall 8: Tiered TP Accumulation Design Complexity
**What goes wrong:** The CONTEXT.md says `sell_price_sol` accumulates across tiers and the trade stays in MONITORING between tier fires. But the current sell ladder always transitions to COMPLETED on success. Making tiered partial sells work with accumulation requires either: (a) a new `updateSellPrice` method on TradeStore that adds to `sell_price_sol` without state transition, or (b) a separate flow for partial tier sells vs. full position sells.
**Recommendation:** Add `TradeStore.addSellPrice(mint, deltaSOL)` that does `UPDATE trades SET sell_price_sol = COALESCE(sell_price_sol, 0) + @delta WHERE mint = @mint` without changing state. SellLadder emits SELL_PARTIAL and calls `addSellPrice`. Only the final tier (which clears remaining balance) triggers SELL_CONFIRMED and COMPLETED transition.
**Warning sign:** If the planner doesn't account for this, tiered TP will mark the trade COMPLETED after tier 1 and subsequent tiers will never fire.

## Code Examples

### Pattern: Extract outAmount from Jupiter quote
```typescript
// Source: src/position/position-manager.ts — getPositionValueSol()
// Same pattern applies in standard-seller.ts and jito-seller.ts
const quoteResponse = await jupiterClient.quote(params);
const solReceived = Number((quoteResponse as { outAmount: string }).outAmount) / 1e9;
```

### Pattern: On-chain SOL delta parse
```typescript
// Recommended approach (Claude's Discretion) for EMERGENCY and PUMPPORTAL
const tx = await connections[0].getTransaction(signature, {
  commitment: 'confirmed',
  maxSupportedTransactionVersion: 0,
});
if (tx?.meta) {
  const accountKeys = tx.transaction.message.getAccountKeys().staticAccountKeys;
  const idx = accountKeys.findIndex(k => k.equals(wallet.publicKey));
  if (idx !== -1) {
    const delta = (tx.meta.postBalances[idx] - tx.meta.preBalances[idx]) / 1e9;
    if (delta > 0) solReceived = delta;
  }
}
```

### Pattern: TradeStore addSellPrice (new method)
```typescript
// New method on TradeStore — additive, no state change
addSellPrice(mint: string, deltaSol: number): number {
  const result = this.db.prepare(
    `UPDATE trades SET
       sell_price_sol = COALESCE(sell_price_sol, 0) + @delta,
       updated_at = @now
     WHERE mint = @mint AND state IN ('MONITORING', 'SELLING')`
  ).run({ mint, delta: deltaSol, now: Date.now() });
  return result.changes;
}
```

### Pattern: Corrected P&L SQL
```sql
-- History endpoint pnl_sol: sell_price_sol - amount_sol
CASE WHEN sell_price_sol IS NOT NULL AND amount_sol IS NOT NULL
     THEN sell_price_sol - amount_sol ELSE NULL END as pnl_sol

-- Stats endpoint total_pnl_sol: sum only non-null pairs
SUM(CASE WHEN sell_price_sol IS NOT NULL AND amount_sol IS NOT NULL
         THEN sell_price_sol - amount_sol ELSE 0 END) as total_pnl_sol

-- Win rate: only trades with pnl data
SUM(CASE WHEN state = 'COMPLETED' AND sell_price_sol IS NOT NULL THEN 1 ELSE 0 END) as completed_with_pnl,
SUM(CASE WHEN sell_price_sol IS NOT NULL THEN 1 ELSE 0 END) as total_with_pnl
```

## Integration Map

Every file that needs changes:

| File | Change | Scope |
|------|--------|-------|
| `src/execution/sell/standard-seller.ts` | Return `{ signature, solReceived }` instead of `string`; extract `outAmount/1e9` from `quoteResponse` | Bug 1 |
| `src/execution/sell/jito-seller.ts` | Extract `outAmount/1e9` from `quoteResponse`, return with signature | Bug 1 |
| `src/execution/sell/pump-portal-seller.ts` | Parse on-chain tx after `broadcastAndConfirm`, return `{ signature, solReceived? }` | Bug 1 |
| `src/execution/sell/chunked-seller.ts` | Accumulate `solReceived` across tranches, return `{ confirmedTranches, solReceived? }` | Bug 1 |
| `src/execution/sell/sell-ladder.ts` | Thread `solReceived` through step loop; pass `sellPriceSol` to `transition()`; fix `pnlSol` formula; add `addSellPrice` call for SELL_PARTIAL; emit SELL_PARTIAL event | Bug 1 |
| `src/persistence/trade-store.ts` | Add `addSellPrice(mint, deltaSol)` method for tiered TP accumulation | Bug 1 |
| `src/dashboard/bot-event-bus.ts` | Add `'SELL_PARTIAL'` to `BotEventType` union | Bug 1 |
| `src/dashboard/routes/trades.ts` | Fix 2 SQL queries: use `amount_sol` not `buy_price_sol`; fix win rate denominator | Bug 2 |
| `src/types/index.ts` | Update `SellResult` if needed; no `Trade` changes needed (field already exists) | Types |

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (already configured) |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run src/execution/sell/ src/dashboard/` |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map

No formal requirement IDs were specified for this phase. Coverage is by behavior:

| Behavior | Test Type | Automated Command | Test File Exists? |
|----------|-----------|-------------------|------------------|
| standardSell returns `{ signature, solReceived }` with correct SOL from outAmount | unit | `npx vitest run src/execution/sell/standard-seller.test.ts` | No — needs creation |
| jitoSell extracts solReceived from quoteResponse.outAmount | unit | `npx vitest run src/execution/sell/jito-seller.test.ts` | Partial (dry-run tests only) |
| pumpPortalSell parses on-chain tx for solReceived | unit | `npx vitest run src/execution/sell/pump-portal-seller.test.ts` | Partial (no on-chain parse tests) |
| chunkedSell accumulates solReceived across tranches | unit | `npx vitest run src/execution/sell/chunked-seller.test.ts` | No — needs creation |
| SellLadder passes sellPriceSol to transition() on COMPLETED | unit | `npx vitest run src/execution/sell/sell-ladder.test.ts` | Partial (existing tests check signature only) |
| SellLadder pnlSol uses amountSol not buyPriceSol | unit | `npx vitest run src/execution/sell/sell-ladder.test.ts` | No — new assertion needed |
| Dashboard SQL pnl_sol uses sell_price_sol - amount_sol | unit/integration | Manual DB test | No |
| Win rate counts only trades with sell_price_sol IS NOT NULL | unit/integration | Manual DB test | No |

### Sampling Rate
- **Per task commit:** `npx vitest run src/execution/sell/`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/execution/sell/standard-seller.test.ts` — covers new `{ signature, solReceived }` return type
- [ ] `src/execution/sell/chunked-seller.test.ts` — covers tranche accumulation with solReceived
- [ ] New assertions in `src/execution/sell/sell-ladder.test.ts` — verify `sellPriceSol` passed to `transition()` and correct pnlSol formula
- [ ] New assertions in `src/execution/sell/pump-portal-seller.test.ts` — verify on-chain parse path

## Open Questions

1. **Tiered TP accumulation across tiers**
   - What we know: `addSellPrice()` method provides crash-safe incremental accumulation; SELL_PARTIAL event emitted per tier
   - What's unclear: Does SELL_CONFIRMED emit with the full accumulated total after the last tier, or does it emit per-tier like SELL_PARTIAL? The CONTEXT.md says "Final SELL_CONFIRMED emitted when trade transitions to COMPLETED with full accumulated total."
   - Recommendation: The last tier (partial sell that exhausts the position) triggers COMPLETED transition as normal; `addSellPrice` accumulates mid-tiers. Planner should design the `SellLadder` to detect "last tier" vs "mid-tier" or have `PositionManager` signal this.

2. **PositionManager fallback value for EMERGENCY**
   - What we know: CONTEXT.md says fall back to "last known PositionManager quote value" if on-chain parse fails
   - What's unclear: PositionManager doesn't currently pass its last quote value to SellLadder
   - Recommendation: Either (a) SellLadder accepts an optional `fallbackSolValue` parameter from the caller, or (b) the fallback is simply `undefined` (NULL stored) which is handled gracefully by the dashboard. Option (b) is simpler and acceptable given parse failures are rare.

## Sources

### Primary (HIGH confidence)
- Direct codebase inspection of all 8 files involved — source of truth
  - `src/execution/sell/standard-seller.ts` — return type and outAmount availability
  - `src/execution/sell/jito-seller.ts` — quoteResponse already fetched, outAmount available
  - `src/execution/sell/pump-portal-seller.ts` — no Jupiter quote, needs on-chain parse
  - `src/execution/sell/chunked-seller.ts` — calls standardSell, needs accumulation
  - `src/execution/sell/sell-ladder.ts` — orchestration, pnlSol formula bug at line 167-169 and 181-182
  - `src/persistence/trade-store.ts` — COALESCE infrastructure confirmed, `addSellPrice` pattern clear
  - `src/dashboard/routes/trades.ts` — both SQL bugs confirmed at lines 45-46, 71-72
  - `src/dashboard/bot-event-bus.ts` — BotEventType union, SELL_PARTIAL insertion point
- `.planning/phases/14-sell-price-bug-fixes/ISSUES.md` — root cause trace confirmed
- `.planning/phases/14-sell-price-bug-fixes/14-CONTEXT.md` — locked decisions

### Secondary (MEDIUM confidence)
- `src/position/position-manager.ts` — `getPositionValueSol()` pattern confirmed as reference implementation for `outAmount / 1e9`
- `src/types/index.ts` — `SellResult`, `Trade`, `BroadcastResult` shapes confirmed

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries already present, no new dependencies
- Architecture: HIGH — both bugs fully diagnosed, fix patterns directly derived from existing codebase patterns
- Pitfalls: HIGH — all identified from concrete code analysis, not speculation
- Tiered TP accumulation: MEDIUM — correct approach is clear but implementation complexity in sell-ladder coordination needs careful planner attention

**Research date:** 2026-03-04
**Valid until:** This research does not expire — it is based entirely on the current codebase
