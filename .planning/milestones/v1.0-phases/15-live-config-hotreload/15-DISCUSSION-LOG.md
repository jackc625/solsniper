# Phase 15: Live Config Hot-Reload Fix - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-03-22
**Phase:** 15-live-config-hotreload
**Areas discussed:** Reload granularity, In-flight trade handling, Refactor approach, Config change signaling

---

## Reload Granularity

### Q1: Which config fields should become hot-reloadable?

| Option | Description | Selected |
|--------|-------------|----------|
| All patchable fields | Everything POST /api/config already accepts: minSafetyScore, buyAmountSol, maxConcurrentPositions, safety.weights.*, positionManagement.*, execution slippage | ✓ |
| Safety + position management only | Hot-reload safety thresholds and position exit rules. Leave execution params as restart-only | |
| Safety thresholds only | Only minSafetyScore and safety.weights. Minimal change | |

**User's choice:** All patchable fields
**Notes:** Full DASH-04/DASH-05 coverage

### Q2: Should pollIntervalMs changes take effect immediately or next cycle?

| Option | Description | Selected |
|--------|-------------|----------|
| Next cycle only | After current tick completes, next setTimeout uses new interval. No timer cancellation needed | ✓ |
| Immediate restart | Cancel current timer and restart with new interval. Requires timer management and config-change detection | |

**User's choice:** Next cycle only
**Notes:** Simpler, delay is at most one old-interval tick

---

## In-Flight Trade Handling

### Q3: Should open positions pick up new stop-loss/take-profit values?

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, apply to all open positions | Next PositionManager tick reads fresh config. All open positions evaluate against new thresholds | ✓ |
| Lock at entry, new config for new trades only | Each trade remembers config at buy time. Only new trades use new thresholds | |
| You decide | Claude picks based on codebase and forward-only principle | |

**User's choice:** Yes, apply to all open positions
**Notes:** "Forward-only" means forward from next evaluation, not forward from next trade

### Q4: How should tiered TP handle mid-trade tier changes?

| Option | Description | Selected |
|--------|-------------|----------|
| Re-evaluate remaining against new tiers | Read fresh config, check which new tiers haven't been hit yet based on trade record | ✓ |
| Lock tier plan at first partial sell | Entire tier schedule frozen once any tier triggers | |
| You decide | Claude picks based on existing tier tracking implementation | |

**User's choice:** Re-evaluate remaining against new tiers
**Notes:** Already-sold tiers tracked by trade record; fresh config compared against what's already sold

---

## Refactor Approach

### Q5: How should modules access config dynamically?

| Option | Description | Selected |
|--------|-------------|----------|
| Direct getRuntimeConfig() calls | Replace this.config.X with getRuntimeConfig().X at each evaluation point. Proven dryRun pattern | ✓ |
| Config-getter injection | Pass () => getRuntimeConfig() to constructors. More testable but requires signature changes | |
| Reactive config with event listener | Modules subscribe to config-change events. Most complex, overkill given next-cycle decision | |

**User's choice:** Direct getRuntimeConfig() calls
**Notes:** Extends proven pattern from Phase 12 (dryRun in broadcaster/jito-seller)

### Q6: Should constructor signatures change?

| Option | Description | Selected |
|--------|-------------|----------|
| Keep constructors as-is | Still accept TradingConfig for one-time setup. Hot-reloadable fields switch to getRuntimeConfig() at eval time | ✓ |
| Remove config from constructors | All config reads go through getRuntimeConfig(). Cleaner but larger refactor | |

**User's choice:** Keep constructors as-is
**Notes:** No API changes needed

---

## Config Change Signaling

### Q7: Should modules be notified when config changes?

| Option | Description | Selected |
|--------|-------------|----------|
| Poll-based / read on each tick | No notification system. Each module calls getRuntimeConfig() on every cycle. Zero new infrastructure | ✓ |
| Event-based notification | patchRuntimeConfig() emits config-changed event. More infrastructure, enables immediate reactions | |
| You decide | Claude picks based on next-cycle decision and existing patterns | |

**User's choice:** Poll-based / read on each tick
**Notes:** Already how dryRun works. No new infrastructure needed

### Q8: Should config changes emit a dashboard SSE event?

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, emit CONFIG_CHANGED event | BotEvent with changed fields appears in Live Feed for operator confirmation | ✓ |
| No, HTTP response is enough | POST /api/config already returns updated config. No feed event needed | |

**User's choice:** Yes, emit CONFIG_CHANGED event
**Notes:** Operator sees confirmation in Live Feed (e.g., "Settings updated: stopLossPct 15→20")

---

## Claude's Discretion

- CONFIG_CHANGED event payload shape and feed card rendering
- Whether to log config changes via pino alongside the SSE event
- Test strategy for verifying hot-reload behavior

## Deferred Ideas

None — discussion stayed within phase scope
