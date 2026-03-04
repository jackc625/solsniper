# Phase 14: Sell Price Bug Fixes - Context

**Gathered:** 2026-03-03
**Status:** Ready for planning

<domain>
## Phase Boundary

Fix the two sell price bugs that break all P&L tracking: (1) sellers discard SOL received amounts, so `sellPriceSol` is never stored in the database, and (2) dashboard SQL computes P&L incorrectly. After this phase, every completed sell stores the total SOL received, and the dashboard shows accurate per-trade and aggregate P&L.

</domain>

<decisions>
## Implementation Decisions

### Price storage convention
- `sellPriceSol` stores **total SOL received** from the sell (not per-token unit price)
- P&L computed as `sellPriceSol - amountSol` (total SOL out minus total SOL in)
- `buyPriceSol` stays as-is (per-token unit price) — not migrated
- `amountSol` (total SOL spent on buy) is the buy-side reference for P&L
- SELL_CONFIRMED event carries `pnlSol = sellPriceSol - amountSol`

### Sell price capture by step
- **STANDARD, HIGH_FEE, JITO_BUNDLE:** Capture `quoteResponse.outAmount` from Jupiter quote (lamports → SOL via `/1e9`)
- **EMERGENCY (49% slippage):** Parse on-chain transaction for actual SOL received — quote is unreliable at extreme slippage
- **CHUNKED:** Sum `outAmount` from each tranche's Jupiter quote — data already available per-tranche
- **PUMPPORTAL:** Parse on-chain transaction for actual SOL received — no Jupiter quote available
- **Fallback for on-chain parse failures:** Fall back to last known PositionManager quote value rather than storing NULL

### Partial sell (tiered TP) P&L
- `sellPriceSol` accumulates across tiers — updated in the database after each partial sell confirms
- Trade stays in MONITORING between tier fires (current behavior preserved)
- Running total stored in `sell_price_sol` column incrementally — crash-safe, no in-memory accumulation
- New SELL_PARTIAL event type emitted per tier fire (which tier, SOL received this tier, running total)
- Final SELL_CONFIRMED emitted when trade transitions to COMPLETED with full accumulated total

### Historical data handling
- Existing COMPLETED trades with NULL `sell_price_sol` show `—` for P&L fields — no backfill attempted
- Total P&L and win rate only count trades with `sell_price_sol IS NOT NULL`
- No special visual treatment for legacy rows — missing data speaks for itself
- Dry-run trades use the same sell price tracking mechanism

### Dashboard SQL fixes
- Claude's Discretion — formula uses `sell_price_sol - amount_sol` consistent with storage convention
- Win rate denominator: only trades with `sell_price_sol IS NOT NULL`
- History endpoint P&L: `sell_price_sol - amount_sol` (or NULL for legacy trades)

### Claude's Discretion
- Exact on-chain transaction parsing approach (getTransaction + find SOL delta)
- Seller return type changes (string → object with signature + solReceived)
- Dashboard SQL formula details (consistent with storage convention)
- SELL_PARTIAL event payload structure
- Error handling for on-chain parse edge cases

</decisions>

<specifics>
## Specific Ideas

- Bugs documented in `.planning/phases/14-sell-price-bug-fixes/ISSUES.md` — full data flow trace from buy (working) through sell (broken) through dashboard (shows zero)
- Two root causes: (1) all sellers return only signature string, discarding SOL output amount, (2) dashboard SQL does `sell_price_sol - buy_price_sol` which is per-token-unit delta even if it were populated
- `PositionManager.getPositionValueSol()` already correctly parses `outAmount / 1e9` from Jupiter quotes — same pattern needed in sellers

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `PositionManager.getPositionValueSol()`: Already parses Jupiter `outAmount / 1e9` — reference pattern for sell price extraction
- `jupiterClient.quote()`: Returns `{ outAmount: string }` — lamports of expected SOL output
- `tradeStore.transition()`: Already supports `sellPriceSol` in `extra` arg via COALESCE — infrastructure exists, just never called with a value
- `broadcastAndConfirm()`: Returns `BroadcastResult { signature, blockhash, lastValidBlockHeight }` — needs extension to include SOL received

### Established Patterns
- Seller functions return `Promise<string>` (signature only) — needs change to return `{ signature, solReceived? }`
- `sell-ladder.ts:163` transitions SELLING→COMPLETED with only `{ sellSignature }` — needs `sellPriceSol` added
- Schema migrations via `MIGRATION_SQL` array in `schema.ts` — no new columns needed, `sell_price_sol` already exists
- `BotEventBus` single 'event' name with typed `BotEvent` payload — new SELL_PARTIAL type follows same pattern

### Integration Points
- `sell-ladder.ts`: Must receive SOL amount from sellers and pass to `tradeStore.transition()`
- `standard-seller.ts`, `jito-seller.ts`: Must capture and return `quoteResponse.outAmount`
- `pump-portal-seller.ts`: Must parse on-chain tx after confirmation
- `chunked-seller.ts`: Must accumulate tranche outAmounts
- `position-manager.ts`: Must pass last known quote to sell-ladder for PumpPortal fallback
- `src/dashboard/routes/trades.ts`: SQL updates for P&L computation
- `dashboard/src/components/Performance.tsx`: Already handles null P&L with `—` fallback

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 14-sell-price-bug-fixes*
*Context gathered: 2026-03-03*
