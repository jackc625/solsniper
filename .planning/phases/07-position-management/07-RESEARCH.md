# Phase 7: Position Management - Research

**Researched:** 2026-02-27
**Domain:** Autonomous position monitoring, exit strategy execution, state machine progression
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Price Monitoring**
- Poll Jupiter quotes every 5 seconds (fixed, not configurable per-position)
- Price denominated in SOL throughout — entry, current, and threshold calculations
- Entry price derived from confirmed buy transaction: actual SOL spent divided by tokens received
- On Jupiter quote failure: skip that poll cycle, retry on next interval (no immediate retry)

**Exit Trigger Behavior**
- Sell fires immediately on the polling cycle that detects a threshold breach — no confirmation delay
- If TP and SL both trigger in the same poll cycle, TP takes priority (price is above TP, so it's a gain event)
- If a sell transaction fails (slippage, RPC error): keep position in SELLING state and retry on next poll cycle
- For tiered take-profit: after a partial sell executes, remaining tokens stay in MONITORING and the next tier becomes the active threshold

**Trailing Stop Mechanics**
- High watermark initialized at entry price (trails from the moment of buy)
- Threshold expressed as percentage drop from high watermark (e.g., -20%)
- Trailing stop and tiered take-profit can both be active simultaneously on the same position; whichever triggers first executes
- High watermark does NOT reset after a partial TP sell — always tracks the all-time high of the position

**Configuration Design**
- All thresholds are global defaults in config.jsonc (consistent with existing config pattern)
- No per-token overrides for this phase
- Configurable values: stop-loss %, simple TP multiplier, tiered TP ladder (array of {at: Nx, pct: %}), trailing stop %, polling interval, max concurrent positions
- Default out-of-the-box strategy: tiered TP + SL enabled; trailing stop is opt-in (disabled by default)
- Trailing stop enabled when `trailingStopPct` is set to a non-zero value in config

### Claude's Discretion
- Exact config.jsonc schema and key names
- Default values for tiered TP ladder (e.g., 33% at 2x, 33% at 5x, 34% at 10x)
- Default stop-loss threshold value
- Internal state machine details for tracking tiered TP tier progression
- Slippage tolerance for position management sells (may differ from buy slippage)

### Deferred Ideas (OUT OF SCOPE)
- Per-token threshold overrides — could be a future config enhancement
- Runtime-adjustable thresholds via Phase 8 dashboard (hooks into config.jsonc reload)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| POS-01 | Bot monitors active positions by polling Jupiter quotes at configurable intervals | Jupiter quote API: `GET https://api.jup.ag/swap/v1/quote?inputMint={token}&outputMint={SOL_MINT}&amount={rawTokens}` — `outAmount` (string, raw lamports) gives current SOL value |
| POS-02 | Bot automatically sells when position drops below configurable stop-loss threshold | PositionManager computes `currentValueSol / entryValueSol`; if ratio < `(1 + stopLossPct/100)`, fire `sellLadder.sell()` |
| POS-03 | Bot automatically sells when position reaches configurable take-profit target | Same ratio check; if ratio >= `tpMultiplier`, fire sell. TP takes priority over SL in same cycle |
| POS-04 | Bot supports tiered take-profit (e.g., sell 33% at 2x, 33% at 5x, rest at 10x) | In-memory tier state per position (Map<mint, nextTierIndex>); schema extension adds `tier_index` to persist across restart |
| POS-05 | Bot supports trailing stop-loss that follows price upward and sells on reversal | In-memory high-watermark Map<mint, number>; on each poll, update watermark if current > watermark; trigger if `currentValueSol < watermark * (1 - trailingStopPct/100)` |
| POS-06 | Bot enforces configurable maximum concurrent position limit | `tradeStore.getMonitoringTrades().length >= maxConcurrentPositions` check in `index.ts` token handler before `createBuyingRecord()` |
</phase_requirements>

## Summary

Phase 7 builds a `PositionManager` class that runs a single `setInterval` loop (5-second poll) over all MONITORING trades in SQLite. On each tick it fetches a Jupiter quote for each active position (token → SOL direction) to derive current value, then evaluates stop-loss, take-profit, and trailing-stop thresholds. Triggering fires `sellLadder.sell()` which handles the MONITORING→SELLING transition internally. The PositionManager is purely in-memory for runtime state (high watermarks, tier progression) — these in-memory structures are re-initialized from the DB on restart (crash recovery already handles re-arming MONITORING trades back through SellLadder).

The key integration points are: (1) Jupiter quote API already used for buys and sells — the same `https://api.jup.ag/swap/v1/quote` endpoint in the token→SOL direction gives current position value; (2) TradeStore already has `getMonitoringTrades()` and the MONITORING→SELLING transition is handled by SellLadder internally; (3) config.jsonc already has `maxConcurrentPositions`, `stopLossPct`, `takeProfitPct` fields in TradingConfigSchema — Phase 7 adds position management config block and wires them up. The max-position enforcement is a simple guard in `index.ts` before `createBuyingRecord()`.

Rate limit analysis confirms the polling approach is safe: at 5-second intervals with `maxConcurrentPositions` default of 3, the bot makes 3 × 12 = 36 Jupiter quote calls per minute — well within the free-tier limit of 60 req/min. With the maximum config of 50 concurrent positions, calls would hit 600/min (requiring a Pro I key), but the realistic default config is within free tier.

**Primary recommendation:** Build `PositionManager` as a single class with `start()`/`stop()` methods wrapping a `setInterval` poll loop. Use in-memory Maps for high watermarks and tier indices (rebuilt from DB on restart). For tiered TP partial sells, call `sellLadder.sell()` with a `tokensToSell` parameter computed from the tier percentage.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| (none new) | — | No new dependencies needed | All needed APIs already in the codebase |

No new dependencies are required. The PositionManager uses:
- `fetch()` (global, Node 18+) — already used for Jupiter API calls
- `setInterval` / `clearInterval` — standard Node.js timers
- `TradeStore` — already exists with `getMonitoringTrades()`
- `SellLadder` — already exists with `sell(mint, tokenAmount)` interface
- `TradingConfig` — already typed with Zod

### Config Schema Extensions Needed

The `TradingConfigSchema` in `src/config/trading.ts` must be extended with a `positionManagement` section:

```typescript
const TierSchema = z.object({
  at: z.number().positive(),    // multiplier (e.g. 2 = 2x)
  pct: z.number().int().min(1).max(100),  // percent of remaining tokens to sell
});

const PositionManagementConfigSchema = z.object({
  pollIntervalMs: z.number().int().positive().default(5000),
  stopLossPct: z.number().negative().default(-50),            // e.g. -50 means -50%
  tieredTp: z.array(TierSchema).default([
    { at: 2, pct: 33 },
    { at: 5, pct: 33 },
    { at: 10, pct: 34 },
  ]),
  trailingStopPct: z.number().min(0).max(100).default(0),     // 0 = disabled
});
```

Note: `stopLossPct`, `takeProfitPct`, and `maxConcurrentPositions` already exist at the top level of `TradingConfigSchema` — these should be evaluated for consolidation vs extension.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `setInterval` + async poll | `ws` subscription for price feed | WebSocket price feeds (Pyth, Birdeye) add a dependency and may not cover all token mints; Jupiter quote is always available for any tradeable token |
| In-memory high watermark | DB-persisted high watermark | DB column adds complexity; in-memory is simpler and watermark loss on crash is acceptable (resets to entry, slightly more conservative) |
| Tiered TP in-memory tier index | DB-persisted tier index | More crash-resilient but adds schema migration; in-memory is acceptable since on crash the position restarts tier from recovered balance |

**Installation:** No new packages needed.

## Architecture Patterns

### Recommended Project Structure
```
src/
├── position/
│   └── position-manager.ts        # PositionManager class
│   └── position-manager.test.ts   # Unit tests
├── persistence/
│   └── trade-store.ts             # Already has getMonitoringTrades()
│   └── schema.ts                  # Possibly add tier_index column
├── config/
│   └── trading.ts                 # Add PositionManagementConfigSchema
└── index.ts                       # Wire PositionManager.start(), add max-position guard
```

### Pattern 1: Polling Loop with Async Guard

The poll tick must not run concurrently — if a tick's Jupiter requests take longer than 5 seconds, the next tick should not start until the previous one finishes. Use a boolean guard flag or replace `setInterval` with recursive `setTimeout`.

**Use recursive setTimeout**, not setInterval, to prevent overlapping ticks:

```typescript
// Source: Node.js best practice for async polling
export class PositionManager {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;

  start(): void {
    this.running = true;
    this.scheduleTick();
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
  }

  private scheduleTick(): void {
    this.timer = setTimeout(async () => {
      try {
        await this.tick();
      } catch (err) {
        log.error({ err }, 'PositionManager tick threw unexpectedly');
      } finally {
        if (this.running) this.scheduleTick();  // reschedule regardless of tick result
      }
    }, this.config.positionManagement.pollIntervalMs);
  }

  private async tick(): Promise<void> {
    const positions = this.tradeStore.getMonitoringTrades();
    await Promise.allSettled(positions.map(p => this.evaluatePosition(p)));
  }
}
```

**Why recursive setTimeout over setInterval:** prevents tick overlap when async operations (Jupiter quote fetch) take longer than the interval. Each tick starts the next one only after it completes.

### Pattern 2: Jupiter Quote for Price Discovery

Quote direction is **token → SOL** to get current position value in SOL:

```typescript
// Source: Verified against existing src/execution/sell/standard-seller.ts pattern
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const JUPITER_QUOTE = 'https://api.jup.ag/swap/v1/quote';

async function getPositionValueSol(
  mint: string,
  tokenAmountRaw: bigint
): Promise<number | null> {
  try {
    const url = `${JUPITER_QUOTE}?inputMint=${mint}&outputMint=${SOL_MINT}` +
      `&amount=${tokenAmountRaw.toString()}&slippageBps=50&maxAccounts=64`;
    const resp = await fetch(url);
    if (!resp.ok) return null;   // Failed quote → skip cycle
    const data = await resp.json() as { outAmount: string };
    return Number(data.outAmount) / 1e9;  // lamports → SOL
  } catch {
    return null;  // Network error → skip cycle
  }
}
```

Key: `outAmount` is raw lamports (string), divide by 1e9 to get SOL. The `inAmount` should match the `tokenAmountRaw` supplied. A `null` return means skip this poll cycle per the locked decision.

### Pattern 3: Threshold Evaluation with Priority

```typescript
private async evaluatePosition(trade: Trade): Promise<void> {
  const { mint, amountSol, amountTokens } = trade;
  if (!amountSol || !amountTokens) return;  // Incomplete trade data

  const tokenAmountRaw = BigInt(Math.round(amountTokens));
  const currentValueSol = await getPositionValueSol(mint, tokenAmountRaw);
  if (currentValueSol === null) return;  // Jupiter failure → skip cycle

  const ratio = currentValueSol / amountSol;  // current / entry value ratio
  const { positionManagement } = this.config;

  // Update trailing stop high watermark
  const currentWatermark = this.highWatermarks.get(mint) ?? amountSol;
  const newWatermark = Math.max(currentWatermark, currentValueSol);
  this.highWatermarks.set(mint, newWatermark);

  // Check take-profit (tiered first if configured)
  const nextTierIndex = this.tierIndices.get(mint) ?? 0;
  const tiers = positionManagement.tieredTp;
  const activeTier = tiers[nextTierIndex];

  let shouldSell = false;
  let tokensToSell = tokenAmountRaw;
  let reason = '';

  if (activeTier && ratio >= activeTier.at) {
    // Tiered TP: sell configured percent of current tokens
    tokensToSell = tokenAmountRaw * BigInt(activeTier.pct) / 100n;
    shouldSell = true;
    reason = `TP_TIER_${nextTierIndex}`;
  } else if (positionManagement.trailingStopPct > 0) {
    // Trailing stop check
    const trailingThreshold = newWatermark * (1 - positionManagement.trailingStopPct / 100);
    if (currentValueSol < trailingThreshold) {
      shouldSell = true;
      reason = 'TRAILING_STOP';
    }
  }

  // Stop-loss check (only if TP not triggered — TP takes priority)
  if (!shouldSell && ratio < (1 + positionManagement.stopLossPct / 100)) {
    shouldSell = true;
    reason = 'STOP_LOSS';
  }

  if (shouldSell) {
    log.info({ mint, ratio, reason }, 'Exit trigger fired');
    void this.sellLadder.sell(mint, tokensToSell);
    // For tiered TP, advance tier index
    if (reason.startsWith('TP_TIER')) {
      this.tierIndices.set(mint, nextTierIndex + 1);
    }
  }
}
```

### Pattern 4: Max Concurrent Positions Enforcement

In `src/index.ts`, add the position limit check before `createBuyingRecord()`:

```typescript
// In the token event handler (index.ts)
detectionManager.on('token', async (event) => {
  // ... safety pipeline ...
  if (result.pass) {
    // POS-06: Enforce max concurrent position limit
    const activeCount = tradeStore.getMonitoringTrades().length;
    if (activeCount >= tradingConfig.maxConcurrentPositions) {
      log.info({ mint: event.mint, activeCount }, 'Max positions reached — buy rejected');
      return;
    }
    if (tradeStore.isActive(event.mint)) { /* ... */ }
    tradeStore.createBuyingRecord(event.mint);
    void executionEngine.buy(event);
  }
});
```

Note: `maxConcurrentPositions` already exists in `TradingConfigSchema` as a top-level field. The check counts only MONITORING trades (active positions), not BUYING/SELLING which are transient.

### Anti-Patterns to Avoid
- **setInterval with async callback:** the interval fires on wall-clock time, not after tick completion. Two ticks can overlap if Jupiter is slow. Use recursive `setTimeout` instead.
- **Awaiting sells in the poll tick:** `sellLadder.sell()` can take 2+ minutes (CHUNKED + EMERGENCY steps). Must be fire-and-forget (`void`). The sell transitions the trade to SELLING state so subsequent poll ticks skip it (`getMonitoringTrades()` only returns MONITORING rows).
- **Floating point token arithmetic:** `amountTokens` in the DB is stored as REAL (float). When converting back to bigint for sell calls, use `BigInt(Math.round(amountTokens))` to avoid truncation errors.
- **Awaiting all quotes sequentially:** use `Promise.allSettled` to query all positions in parallel. With 3-position default, this cuts latency from 3× round-trip to 1× round-trip per tick.
- **Re-adding to highWatermarks on restart:** watermarks are in-memory and reset to entry price on restart. This is intentional (conservative behavior) and acceptable per the locked design.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Price feed | Custom WebSocket price subscription | Jupiter quote API (already in codebase) | Jupiter covers any token with a swap route; Pyth/Birdeye don't have all mints |
| Retry logic for failed sells | Custom retry loop in PositionManager | SellLadder (already exists) | SellLadder has 5-step escalation ladder with proper timeouts and error handling |
| Token balance for partial sells | On-chain RPC query | Trade.amountTokens from DB (+ tier tracking) | Avoids extra RPC call on every tick; DB value is source of truth for position size |
| Concurrent poll protection | External mutex library | Recursive setTimeout pattern | Simpler, no dependency, correct behavior |

**Key insight:** The SellLadder already handles MONITORING→SELLING transition internally. The PositionManager does NOT need to call `tradeStore.transition()` before firing a sell — SellLadder does it. This avoids double-transition bugs.

## Common Pitfalls

### Pitfall 1: Double-Sell on Same Position
**What goes wrong:** PositionManager fires `sellLadder.sell()` on one tick, but before the sell transitions the trade to SELLING, the next tick also sees it as MONITORING and fires another sell.
**Why it happens:** `sellLadder.sell()` is async and fire-and-forget. The MONITORING→SELLING transition happens inside sell-ladder.ts, but there's a window between firing the sell and the state change.
**How to avoid:** Track in-memory a `Set<string>` of mints currently being sold (`sellsInFlight`). Add to the set before calling `sellLadder.sell()`, remove on completion. In `evaluatePosition`, skip any mint in this set.
**Warning signs:** Logs showing two "Sell ladder step starting" entries for the same mint in the same cycle.

### Pitfall 2: amountTokens Stored as Float
**What goes wrong:** `amountTokens` in the `Trade` interface is `number` (SQLite REAL). Converting directly to bigint with `BigInt(trade.amountTokens)` throws "Cannot convert a non-integer number to bigint" for values like `1000000.5`.
**Why it happens:** SQLite REAL is IEEE 754 float; values from Jupiter's `outAmount` (string integer) get coerced through JavaScript's float layer.
**How to avoid:** Always use `BigInt(Math.round(trade.amountTokens))` when converting to bigint for `sellLadder.sell()`. Consider adding a helper function.
**Warning signs:** `TypeError: Cannot convert a non-integer number to a BigInt` in logs.

### Pitfall 3: Jupiter Rate Limit Under Load
**What goes wrong:** With many positions and a 5-second poll, the bot exceeds Jupiter's free tier (60 req/min).
**Why it happens:** At 5-second intervals, 6 positions = 6 × 12 = 72 req/min, exceeding the free-tier limit.
**How to avoid:** The default `maxConcurrentPositions: 3` keeps it at 36/min. Document the rate limit math in the config comment. If users increase to >5 positions, they need a Jupiter API key.
**Warning signs:** Jupiter API returning HTTP 429 errors in logs.

### Pitfall 4: Tiered TP Tier State Lost on Crash
**What goes wrong:** Bot crashes after partial TP sell. On restart, `tierIndices` Map is empty, so the position restarts from tier 0 even if it already sold at tier 0.
**Why it happens:** Tier index is in-memory only per the current design.
**How to avoid:** This is an accepted limitation per the locked design (no per-token DB state). On restart, the position re-evaluates from current price. If price is still at a tier > 0 level, the position will trigger tier 0 again (small over-sell risk). Document this as known behavior.
**Warning signs:** Logs showing tier 0 triggering for a position that previously sold a partial.

### Pitfall 5: SellLadder Transition Conflict
**What goes wrong:** PositionManager tries to evaluate a position that SellLadder is already transitioning.
**Why it happens:** `getMonitoringTrades()` reads from SQLite synchronously; SellLadder's `transition(MONITORING→SELLING)` is also synchronous — but there's a gap between the fetch and the sell call.
**How to avoid:** The `sellsInFlight` Set from Pitfall 1 fix prevents this. Also: SellLadder's transition uses optimistic locking (`WHERE state = 'MONITORING'`), so a duplicate transition will return `changes=0` and log a warning — it won't corrupt state.
**Warning signs:** `transition: optimistic lock miss` warnings for MONITORING→SELLING.

### Pitfall 6: PumpPortal Positions Missing amountTokens
**What goes wrong:** PumpPortal buys set `amountTokens: undefined` in the trade record (Phase 5-02 decision: "amountTokens undefined for PumpPortal — Phase 7 price polling fills this"). A MONITORING trade with `amountTokens = undefined` cannot be monitored.
**Why it happens:** PumpPortal API doesn't return token amount in its response. The comment in `pump-portal-buyer.ts` explicitly defers this to Phase 7.
**How to avoid:** During PositionManager startup (and on each tick), for any MONITORING trade with missing `amountTokens`, query the on-chain token balance via `getParsedTokenAccountsByOwner` (same as RecoveryManager does) to backfill the value, then update the DB via `transition(MONITORING, MONITORING, { amountTokens: balance })` — or add a dedicated `updateTokenAmount()` method to TradeStore.
**Warning signs:** MONITORING trades with `amountTokens = undefined` that never trigger exits.

## Code Examples

Verified patterns from existing codebase:

### Jupiter Quote for Sell Price (from standard-seller.ts)
```typescript
// Source: src/execution/sell/standard-seller.ts (verified in codebase)
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const JUPITER_QUOTE = 'https://api.jup.ag/swap/v1/quote';

// Token → SOL quote (same direction as sells)
const quoteUrl = `${JUPITER_QUOTE}?inputMint=${mint}&outputMint=${SOL_MINT}` +
  `&amount=${tokenAmount.toString()}&slippageBps=${slippageBps}&maxAccounts=64`;
const quoteResponse = await fetch(quoteUrl).then((r) => {
  if (!r.ok) throw new Error(`Jupiter quote HTTP ${r.status}`);
  return r.json();
});
// outAmount is string in raw lamports
const solValue = Number(quoteResponse.outAmount) / 1e9;
```

### TradeStore.getMonitoringTrades() (from trade-store.ts)
```typescript
// Source: src/persistence/trade-store.ts (verified in codebase)
// Returns Trade[] — each has: id, mint, state, amountSol, amountTokens, buyPriceSol
getMonitoringTrades(): Trade[] {
  return (this.stmtGetMonitoring.all() as Record<string, unknown>[]).map(r => this.mapRow(r));
}
```

### SellLadder.sell() signature (from sell-ladder.ts)
```typescript
// Source: src/execution/sell/sell-ladder.ts (verified in codebase)
// Handles MONITORING→SELLING transition internally
async sell(mint: string, tokenAmount: bigint): Promise<SellResult>
```

### Config Schema Pattern (from trading.ts — how to add new section)
```typescript
// Source: src/config/trading.ts (verified in codebase)
// Extend TradingConfigSchema with positionManagement key
const TradingConfigSchema = z.object({
  // ... existing fields ...
  positionManagement: PositionManagementConfigSchema,  // add this
});
```

### Shutdown Integration Pattern (from index.ts)
```typescript
// Source: src/index.ts (verified in codebase)
// PositionManager must be stopped in shutdown() alongside other managers
async function shutdown(signal, rpcManager, detectionManager, tradeStore, positionManager) {
  positionManager.stop();  // Clears the setTimeout, no async needed
  // ... rest of shutdown ...
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| WebSocket price feeds (Pyth) for monitoring | Jupiter quote polling | N/A for this codebase | Jupiter covers any token with a route; no extra dependency |
| `setInterval` with async callback | Recursive `setTimeout` | Longstanding Node.js best practice | Prevents tick overlap |
| Hard-coded exit thresholds | Configurable via config.jsonc + Zod | Phase 7 design | Consistent with existing config pattern |

**Existing fields to reuse (already in TradingConfigSchema):**
- `maxConcurrentPositions: z.number().int().min(1).max(50)` — already validated
- `stopLossPct: z.number().negative()` — already validated (Phase 7 uses this)
- `takeProfitPct: z.number().positive()` — already in schema but unused by execution; Phase 7 uses it

**Deprecated:** `takeProfitPct` as a simple multiplier is superseded by the tiered TP ladder. The tiered ladder is the primary exit mechanism; `takeProfitPct` can be removed or repurposed as a fallback for non-tiered mode. Claude's discretion applies.

## Open Questions

1. **PumpPortal amountTokens backfill**
   - What we know: PumpPortal trades enter MONITORING with `amountTokens = undefined`; Phase 5-02 comment defers resolution to Phase 7
   - What's unclear: Should PositionManager query on-chain balance at startup for these, or add a `TradeStore.updateTokenAmount()` method? The RecoveryManager already has `getWalletTokenBalance()` which does this RPC call
   - Recommendation: PositionManager should call the same on-chain balance query pattern at initialization for any MONITORING trade with `amountTokens = null`. Add a `TradeStore.setMonitoringTokenAmount(mint, amount)` helper that sets `amount_tokens` without state transition (use a dedicated prepared statement or extend the COALESCE update).

2. **Partial sell token amount precision for tiered TP**
   - What we know: `trade.amountTokens` is `number` (REAL in SQLite). After a partial sell, the remaining token count needs updating in the DB.
   - What's unclear: Does `TradeStore.transition()` need a new mode that updates `amountTokens` without changing state (MONITORING→MONITORING)?
   - Recommendation: Add `TradeStore.updateMonitoringAmount(mint, newAmountTokens)` — a dedicated prepared statement for in-state updates. Or extend the `transition()` method to allow same-state updates when `from === to`.

3. **High watermark for trailing stop on recovered positions**
   - What we know: RecoveryManager loads MONITORING trades but doesn't set high watermarks (no PositionManager in Phase 6).
   - What's unclear: On restart, should the watermark be initialized to `currentValueSol` (query Jupiter at startup) or to `entryValueSol` (conservative)?
   - Recommendation: Initialize to `entryValueSol` (= `trade.amountSol`) on startup for simplicity. This means trailing stop resets to entry price after a crash — slightly more conservative but correct.

4. **Rate limit safety at max concurrent positions**
   - What we know: Free tier = 60 req/min. At 5-second intervals, 5+ concurrent positions exceeds this.
   - What's unclear: Should the config include a warning when `maxConcurrentPositions > 5` and `pollIntervalMs = 5000`?
   - Recommendation: Add a startup log warning when the computed rate exceeds 50 req/min (safety margin below 60). No hard error.

## Sources

### Primary (HIGH confidence)
- `src/execution/sell/standard-seller.ts` — Jupiter quote URL format, outAmount type, token→SOL direction
- `src/execution/execution-engine.ts` — amountTokens storage, buyPriceSol calculation, MONITORING state transition
- `src/persistence/trade-store.ts` — getMonitoringTrades(), Trade interface, transition() optimistic lock pattern
- `src/execution/sell/sell-ladder.ts` — sell() signature, MONITORING→SELLING transition ownership
- `src/recovery/recovery-manager.ts` — getWalletTokenBalance() pattern for on-chain balance queries
- `src/config/trading.ts` — existing TradingConfigSchema shape, Zod patterns, existing fields
- `src/index.ts` — startup order, shutdown pattern, token event handler wiring
- `https://dev.jup.ag/api-reference/swap/quote` — outAmount field definition (raw lamports string)

### Secondary (MEDIUM confidence)
- `https://dev.jup.ag/portal/rate-limit` — Jupiter free tier: 60 req/min sliding window, 429 on exceed

### Tertiary (LOW confidence)
- Node.js recursive setTimeout pattern for async polling — well-established community pattern, no single authoritative source

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies; all APIs already verified in codebase
- Architecture: HIGH — patterns directly derived from existing code patterns (standard-seller, sell-ladder, recovery-manager)
- Pitfalls: HIGH — most pitfalls derived from Phase 5-06 accumulated decisions and direct code analysis; rate limits verified against official Jupiter docs
- Config schema: HIGH — Zod patterns verified from existing trading.ts

**Research date:** 2026-02-27
**Valid until:** 2026-03-13 (Jupiter API endpoint stable; 14 days for fast-moving Solana ecosystem)
