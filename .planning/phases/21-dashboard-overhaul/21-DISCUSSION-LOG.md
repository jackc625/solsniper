# Phase 21: Dashboard Overhaul - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md -- this log preserves the alternatives considered.

**Date:** 2026-03-31
**Phase:** 21-dashboard-overhaul
**Areas discussed:** Navigation & layout, Per-source analytics, Safety pipeline view, Operational controls

---

## Navigation & Layout

| Option | Description | Selected |
|--------|-------------|----------|
| Expand sidebar | Add new nav items: FEED, PERF, PIPE, CTRL, STAT, CONF. 6 tabs total | ✓ |
| Grouped sections | Group into TRADING and OPS sections | |
| Merge into existing | Keep 3 tabs, embed new content into existing views | |

**User's choice:** Expand sidebar
**Notes:** Clean flat list under existing NAVIGATION label

### Status hint in sidebar

| Option | Description | Selected |
|--------|-------------|----------|
| Sidebar health dot only | Colored dot next to STAT nav item reflecting aggregate health | ✓ |
| Keep SYSTEM READOUT as-is | Existing stats panel unchanged, health only on STAT page | |
| Replace readout with health | Replace stats panel with health summary dots | |

**User's choice:** Sidebar health dot only

### Emergency stop placement

| Option | Description | Selected |
|--------|-------------|----------|
| Sidebar e-stop | Always-visible button at bottom of sidebar, above connection status | ✓ |
| Controls page only | E-stop lives exclusively on CTRL page | |
| Both locations | Button on Controls page AND compact icon in sidebar | |

**User's choice:** Sidebar e-stop

### Connection bar enhancement

| Option | Description | Selected |
|--------|-------------|----------|
| Enhance with detection state | Shows CONNECTED/PAUSED/NO SIGNAL reflecting both network and detection state | ✓ |
| Keep as network only | Connection bar stays as-is, detection state only on Controls page | |

**User's choice:** Enhance with detection state

---

## Per-Source Analytics

| Option | Description | Selected |
|--------|-------------|----------|
| Source stat cards | Row of per-source P&L cards below aggregate stats | |
| Source toggle on chart | Filter buttons above equity curve to toggle source | |
| Both cards + chart filter | Per-source stat cards AND chart source toggle | ✓ |

**User's choice:** Both cards + chart filter

### Data source

| Option | Description | Selected |
|--------|-------------|----------|
| Client-side compute | Compute per-source totals from existing history data | ✓ |
| New /api/stats/by-source endpoint | Backend SQL GROUP BY aggregation | |

**User's choice:** Client-side compute

### Table source filter

| Option | Description | Selected |
|--------|-------------|----------|
| Add source dropdown filter | Dropdown next to existing mint filter | |
| Existing sort is enough | Source column already sortable | |
| You decide | Claude's discretion | ✓ |

**User's choice:** You decide
**Notes:** Claude's discretion on source filter value given existing sort

---

## Safety Pipeline View

| Option | Description | Selected |
|--------|-------------|----------|
| Streaming card list | Live-scrolling evaluation cards with expandable per-check detail | ✓ |
| Table view | Sortable table with click-to-expand rows | |
| Split: summary + detail | Left panel summary list, right panel detail on click | |

**User's choice:** Streaming card list

### Data flow

| Option | Description | Selected |
|--------|-------------|----------|
| New SSE event type | SAFETY_EVALUATION event via BotEventBus with full per-check detail | ✓ |
| Enrich existing events | Add detail to existing SAFETY_PASS/SAFETY_FAIL events | |
| Polling endpoint | GET /api/safety/recent polled every 2-3s | |

**User's choice:** New SSE event type

### Pipeline stats

| Option | Description | Selected |
|--------|-------------|----------|
| Stats header + stream | Compact stats bar (pass rate, avg score, evals/min) above stream | ✓ |
| Stream only | Just streaming cards, no stats | |
| You decide | Claude's discretion | |

**User's choice:** Stats header + stream

---

## Operational Controls

### Force-sell design

| Option | Description | Selected |
|--------|-------------|----------|
| Per-position button | Table of open positions, each with FORCE SELL button | ✓ |
| Sell-all only | Single SELL ALL POSITIONS button | |
| Both per-position + sell-all | Per-position buttons AND sell-all button | |

**User's choice:** Per-position button

### Pause/resume detection

| Option | Description | Selected |
|--------|-------------|----------|
| Toggle button + API | Single PAUSE/RESUME toggle, POST /api/controls/detection | ✓ |
| Per-source pause | Separate toggles for Pump.fun and Raydium | |
| You decide | Claude's discretion | |

**User's choice:** Toggle button + API

### Emergency stop behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Stop detection + sell all | Pause detection + force-sell all positions, typed confirmation | ✓ |
| Stop detection only | Pause detection only, manual sell required | |
| Full shutdown | Pause + sell all + process.exit | |

**User's choice:** Stop detection + sell all

### Force-sell race condition

| Option | Description | Selected |
|--------|-------------|----------|
| Skip if selling | Return 409 Conflict if sellsInFlight, show SELLING... badge | ✓ |
| Queue and replace | Cancel current sell, restart from highest-urgency step | |
| You decide | Claude's discretion | |

**User's choice:** Skip if selling

---

## Claude's Discretion

- System status page layout and detail level (D-16)
- Trade history table source dropdown filter (D-07)
- Safety pipeline stats computation approach
- Controls page layout structure
- Default pipeline card expansion state
- Alert history pagination approach

## Deferred Ideas

None -- discussion stayed within phase scope.
