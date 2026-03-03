# Phase 12: Dry Run Functionality - Research

**Researched:** 2026-03-03
**Domain:** Interceptor pattern over existing execution layer + SQLite schema migration + Preact dashboard integration
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Shadow Price Tracking**
- Included in scope — after a dry-run "buy" is intercepted, the trade enters PositionManager for continued Jupiter price polling
- Shadow P&L shows what stop-loss, take-profit (tiered), and trailing stop triggers would have been
- Entry price captured from the real Jupiter/PumpPortal quote response at interception time (actual market price, not a placeholder)
- Dry-run trades count toward `maxConcurrentPositions` — full simulation fidelity

**Trade Lifecycle**
- Dry-run trades follow the full state machine: BUYING → MONITORING → SELLING → COMPLETED
- Crash recovery does NOT resume dry-run trades — on restart, dry-run MONITORING trades are abandoned. Shadow tracking is ephemeral within a session

**Dashboard Integration**
- Dry-run trades appear inline in the Live Feed with a visual badge (e.g., "DRY RUN" badge, distinct color/opacity) — no separate tab
- Header stats (total P&L, win rate, trade count) exclude dry-run trades — dry-run P&L shown per-trade in the feed only
- Prominent "DRY RUN MODE" banner/indicator in the dashboard header when `dryRun` is enabled — prevents confusion about whether real SOL is at risk. Toggleable from Settings tab

**Persistence**
- `dry_run` column added to trades table (INTEGER, 0 or 1) with schema migration
- `dryRun` field added to `TradingConfigSchema` (Zod) — default `false`, patchable at runtime via dashboard Settings

**Logging**
- Structured log fields per intercepted trade: mint, source, safety score, buy amount, route, slippage, priority fee, expected tokens, blockhash, synthetic signature (`DRY_RUN_<timestamp>`)
- No serialized TX bytes in logs — structured fields are sufficient

**Gate Points (from DRYRUN.md)**
- Gate 1: `broadcastAndConfirm()` in `broadcaster.ts` — intercepts before `tx.sign()`, returns synthetic `BroadcastResult` with placeholder signature. Covers all Jupiter buys, all PumpPortal buys, and 4/6 sell ladder steps (STANDARD, HIGH_FEE, CHUNKED, EMERGENCY)
- Gate 2: `jitoSell()` in `jito-seller.ts` — intercepts before Jito bundle submission. Covers the JITO_BUNDLE sell step

### Claude's Discretion

- Sell trigger behavior: whether to invoke dry-run sell ladder or just log trigger events
- Runtime toggle handling: per-trade dry_run flag behavior when mode switches
- Log level choice for dry-run interceptions
- Dashboard badge styling and banner design
- Synthetic signature format details

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope
</user_constraints>

---

## Summary

Phase 12 implements a dry-run mode that runs the full bot pipeline against mainnet but intercepts at two gate points before any signing or broadcasting occurs. The architecture is already highly centralized: `broadcastAndConfirm()` in `broadcaster.ts` is the single function every buy and every sell path flows through, and `jitoSell()` in `jito-seller.ts` handles the Jito bundle path independently. Importantly, `pumpPortalSell()` also calls `broadcastAndConfirm()` for final signing — it is covered by Gate 1. The CONTEXT.md claim that two gates cover everything is confirmed correct.

The main work is: (1) adding `dryRun: boolean` to `TradingConfigSchema` and threading `getRuntimeConfig().dryRun` through call sites, (2) inserting early-return interceptors in both gate points that return synthetic `BroadcastResult` and log structured fields, (3) migrating the SQLite schema with a `dry_run` column so dry-run trades are persistently flagged, (4) updating `RecoveryManager` to abandon dry-run MONITORING trades on restart rather than recovering them, (5) updating dashboard stats queries to exclude dry-run trades, and (6) adding DRY RUN badges in LiveFeed and a header banner when mode is active.

The sell trigger decision (Claude's Discretion) resolves cleanly as: log-only trigger events rather than invoking the full dry-run sell ladder. The PositionManager already has all the evaluation logic; it just needs a check before calling `fireSell()` — if the trade is a dry-run, log the trigger that would have fired and transition MONITORING → COMPLETED directly, skipping the actual sell ladder call. This preserves full simulation fidelity (you see stop-loss/TP/trailing-stop events) without adding a parallel mock sell path.

**Primary recommendation:** Thread `dryRun` from `getRuntimeConfig()` through gate points and PositionManager; keep implementation additions minimal and co-located with existing patterns.

---

## Standard Stack

### Core (already in project — no new dependencies)

| Component | Version/Location | Purpose | Why Standard |
|-----------|-----------------|---------|--------------|
| `TradingConfigSchema` (Zod) | `src/config/trading.ts` | Config field + runtime toggle | Already used for all config; `patchRuntimeConfig()` is the patch path |
| `MIGRATION_SQL` array | `src/persistence/schema.ts` | `dry_run` column migration | Established migration pattern from Phase 10 `source` and `token_program_id` columns |
| `broadcastAndConfirm()` | `src/execution/broadcaster.ts` | Gate 1 interception point | Already the single broadcast function for ALL execution paths including pumpPortalSell |
| `jitoSell()` | `src/execution/sell/jito-seller.ts` | Gate 2 interception point | Already the only Jito bundle submission function |
| `createModuleLogger()` | `src/core/logger.ts` | Structured pino logging | Per-module structured logging is the project standard |
| `botEventBus` | `src/dashboard/bot-event-bus.ts` | Emit dry-run events to SSE feed | Single SSE event channel for all dashboard feed events |
| `getRuntimeConfig()` | `src/config/trading.ts` | Live dryRun flag access | Runtime config allows dashboard toggle without restart |
| Preact signals | `dashboard/src/store/` | Frontend state management | Already used in `feed.ts` and `config.ts` |

**Installation:** No new packages required.

---

## Architecture Patterns

### Recommended Project Structure (additions only)

```
src/
├── config/
│   └── trading.ts           # Add dryRun: z.boolean().default(false) to TradingConfigSchema
├── execution/
│   ├── broadcaster.ts       # Gate 1: early return before tx.sign() when dryRun
│   └── sell/
│       └── jito-seller.ts   # Gate 2: early return before fetch(JITO_BUNDLE_URL) when dryRun
├── position/
│   └── position-manager.ts  # Log-only trigger path for dry-run trades
├── persistence/
│   ├── schema.ts            # dry_run INTEGER column + MIGRATION_SQL entry
│   └── trade-store.ts       # Thread dry_run through createBuyingRecord(), mapRow(), queries
├── recovery/
│   └── recovery-manager.ts  # Abandon dry-run MONITORING trades on restart
├── types/
│   └── index.ts             # Add dryRun?: boolean to Trade interface
└── dashboard/
    ├── bot-event-bus.ts     # Add isDryRun?: boolean to BotEvent interface
    └── routes/
        ├── trades.ts        # Exclude dry_run=1 from stats queries
        └── config.ts        # Add dryRun to ConfigPatchSchema

dashboard/src/
├── components/
│   ├── Header.tsx           # Add DRY RUN MODE banner (reads dryRun from configSignal)
│   ├── LiveFeed.tsx         # Add DRY RUN badge color + rendering for dry-run events
│   └── Settings.tsx         # Add dryRun toggle checkbox
└── store/
    └── feed.ts              # Add isDryRun?: boolean to FeedEvent interface
```

### Pattern 1: Gate Interception (Early Return)

**What:** Check `getRuntimeConfig().dryRun` at the top of both gate functions. If true, log structured fields and return a synthetic result without signing or broadcasting.

**When to use:** Any execution path that would sign or broadcast a transaction.

**Gate 1 — `broadcastAndConfirm()` in broadcaster.ts:**
```typescript
// Source: existing broadcaster.ts pattern, adapted for dry-run
export async function broadcastAndConfirm(
  tx: VersionedTransaction,
  wallet: Keypair,
  connections: Connection[],
  options: BroadcastOptions = {}
): Promise<BroadcastResult> {
  if (connections.length === 0) {
    throw new Error('broadcastAndConfirm: no RPC connections provided');
  }

  // DRY RUN GATE 1: intercept before signing/broadcasting
  if (getRuntimeConfig().dryRun) {
    // Still fetch a real blockhash — captures the actual chain state at interception time
    const { blockhash, lastValidBlockHeight } = await connections[0].getLatestBlockhash('processed');
    const syntheticSig = `DRY_RUN_${Date.now()}`;
    log.info(
      { dryRun: true, blockhash, syntheticSignature: syntheticSig },
      '[DRY RUN] broadcastAndConfirm intercepted — tx NOT signed or broadcast'
    );
    return { signature: syntheticSig, blockhash, lastValidBlockHeight };
  }

  // ... existing signing and broadcast code unchanged below
```

Note: `pumpPortalSell()` calls `broadcastAndConfirm()` after getting unsigned TX bytes from the PumpPortal HTTP API. Gate 1 intercepts at signing time — the HTTP fetch to PumpPortal still runs (to get the unsigned TX), but signing and broadcasting are skipped. This is acceptable for a dry-run: the PumpPortal HTTP call is read-only (gets a TX to sign; does not commit anything).

**Gate 2 — `jitoSell()` in jito-seller.ts:**
```typescript
// DRY RUN GATE 2: intercept before Jito bundle submission
// Insert after Step 2 (swap tx signed) but before Step 4 (fetch JITO_BUNDLE_URL)
if (getRuntimeConfig().dryRun) {
  const syntheticSig = `DRY_RUN_JITO_${Date.now()}`;
  log.info(
    { dryRun: true, mint, syntheticSignature: syntheticSig },
    '[DRY RUN] jitoSell intercepted — bundle NOT submitted to Jito'
  );
  return syntheticSig;
}
```

Note on `jitoSell()` placement: The gate must be inserted BEFORE the `fetch(JITO_BUNDLE_URL)` call (Step 4) but ideally after Jupiter quote and swap TX construction (Steps 1-2), so the log captures real route data. The wallet key signing (Step 2, line 83: `swapTx.sign([wallet])`) happens before the gate would fire — this is fine since `jitoSell()` has its own signing flow outside `broadcastAndConfirm()`. The gate stops the Jito submission; the signed bytes are discarded.

Alternatively, insert the gate before Step 1 (before any Jupiter quote call) to avoid unnecessary API calls during dry-run. Either is correct; before Step 1 is simpler and wastes no API rate budget.

### Pattern 2: Schema Migration (Established Pattern)

**What:** Add `dry_run INTEGER` to the trades table via `MIGRATION_SQL`.

**When to use:** Any time a column is added to an existing table.

```typescript
// Source: established MIGRATION_SQL pattern from src/persistence/schema.ts
export const MIGRATION_SQL = [
  `ALTER TABLE trades ADD COLUMN source TEXT`,
  `ALTER TABLE trades ADD COLUMN token_program_id TEXT`,
  `ALTER TABLE trades ADD COLUMN dry_run INTEGER`,  // Phase 12: nullable, treated as false when null
];
```

Use nullable `INTEGER` (not `NOT NULL DEFAULT 0`) to be consistent with how other optional columns (`source`, `token_program_id`) are handled in this project. In `mapRow()`, use `Boolean(row['dry_run'])` which correctly evaluates `null` as `false`.

### Pattern 3: Config Field Addition (Zod)

**What:** Add `dryRun: z.boolean().default(false)` to `TradingConfigSchema`.

```typescript
// Source: src/config/trading.ts pattern
const TradingConfigSchema = z.object({
  buyAmountSol: z.number().positive().max(10),
  // ... existing fields ...
  dryRun: z.boolean().default(false),  // Phase 12: dry-run mode flag
});
```

Also add to `ConfigPatchSchema` in `dashboard/routes/config.ts`:
```typescript
const ConfigPatchSchema = z.object({
  // ... existing fields ...
  dryRun: z.boolean().optional(),  // Phase 12: dry-run toggle
});
```

### Pattern 4: Dry-Run Trade Flag Threading

**What:** Pass `dryRun` flag from `getRuntimeConfig()` through `createBuyingRecord()` and subsequent `mapRow()` so the Trade object carries `dryRun: boolean`.

**Current `createBuyingRecord()` signature:**
```typescript
createBuyingRecord(mint: string, source?: string, tokenProgramId?: string): void
```

**Updated signature:**
```typescript
createBuyingRecord(mint: string, source?: string, tokenProgramId?: string, dryRun = false): void
```

The `stmtInsert` prepared statement gains `@dry_run` parameter. The `mapRow()` private method maps `row['dry_run']` to `boolean` via `Boolean()`. The `Trade` interface in `src/types/index.ts` gains `dryRun?: boolean`.

### Pattern 5: Recovery Skip for Dry-Run Trades

**What:** RecoveryManager abandons dry-run MONITORING trades on restart instead of loading them.

Per locked decision: "on restart, dry-run MONITORING trades are abandoned."

```typescript
// Source: recovery-manager.ts Step 5 (MONITORING trades)
// In Step 5: Count MONITORING trades
const monitoringTrades = this.tradeStore.getMonitoringTrades();

// Abandon dry-run MONITORING trades — shadow tracking is ephemeral
for (const trade of monitoringTrades) {
  if (trade.dryRun) {
    this.tradeStore.transition(trade.mint, 'MONITORING', 'ABANDONED', {
      errorMessage: 'RECOVERY: dry-run trade abandoned on restart',
    });
    dryRunAbandoned++;
  }
}

monitoring = monitoringTrades.filter(t => !t.dryRun).length;
```

The `getMonitoringTrades()` query returns `dry_run` once `mapRow()` is updated. No new query needed. The `transition()` to ABANDONED calls `activeMints.delete(mint)` automatically (TERMINAL_STATES includes ABANDONED).

### Pattern 6: PositionManager Log-Only Trigger for Dry-Run Trades

**What:** In `evaluatePosition()`, after exit trigger evaluation, check if the trade is a dry-run. If so, log the trigger event and transition MONITORING → COMPLETED directly, skipping `fireSell()`.

**Rationale (Claude's Discretion):** Log-only is simpler than a full mock sell path. The trigger log entries provide the shadow P&L visibility the user wants. A dry-run "sell" completing is not meaningful — the value is in knowing what trigger fired and when.

```typescript
// Source: position-manager.ts evaluatePosition() pattern
// evaluatePosition() receives `trade: Trade` — add dryRun check before fireSell() calls

// In evaluatePosition, replace each fireSell() call with:
if (trade.dryRun) {
  log.info(
    { dryRun: true, mint, trigger: 'TIERED_TP', tier: tierIndex, at: activeTier.at, ratio: ratio.toFixed(3) },
    '[DRY RUN] take-profit would have triggered'
  );
  this.tradeStore.transition(mint, 'MONITORING', 'COMPLETED', {
    errorMessage: `DRY_RUN_TRIGGER: TIERED_TP_${tierIndex}`,
  });
  return;
}
this.fireSell(mint, tokensToSell);
```

This way dry-run trades complete the full state machine (MONITORING → COMPLETED) while producing useful log output. The `evaluatePosition()` method needs `trade: Trade` passed in — this is already the case (it receives the full `Trade` object from `getMonitoringTrades()`).

### Pattern 7: Dashboard Stats Exclusion

**What:** The `/api/stats` SQL query excludes `dry_run = 1` trades from all aggregate counts.

```typescript
// Source: dashboard/routes/trades.ts pattern
const completedRow = db.prepare(
  `SELECT
     COUNT(*) as total,
     SUM(CASE WHEN state = 'COMPLETED' THEN 1 ELSE 0 END) as completed,
     SUM(CASE WHEN state = 'FAILED' OR state = 'ABANDONED' THEN 1 ELSE 0 END) as failed,
     SUM(CASE WHEN sell_price_sol IS NOT NULL AND buy_price_sol IS NOT NULL
              THEN sell_price_sol - buy_price_sol ELSE 0 END) as total_pnl_sol
   FROM trades
   WHERE state IN ('COMPLETED','FAILED','ABANDONED')
     AND (dry_run IS NULL OR dry_run = 0)`
).get() as { total: number; completed: number; failed: number; total_pnl_sol: number };
```

### Pattern 8: Dashboard DRY RUN Badge and Banner

**What:** The Preact frontend adds a DRY RUN badge color and a header banner.

**LiveFeed badge (existing BADGE_COLORS pattern):**
```typescript
// Source: dashboard/src/components/LiveFeed.tsx BADGE_COLORS pattern
// BotEvent carries isDryRun?: boolean on the payload (added to BotEvent interface)
// FeedRow renders an additional badge when event.isDryRun is true
function FeedRow({ event }: { event: FeedEvent }) {
  const color = BADGE_COLORS[event.type] ?? 'var(--gray)';
  const isDryRun = event.isDryRun;
  return (
    <div style={{ padding: '0.25rem 1rem', borderBottom: '1px solid var(--border)',
                  fontSize: '0.85rem',
                  opacity: isDryRun ? 0.7 : 1 }}>
      {isDryRun && (
        <span style={{ color: 'var(--yellow)', border: '1px solid var(--yellow)',
                       padding: '0 0.25rem', marginRight: '0.4rem', fontSize: '0.75rem' }}>
          DRY RUN
        </span>
      )}
      {/* existing content unchanged */}
    </div>
  );
}
```

**Header banner (reads dryRun from configSignal):**
```typescript
// Source: dashboard/src/components/Header.tsx pattern
// Header already polls /api/config every 5s — configSignal.value is the live config
// Add banner between SOLSNIPER title and stats, or as a full-width bar below the header
const isDryRun = Boolean(configSignal.value?.dryRun);

{isDryRun && (
  <div style={{ background: 'var(--yellow)', color: '#000',
                textAlign: 'center', padding: '0.4rem',
                fontFamily: 'var(--mono)', fontWeight: 'bold', letterSpacing: '0.1em' }}>
    DRY RUN MODE — No real SOL at risk
  </div>
)}
```

Note: `Header.tsx` currently uses local `useState` for stats, not `configSignal`. To read `dryRun`, the Header must either import `configSignal` from `../store/config.js` or fetch it separately. The simplest approach: import `configSignal` (already a global signal).

**Settings toggle:**
```typescript
// Source: dashboard/src/components/Settings.tsx pattern
<label style={LABEL_STYLE}>Dry Run Mode
  <input type="checkbox"
    checked={Boolean(draft['dryRun'])}
    onChange={(e) => set(['dryRun'], (e.target as HTMLInputElement).checked)} />
</label>
```

### Anti-Patterns to Avoid

- **Separate dry-run execution path:** Do not create a parallel mock buy/sell flow. Gate interception in `broadcastAndConfirm()` and `jitoSell()` covers everything, including `pumpPortalSell()`.
- **Blocking blockhash fetch in gate:** The gate SHOULD still fetch a real blockhash before returning — this captures the actual chain state for logging and produces a realistic `BroadcastResult.blockhash`. Only signing and broadcasting are skipped.
- **Skipping `maxConcurrentPositions` gate for dry-run:** Locked decision — dry-run trades count toward position limits. No special-casing.
- **Recovering dry-run trades on restart:** Locked decision — abandon them. Do not attempt on-chain balance checks for dry-run trades (they never had real tokens).
- **Including dry-run P&L in header stats:** Locked decision — stats exclude dry-run trades. Only per-trade feed rows show dry-run P&L.
- **Using `tradingConfig` (static) instead of `getRuntimeConfig()` in gate checks:** The dry-run flag must be patchable at runtime via dashboard. Gate checks must use `getRuntimeConfig()`.
- **Adding Gate 2 intercept AFTER `swapTx.sign([wallet])`:** In `jitoSell()`, the swap TX is signed at line 83 before the bundle is submitted. If inserting the gate after signing, the signed bytes are generated but discarded — harmless but wasteful. Prefer inserting the gate early (before Jupiter quote call) to avoid unnecessary API usage.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Synthetic blockhash | Hardcoded placeholder string | Real `getLatestBlockhash()` call | Captures actual chain state at interception; consistent with `BroadcastResult` type contract |
| Config toggle API | Custom endpoint | Existing `POST /api/config` + `patchRuntimeConfig()` | Full runtime patch infrastructure already exists |
| SSE event for dry-run | New SSE channel | Existing `botEventBus.emit()` with `isDryRun: true` field | Single `'event'` emitter handles all feed events; the badge is a rendering detail |
| Schema migration runner | Custom migration logic | Existing `MIGRATION_SQL` try-catch pattern in `TradeStore` constructor | Pattern handles fresh DB (no-op) and existing DB (adds column) correctly |
| Dry-run sell mock | Fake sell ladder execution | Log-only in `PositionManager` + direct MONITORING → COMPLETED transition | No real tokens to sell; trigger logging gives the shadow P&L visibility needed |
| Third gate for PumpPortal sell | Gate in pump-portal-seller.ts | Gate 1 in broadcastAndConfirm() | pumpPortalSell() already calls broadcastAndConfirm() for final signing — Gate 1 covers it |

**Key insight:** This phase is an interceptor insertion, not a new subsystem. Every infrastructure piece (config, persistence, events, dashboard) already exists and is extensible. Gate 1 genuinely covers all non-Jito paths including PumpPortal.

---

## Common Pitfalls

### Pitfall 1: Using Static `tradingConfig` at Gate Points

**What goes wrong:** Gate check reads `tradingConfig.dryRun` (the static initial value) instead of `getRuntimeConfig().dryRun`. Toggling dry-run from the dashboard has no effect — bot continues broadcasting real transactions.

**Why it happens:** `tradingConfig` is the most visible export from `trading.ts`; `getRuntimeConfig()` is the runtime-aware function. The static value was sufficient for earlier phases.

**How to avoid:** Every gate check and every dry-run-sensitive code path must call `getRuntimeConfig().dryRun`. Search for `tradingConfig.dryRun` in code review and reject it.

**Warning signs:** Dashboard toggle changes config response but bot behavior does not change.

### Pitfall 2: jitoSell Gate Placement Causes Jupiter API Waste

**What goes wrong:** The gate in `jitoSell()` is placed after Jupiter quote + swap TX construction (Steps 1-2). Every dry-run sell attempt hits Jupiter API twice (quote + swap transaction) before being intercepted.

**Why it happens:** Placing the gate "as late as possible" to capture route data for logging seems logical but wastes Jupiter API rate budget.

**How to avoid:** Place the Gate 2 check at the very start of `jitoSell()`, before the Jupiter quote call. Logging only needs the `mint` and `tokenAmount` parameters available at function entry. If detailed route data is desired in logs, place gate between quote (Step 1) and swap transaction construction (Step 2) — captures the real route without wasting the swap TX API call.

**Warning signs:** Jupiter rate-limit cooldowns triggered during dry-run sell ladder cycles.

### Pitfall 3: MIGRATION_SQL NOT NULL Constraint

**What goes wrong:** Using `ALTER TABLE trades ADD COLUMN dry_run INTEGER NOT NULL DEFAULT 0` fails on some SQLite versions when adding a `NOT NULL` column to a table with existing rows.

**Why it happens:** SQLite's `ALTER TABLE ADD COLUMN` restrictions. `NOT NULL` without `DEFAULT` is rejected; with `DEFAULT 0` it should work in modern SQLite (3.37+), but the project does not pin SQLite version.

**How to avoid:** Use nullable `INTEGER` (no `NOT NULL` constraint), consistent with how `source TEXT` and `token_program_id TEXT` were added. In `mapRow()`, `Boolean(row['dry_run'])` correctly treats `null` as `false`.

**Warning signs:** `TradeStore` constructor throws `cannot add a NOT NULL column with default value NULL` on startup with an existing database.

### Pitfall 4: BotEvent Payload Extension — Two Interfaces

**What goes wrong:** `BotEvent` interface in `bot-event-bus.ts` gains `isDryRun?: boolean` but the frontend `FeedEvent` interface in `dashboard/src/store/feed.ts` does not. The field is serialized over SSE as JSON but TypeScript sees it as unknown, and the badge never renders.

**Why it happens:** BotEvent (server-side) and FeedEvent (client-side) are separate interfaces. Adding to one does not affect the other.

**How to avoid:** Add `isDryRun?: boolean` to BOTH `BotEvent` in `bot-event-bus.ts` AND `FeedEvent` in `dashboard/src/store/feed.ts`. The SSE serialization is JSON — the field flows through automatically as long as both interfaces declare it.

### Pitfall 5: Recovery Manager Dry-Run Skip vs Abandon

**What goes wrong:** Recovery Step 5 filters dry-run trades from the monitoring count but does NOT call `transition(mint, 'MONITORING', 'ABANDONED', ...)`. Dry-run MONITORING trades persist in the DB indefinitely, counting against `maxConcurrentPositions` on every restart.

**Why it happens:** "Skip" and "abandon" are different operations. Filtering means don't pass them to PositionManager. Abandoning means remove from DB's active states.

**How to avoid:** Explicitly call `tradeStore.transition(mint, 'MONITORING', 'ABANDONED', ...)` for each dry-run MONITORING trade. The `transition()` to ABANDONED removes from `activeMints` Set automatically (TERMINAL_STATES includes ABANDONED).

### Pitfall 6: `stmtGetMonitoring` Missing `dry_run` Column

**What goes wrong:** Prepared statements in `TradeStore` have hard-coded column lists. After migration, `dry_run` exists in the DB but is not selected — `mapRow()` gets `undefined` for `row['dry_run']` and `Boolean(undefined)` is `false`. Dry-run MONITORING trades on restart are treated as real trades and subjected to on-chain balance checks.

**Why it happens:** Prepared statements list columns explicitly. Adding a column to the table does not automatically add it to existing SELECTs.

**How to avoid:** Update the SELECT list in `stmtGetMonitoring`, `stmtGetBuying`, `stmtGetSelling`, `stmtGetByMint` (and any other statement returning Trade rows) to include `dry_run`. Also update `stmtInsert` to include `@dry_run` in the INSERT.

### Pitfall 7: Header Component Not Subscribing to configSignal

**What goes wrong:** `Header.tsx` currently uses local `useState` for stats from `/api/stats`. It does not import `configSignal`. Adding a DRY RUN banner that reads `configSignal.value?.dryRun` requires importing the signal — but if the component does not subscribe to it, the banner may not re-render reactively when dryRun is toggled.

**Why it happens:** Preact signals auto-subscribe components that read `.value` in their render — this works if the component renders with `configSignal.value` directly. But if the component is not importing and reading the signal, no subscription occurs.

**How to avoid:** Import `configSignal` in `Header.tsx` and read `configSignal.value?.dryRun` directly in the render function (not in an effect). Preact signals will auto-subscribe and re-render on change.

---

## Code Examples

### Broadcaster Gate (verified pattern)

```typescript
// Source: src/execution/broadcaster.ts — existing function signature and flow
// Addition: gate check at function entry, before existing logic

import { getRuntimeConfig } from '../config/trading.js';

export async function broadcastAndConfirm(
  tx: VersionedTransaction,
  wallet: Keypair,
  connections: Connection[],
  options: BroadcastOptions = {}
): Promise<BroadcastResult> {
  if (connections.length === 0) {
    throw new Error('broadcastAndConfirm: no RPC connections provided');
  }

  // DRY RUN GATE: intercept before signing (EXE-04 note: blockhash still fetched for realism)
  if (getRuntimeConfig().dryRun) {
    const { blockhash, lastValidBlockHeight } = await connections[0].getLatestBlockhash('processed');
    const signature = `DRY_RUN_${Date.now()}`;
    log.info({ dryRun: true, signature, blockhash }, '[DRY RUN] broadcastAndConfirm intercepted');
    return { signature, blockhash, lastValidBlockHeight };
  }

  // Existing code: EXE-04 blockhash fetch, sign, broadcast (unchanged)
  const { blockhash, lastValidBlockHeight } = await connections[0].getLatestBlockhash('processed');
  tx.message.recentBlockhash = blockhash;
  tx.sign([wallet]);
  // ...
}
```

### jitoSell Gate (verified pattern)

```typescript
// Source: src/execution/sell/jito-seller.ts — existing function signature
// Gate inserted at function entry, before Jupiter quote call

import { getRuntimeConfig } from '../../config/trading.js';

export async function jitoSell(
  mint: string,
  tokenAmount: bigint,
  config: TradingConfig,
  wallet: Keypair,
  connections: Connection[]
): Promise<string> {
  // DRY RUN GATE: intercept before Jito bundle submission (and Jupiter quote)
  if (getRuntimeConfig().dryRun) {
    const signature = `DRY_RUN_JITO_${Date.now()}`;
    log.info({ dryRun: true, mint, tokenAmount: tokenAmount.toString(), signature },
      '[DRY RUN] jitoSell intercepted — bundle NOT submitted');
    return signature;
  }

  // Existing code: Jupiter quote, swap TX, tip TX, bundle submission (unchanged)
  const { sell } = config.execution;
  // ...
}
```

### Schema Migration (verified pattern)

```typescript
// Source: src/persistence/schema.ts — MIGRATION_SQL established pattern
export const MIGRATION_SQL = [
  `ALTER TABLE trades ADD COLUMN source TEXT`,
  `ALTER TABLE trades ADD COLUMN token_program_id TEXT`,
  `ALTER TABLE trades ADD COLUMN dry_run INTEGER`,  // Phase 12: nullable, null treated as false in mapRow
];
```

### createBuyingRecord Extension (verified pattern)

```typescript
// Source: src/persistence/trade-store.ts — createBuyingRecord signature extension
createBuyingRecord(mint: string, source?: string, tokenProgramId?: string, dryRun = false): void {
  if (this.activeMints.has(mint)) {
    throw new Error(`Duplicate buy attempt blocked for mint: ${mint}`);
  }

  const now = Date.now();
  this.stmtInsert.run({
    mint,
    state: 'BUYING',
    now,
    source: source ?? null,
    token_program_id: tokenProgramId ?? null,
    dry_run: dryRun ? 1 : 0,
  });
  this.activeMints.add(mint);
  log.debug({ mint, dryRun }, 'createBuyingRecord: inserted BUYING row');
}
```

### mapRow Extension (verified pattern)

```typescript
// Source: src/persistence/trade-store.ts — mapRow private method
private mapRow(row: Record<string, unknown>): Trade {
  return {
    // ... existing fields ...
    dryRun: Boolean(row['dry_run']),   // Phase 12: null/0 → false, 1 → true
  };
}
```

### Trade Interface Extension (verified pattern)

```typescript
// Source: src/types/index.ts — Trade interface addition
export interface Trade {
  id: number;
  mint: string;
  state: TradeState;
  createdAt: number;
  updatedAt: number;
  buySignature?: string;
  sellSignature?: string;
  amountSol?: number;
  amountTokens?: number;
  buyPriceSol?: number;
  sellPriceSol?: number;
  errorMessage?: string;
  source?: string;
  tokenProgramId?: string;
  dryRun?: boolean;        // Phase 12: true = dry-run trade, false/undefined = real trade
}
```

### index.ts Call Site (verified pattern)

```typescript
// Source: src/index.ts — createBuyingRecord() call site (line 184)
// Pass getRuntimeConfig().dryRun as fourth argument
tradeStore.createBuyingRecord(event.mint, event.source, result.programId, getRuntimeConfig().dryRun);
```

### Stats Query Exclusion (verified pattern)

```typescript
// Source: dashboard/routes/trades.ts — completedRow query
// Add AND (dry_run IS NULL OR dry_run = 0) to WHERE clause
const completedRow = db.prepare(
  `SELECT
     COUNT(*) as total,
     SUM(CASE WHEN state = 'COMPLETED' THEN 1 ELSE 0 END) as completed,
     SUM(CASE WHEN state = 'FAILED' OR state = 'ABANDONED' THEN 1 ELSE 0 END) as failed,
     SUM(CASE WHEN sell_price_sol IS NOT NULL AND buy_price_sol IS NOT NULL
              THEN sell_price_sol - buy_price_sol ELSE 0 END) as total_pnl_sol
   FROM trades
   WHERE state IN ('COMPLETED','FAILED','ABANDONED')
     AND (dry_run IS NULL OR dry_run = 0)`
).get() as { total: number; completed: number; failed: number; total_pnl_sol: number };
```

---

## State of the Art

| Old Approach | Current Approach | Phase Changed | Impact |
|--------------|-----------------|---------------|--------|
| No dry-run capability | Full pipeline dry-run with two gate points | Phase 12 | Validation and strategy tuning without real SOL risk |
| `tradingConfig` (static) for gate checks | `getRuntimeConfig()` for live toggle support | Phase 8 (dashboard) | dryRun can be toggled at runtime from Settings |
| Migration: try-catch ALTER TABLE | Migration: try-catch ALTER TABLE (same pattern) | Phase 10 | Established; use same approach |

**Gate coverage confirmed:** `pumpPortalSell()` was examined and confirmed to call `broadcastAndConfirm()` for final signing and broadcasting. Gate 1 covers it. The CONTEXT.md and DRYRUN.md claim that "two gates cover the entire execution layer" is verified correct.

---

## Open Questions

1. **jitoSell gate position relative to Jupiter API calls**
   - What we know: Inserting gate at function entry (before Jupiter quote) avoids wasting API rate budget. Inserting after Jupiter quote captures route data for richer log output.
   - What's unclear: How much log detail is needed for dry-run Jito sell interceptions.
   - Recommendation: Insert gate at function entry. The `mint` and `tokenAmount` in the log are sufficient for dry-run purposes. Jupiter rate budget is shared with PositionManager monitoring and is more valuable than richer Jito dry-run logs.

2. **BotEvent `isDryRun` field vs separate event types**
   - What we know: `BotEvent` is typed with fixed `BotEventType` values. Adding `isDryRun?: boolean` to the payload is the minimal change.
   - What's unclear: Whether separate event types (e.g., `DRY_RUN_BUY_INTERCEPTED`) would be cleaner for frontend filtering.
   - Recommendation: Add `isDryRun?: boolean` to `BotEvent` payload. No new event types needed — the frontend already routes all events to the feed; the badge is a rendering detail, not a routing concern.

3. **Concurrent position count with dry-run toggle mid-session**
   - What we know: Dry-run trades count toward `maxConcurrentPositions` (locked decision). If dryRun is toggled off mid-session, existing dry-run MONITORING trades remain in the store and still count.
   - What's unclear: Whether this creates a confusing UX (toggling to live mode but positions are "full" with dry-run trades).
   - Recommendation: Per-trade `dry_run` flag means the trade retains its nature regardless of config changes. Toggling dryRun off means new buys are real; existing dry-run MONITORING trades continue as dry-run until they trigger (then log-only complete). No special handling needed — this is clean and predictable.

---

## Implementation Order (for planner)

The dependency chain is clear. Two plans are recommended:

**Plan 1 — Backend Core:**
1. `src/types/index.ts` — Add `dryRun?: boolean` to `Trade` interface
2. `src/config/trading.ts` — Add `dryRun: z.boolean().default(false)` to TradingConfigSchema
3. `src/persistence/schema.ts` — Add `dry_run INTEGER` to MIGRATION_SQL
4. `src/persistence/trade-store.ts` — Update `stmtInsert`, all SELECT statements, `mapRow()`, `createBuyingRecord()` signature
5. `src/execution/broadcaster.ts` — Gate 1 interception (covers all buy paths + STANDARD/HIGH_FEE/CHUNKED/EMERGENCY/PUMPPORTAL sell steps)
6. `src/execution/sell/jito-seller.ts` — Gate 2 interception (covers JITO_BUNDLE sell step)
7. `src/recovery/recovery-manager.ts` — Abandon dry-run MONITORING on restart
8. `src/position/position-manager.ts` — Log-only trigger path for dry-run trades
9. `src/index.ts` — Pass `getRuntimeConfig().dryRun` to `createBuyingRecord()`
10. `config.jsonc` — Add `"dryRun": false` with inline comment

**Plan 2 — Dashboard:**
1. `src/dashboard/bot-event-bus.ts` — Add `isDryRun?: boolean` to `BotEvent`
2. `src/dashboard/routes/config.ts` — Add `dryRun` to `ConfigPatchSchema`
3. `src/dashboard/routes/trades.ts` — Exclude dry-run from stats query
4. `dashboard/src/store/feed.ts` — Add `isDryRun?: boolean` to `FeedEvent`
5. `dashboard/src/components/LiveFeed.tsx` — DRY RUN badge rendering
6. `dashboard/src/components/Header.tsx` — DRY RUN MODE banner (import configSignal)
7. `dashboard/src/components/Settings.tsx` — dryRun toggle checkbox

---

## Sources

### Primary (HIGH confidence)

- Direct code reading of `src/execution/broadcaster.ts` — gate point structure, `BroadcastResult` type, signing flow (lines 48-121)
- Direct code reading of `src/execution/sell/jito-seller.ts` — Jito gate point, `fetch(JITO_BUNDLE_URL)` at line 104, signing at line 83
- Direct code reading of `src/execution/sell/pump-portal-seller.ts` — confirmed calls `broadcastAndConfirm()` at line 64; covered by Gate 1
- Direct code reading of `src/persistence/schema.ts` — `MIGRATION_SQL` established pattern
- Direct code reading of `src/persistence/trade-store.ts` — `createBuyingRecord()`, `mapRow()`, all prepared statement column lists
- Direct code reading of `src/config/trading.ts` — `TradingConfigSchema`, `getRuntimeConfig()`, `patchRuntimeConfig()`
- Direct code reading of `src/position/position-manager.ts` — `evaluatePosition()`, `fireSell()` fire-and-forget pattern, `Trade` parameter access
- Direct code reading of `src/recovery/recovery-manager.ts` — recovery step ordering, MONITORING trade handling in Step 5
- Direct code reading of `src/types/index.ts` — `Trade` interface, `BroadcastResult` type
- Direct code reading of `src/dashboard/bot-event-bus.ts` — `BotEvent` interface, singleton pattern
- Direct code reading of `src/dashboard/routes/trades.ts` — stats SQL query with raw DB cast
- Direct code reading of `src/dashboard/routes/config.ts` — `ConfigPatchSchema` pattern
- Direct code reading of `dashboard/src/components/LiveFeed.tsx` — `BADGE_COLORS`, `FeedRow` pattern
- Direct code reading of `dashboard/src/components/Header.tsx` — stats polling, inline style pattern, local useState (not configSignal)
- Direct code reading of `dashboard/src/components/Settings.tsx` — form fields, save pattern
- Direct code reading of `dashboard/src/store/feed.ts` — `FeedEvent` interface, SSE subscription
- `.planning/phases/12-dry-run-functionality/12-CONTEXT.md` — all locked decisions and discretion areas
- `DRYRUN.md` — original design document (confirmed against code)

### Secondary (MEDIUM confidence)

- SQLite `ALTER TABLE ADD COLUMN` nullable handling — verified against project's existing nullable column pattern (`source TEXT`, `token_program_id TEXT`)

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries are in-project; no new dependencies
- Architecture: HIGH — read all integration points from actual source code
- Gate coverage: HIGH — pumpPortalSell confirmed to use broadcastAndConfirm; two gates cover all paths
- Pitfalls: HIGH — derived from direct code inspection, not assumptions

**Research date:** 2026-03-03
**Valid until:** 2026-04-03 (stable codebase; only risk is if execution layer is modified before planning)
