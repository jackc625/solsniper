# Phase 7: Position Management - Context

**Gathered:** 2026-02-27
**Status:** Ready for planning

<domain>
## Phase Boundary

Bot automatically monitors open token positions and triggers exits based on configurable rules: stop-loss, simple take-profit, tiered take-profit, and trailing stop. Positions are tracked by polling Jupiter quotes. The bot acts autonomously during runtime; no user interaction required. Position limit enforcement prevents overexposure. Runtime dashboard controls are out of scope for this phase.

</domain>

<decisions>
## Implementation Decisions

### Price Monitoring
- Poll Jupiter quotes every 5 seconds (fixed, not configurable per-position)
- Price denominated in SOL throughout — entry, current, and threshold calculations
- Entry price derived from confirmed buy transaction: actual SOL spent divided by tokens received
- On Jupiter quote failure: skip that poll cycle, retry on next interval (no immediate retry)

### Exit Trigger Behavior
- Sell fires immediately on the polling cycle that detects a threshold breach — no confirmation delay
- If TP and SL both trigger in the same poll cycle, TP takes priority (price is above TP, so it's a gain event)
- If a sell transaction fails (slippage, RPC error): keep position in SELLING state and retry on next poll cycle
- For tiered take-profit: after a partial sell executes, remaining tokens stay in MONITORING and the next tier becomes the active threshold

### Trailing Stop Mechanics
- High watermark initialized at entry price (trails from the moment of buy)
- Threshold expressed as percentage drop from high watermark (e.g., -20%)
- Trailing stop and tiered take-profit can both be active simultaneously on the same position; whichever triggers first executes
- High watermark does NOT reset after a partial TP sell — always tracks the all-time high of the position

### Configuration Design
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

</decisions>

<specifics>
## Specific Ideas

- Tiered TP ladder should be an array in config.jsonc: `[{at: 2, pct: 33}, {at: 5, pct: 33}, {at: 10, pct: 34}]`
- Trailing stop is opt-in: if `trailingStopPct` is 0 or absent, no trailing stop is applied
- Position limit (max concurrent) enforced against MONITORING state trades in SQLite — consistent with crash recovery (Phase 6) which already reconciles this state on restart

</specifics>

<deferred>
## Deferred Ideas

- Per-token threshold overrides — could be a future config enhancement
- Runtime-adjustable thresholds via Phase 8 dashboard (hooks into config.jsonc reload)

</deferred>

---

*Phase: 07-position-management*
*Context gathered: 2026-02-27*
