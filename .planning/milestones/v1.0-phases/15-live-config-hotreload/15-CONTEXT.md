# Phase 15: Live Config Hot-Reload Fix - Context

**Gathered:** 2026-03-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Make all dashboard Settings changes take effect immediately by switching SafetyPipeline, ExecutionEngine, PositionManager, and index.ts from static config snapshots to `getRuntimeConfig()` reads at evaluation/execution time. All fields already accepted by `POST /api/config` become hot-reloadable. Emit a CONFIG_CHANGED SSE event on successful config patch.

</domain>

<decisions>
## Implementation Decisions

### Reload Granularity
- **D-01:** All patchable fields become hot-reloadable — minSafetyScore, buyAmountSol, maxConcurrentPositions, safety.weights.*, positionManagement.* (stopLossPct, trailingStopPct, tieredTp, maxHoldTimeMs, pollIntervalMs), execution slippage. Full DASH-04/DASH-05 coverage.
- **D-02:** pollIntervalMs changes take effect on the next natural cycle (no timer restart). After the current tick completes, the next `setTimeout` uses the new interval value.

### In-Flight Trade Handling
- **D-03:** Config changes apply to all open positions on their next evaluation tick. "Forward-only" means forward from the next evaluation, not forward from the next trade.
- **D-04:** Tiered TP changes re-evaluate remaining tiers against new config. Already-sold tiers are tracked by the trade record; PositionManager reads fresh tier config and checks which new tiers haven't been hit yet.

### Refactor Approach
- **D-05:** Direct `getRuntimeConfig()` calls at each evaluation point — extends the proven `dryRun` pattern from Phase 12. Replace `this.config.X` reads with `getRuntimeConfig().X` at safety check, position tick, and buy attempt call sites.
- **D-06:** Constructor signatures stay as-is. Constructors still accept `TradingConfig` for one-time setup values (e.g., SafetyCache TTL, blocklist path). Only evaluation-time reads switch to `getRuntimeConfig()`.

### Config Change Signaling
- **D-07:** Poll-based / read on each tick. No event-based notification system. Each module calls `getRuntimeConfig()` on every evaluation cycle. Zero new infrastructure.
- **D-08:** Emit a `CONFIG_CHANGED` BotEvent via `botEventBus` when `patchRuntimeConfig()` succeeds. Event includes the changed fields. Appears in the Live Feed so operator sees confirmation (e.g., "Settings updated: stopLossPct 15→20").

### Claude's Discretion
- Exact CONFIG_CHANGED event payload shape and feed card rendering
- Whether to log config changes via pino in addition to the SSE event
- Test strategy for verifying hot-reload (unit mocking of getRuntimeConfig vs integration)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Config System
- `src/config/trading.ts` — `getRuntimeConfig()`, `patchRuntimeConfig()`, `TradingConfigSchema` — the runtime config system that all modules will read from
- `src/dashboard/routes/config.ts` — `ConfigPatchSchema`, POST/GET `/api/config` — the dashboard endpoint that triggers config changes

### Modules to Modify
- `src/safety/safety-pipeline.ts` — Currently static snapshot; all safety thresholds/weights/timeouts need switching to `getRuntimeConfig()`
- `src/position/position-manager.ts` — Currently static snapshot; poll interval, stop-loss, trailing stop, tiered TP, max hold time need switching
- `src/execution/execution-engine.ts` — Partially dynamic (dryRun); buyAmountSol and slippageBps need switching
- `src/execution/sell/sell-ladder.ts` — Step setup uses static config; execution params need switching
- `src/index.ts` — Passes static config to constructors; may need adjustment for maxConcurrentPositions guard

### Event System
- `src/events/bot-events.ts` — BotEvent types and botEventBus — add CONFIG_CHANGED event type

### Proven Pattern
- `src/execution/broadcaster.ts` — `getRuntimeConfig().dryRun` read at execution time — the reference pattern for hot-reload
- `src/execution/sell/jito-seller.ts` — Same pattern for Jito bundle path

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `getRuntimeConfig()` in `src/config/trading.ts`: Already exists and returns the mutable shadow config — the core primitive for this phase
- `patchRuntimeConfig()`: Deep 2-level merge already handles nested objects (safety.weights, positionManagement) and array overwrites (tieredTp)
- `botEventBus`: SSE event system already handles BUY_SENT, SELL_TRIGGERED, etc. — CONFIG_CHANGED follows same pattern
- `BotEventType` enum: Add CONFIG_CHANGED alongside existing event types

### Established Patterns
- `getRuntimeConfig().dryRun` in broadcaster.ts and jito-seller.ts — the exact pattern to replicate across all modules
- `ConfigPatchSchema` in config.ts route — already validates and limits which fields are patchable
- PositionManager `scheduleTick` uses `setTimeout` with configurable interval — switching to `getRuntimeConfig().positionManagement.pollIntervalMs` in the setTimeout callback naturally picks up new interval

### Integration Points
- SafetyPipeline: Replace `this.tradingConfig.safety.*` and `this.tradingConfig.minSafetyScore` reads in `evaluate()` method
- PositionManager: Replace `this.config.positionManagement.*` reads in tick/evaluation methods and `setTimeout` scheduling
- ExecutionEngine: Replace `this.config.buyAmountSol` and `this.config.execution.buy.slippageBps` reads in `buy()` method
- SellLadder: Replace `this.config.execution.sell.*` reads in step construction
- index.ts: Replace `tradingConfig.maxConcurrentPositions` guard in token handler
- config.ts route: Add `botEventBus.emit('event', { type: 'CONFIG_CHANGED', ... })` after successful patch
- Dashboard frontend: Add CONFIG_CHANGED to SSE event types and render in feed

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches. The refactor follows the proven `dryRun` pattern uniformly across all modules.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 15-live-config-hotreload*
*Context gathered: 2026-03-22*
