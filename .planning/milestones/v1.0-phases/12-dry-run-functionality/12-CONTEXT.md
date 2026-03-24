# Phase 12: Dry Run Functionality - Context

**Gathered:** 2026-03-02
**Status:** Ready for planning

<domain>
## Phase Boundary

Run the entire real pipeline against mainnet — real detection, real safety checks, real transaction building — but intercept right before signing/broadcasting. Two gate points cover all execution: `broadcastAndConfirm()` in broadcaster.ts and `jitoSell()` in jito-seller.ts. After interception, shadow price tracking continues via PositionManager to show what P&L would have been. Everything is logged so you can see exactly what would have happened.

</domain>

<decisions>
## Implementation Decisions

### Shadow Price Tracking
- Included in scope — after a dry-run "buy" is intercepted, the trade enters PositionManager for continued Jupiter price polling
- Shadow P&L shows what stop-loss, take-profit (tiered), and trailing stop triggers would have been
- Entry price captured from the real Jupiter/PumpPortal quote response at interception time (actual market price, not a placeholder)
- Dry-run trades count toward `maxConcurrentPositions` — full simulation fidelity

### Trade Lifecycle
- Dry-run trades follow the full state machine: BUYING → MONITORING → SELLING → COMPLETED
- Sell trigger behavior: Claude's Discretion (log triggers only vs full dry-run sell ladder — pick the approach that balances fidelity with implementation simplicity)
- When `dryRun` is toggled off at runtime: Claude's Discretion (per-trade flag vs abandon — pick the cleaner approach)
- Crash recovery does NOT resume dry-run trades — on restart, dry-run MONITORING trades are abandoned. Shadow tracking is ephemeral within a session

### Dashboard Integration
- Dry-run trades appear inline in the Live Feed with a visual badge (e.g., "DRY RUN" badge, distinct color/opacity) — no separate tab
- Header stats (total P&L, win rate, trade count) exclude dry-run trades — dry-run P&L shown per-trade in the feed only
- Prominent "DRY RUN MODE" banner/indicator in the dashboard header when `dryRun` is enabled — prevents confusion about whether real SOL is at risk. Toggleable from Settings tab

### Persistence
- `dry_run` column added to trades table (INTEGER, 0 or 1) with schema migration
- `dryRun` field added to `TradingConfigSchema` (Zod) — default `false`, patchable at runtime via dashboard Settings

### Logging
- Structured log fields per intercepted trade: mint, source, safety score, buy amount, route, slippage, priority fee, expected tokens, blockhash, synthetic signature (`DRY_RUN_<timestamp>`)
- No serialized TX bytes in logs — structured fields are sufficient
- Log level and prefix: Claude's Discretion (info with `dryRun: true` field vs warn level — pick what works best with existing pino setup)

### Gate Points (from DRYRUN.md)
- Gate 1: `broadcastAndConfirm()` in `broadcaster.ts` — intercepts before `tx.sign()`, returns synthetic `BroadcastResult` with placeholder signature. Covers all Jupiter buys, all PumpPortal buys, and 4/6 sell ladder steps (STANDARD, HIGH_FEE, CHUNKED, EMERGENCY)
- Gate 2: `jitoSell()` in `jito-seller.ts` — intercepts before Jito bundle submission. Covers the JITO_BUNDLE sell step
- Two gates cover the entire execution layer

### Claude's Discretion
- Sell trigger behavior: whether to invoke dry-run sell ladder or just log trigger events
- Runtime toggle handling: per-trade dry_run flag behavior when mode switches
- Log level choice for dry-run interceptions
- Dashboard badge styling and banner design
- Synthetic signature format details

</decisions>

<specifics>
## Specific Ideas

- "A single boolean flag (dryRun: true in config.jsonc) that lets the bot run the entire real pipeline against mainnet"
- "Not devnet (still uses mainnet data), not simulation (no fake liquidity), not backtesting (real-time only)"
- Log format from DRYRUN.md: `[DRY RUN] BUY intercepted` with mint, source, safety score, buy amount, route, slippage, priority fee, expected tokens, TX accounts, blockhash, and synthetic signature
- Dashboard should make it unmistakably clear when dry-run mode is active — preventing accidental "is it trading real money?" confusion

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `broadcastAndConfirm()` in `src/execution/broadcaster.ts`: Central broadcast function — single gate point for all non-Jito transactions
- `jitoSell()` in `src/execution/sell/jito-seller.ts`: Jito bundle submission — second gate point
- `TradingConfigSchema` (Zod): Already supports `patchRuntimeConfig()` for live dashboard toggling
- `PositionManager`: Already polls Jupiter quotes for active positions — can shadow-track dry-run trades with minimal changes
- `BotEventBus`: SSE event system already emits BUY_SENT, SELL_TRIGGERED etc. — dry-run events can flow through same channel

### Established Patterns
- Schema migrations via `MIGRATION_SQL` array in `src/persistence/schema.ts` — add `dry_run` column same way `source` and `token_program_id` were added
- `createRequire()` for better-sqlite3 ESM interop
- `createModuleLogger()` for per-module pino loggers with structured fields
- `BroadcastResult` type: `{ signature, blockhash, lastValidBlockHeight }` — dry-run returns synthetic version

### Integration Points
- `broadcaster.ts:broadcastAndConfirm()` — insert dry-run gate before `tx.sign()`
- `jito-seller.ts:jitoSell()` — insert dry-run gate before `fetch(JITO_BUNDLE_URL)`
- `config/trading.ts` — add `dryRun` to `TradingConfigSchema`
- `persistence/schema.ts` — add `dry_run` migration
- `persistence/trade-store.ts` — thread `dry_run` through `createBuyingRecord()` and queries
- `recovery/recovery-manager.ts` — skip dry-run trades during crash recovery
- `dashboard/` — add banner component, badge styling, Settings toggle, filter stats queries

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 12-dry-run-functionality*
*Context gathered: 2026-03-02*
