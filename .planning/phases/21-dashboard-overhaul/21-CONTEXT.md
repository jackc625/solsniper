# Phase 21: Dashboard Overhaul - Context

**Gathered:** 2026-03-31
**Status:** Ready for planning

<domain>
## Phase Boundary

Dashboard provides full operational visibility and control -- analytics for performance tuning, live safety pipeline view for threshold calibration, operational controls for incident response, and system status for infrastructure monitoring. Consumes Phase 20 endpoints (/api/health, /api/alerts, /api/metrics) and existing SSE stream. No new trading logic -- strictly dashboard UI and supporting API endpoints.

</domain>

<decisions>
## Implementation Decisions

### Navigation & Layout
- **D-01:** Expand sidebar with 6 nav items: FEED, PERF, PIPE (Safety Pipeline), CTRL (Controls), STAT (System Status), CONF (Settings). Flat list under existing NAVIGATION section label
- **D-02:** Add small colored health dot next to STAT nav item reflecting aggregate health status (green/yellow/red from /api/health). No replacement of SYSTEM READOUT stats panel
- **D-03:** Always-visible emergency stop button at bottom of sidebar, above connection status bar -- accessible from any page
- **D-04:** Enhance sidebar connection status bar to reflect both network status AND detection paused state: CONNECTED (green), PAUSED (yellow), NO SIGNAL (red)

### Per-Source Analytics (DASH-07)
- **D-05:** Both per-source stat cards AND chart source filter. Stat cards row below existing aggregate stats showing per-source P&L and win/loss counts. Source toggle buttons above equity curve to filter chart data
- **D-06:** Per-source stats computed client-side from existing /api/trades/history data -- zero new backend endpoints for this
- **D-07:** Claude's discretion on whether to add a source dropdown filter to the trade history table alongside existing mint text filter

### Safety Pipeline View (DASH-08)
- **D-08:** Streaming card list on dedicated PIPE page. Each card shows: mint (shortened), source badge, overall PASS/FAIL, score/100. Cards expandable to show per-check detail (tier breakdown, individual check pass/fail/score/timing)
- **D-09:** New SAFETY_EVALUATION event type emitted via BotEventBus with full per-check detail (checks array, scores, timing). Pipeline view subscribes to existing SSE stream and filters for this event type
- **D-10:** Stats header above streaming list showing: pass rate %, average score, evaluations/min -- computed client-side from received events

### Operational Controls (DASH-09)
- **D-11:** Per-position FORCE SELL buttons on Controls page. Table of open positions with current P&L, each with FORCE SELL button. Calls new POST /api/trades/:id/force-sell endpoint. Backend uses existing sell ladder
- **D-12:** Single PAUSE/RESUME toggle on Controls page. Calls POST /api/controls/detection with {paused: true/false}. Backend sets a flag checked by detection handler before processing new tokens
- **D-13:** Emergency stop = pause detection + force-sell all open positions. Calls POST /api/controls/emergency-stop. Confirmation dialog requires typing 'STOP' to confirm. Sidebar e-stop button triggers same flow
- **D-14:** Force-sell race condition: if position is already mid-sell (sellsInFlight), return 409 Conflict. Dashboard shows 'SELLING...' badge instead of FORCE SELL button. Avoids double-sell attempts

### System Status (DASH-10)
- **D-15:** Dedicated STAT page consuming Phase 20 endpoints: /api/health for per-component status, /api/metrics for RPC latency/error rates, /api/alerts for scrollable alert history
- **D-16:** Claude's discretion on system status page layout and detail level -- the data is well-structured from Phase 20

### Claude's Discretion
- System status page layout and component arrangement (D-16)
- Whether to add source dropdown filter to trade history table (D-07)
- Safety pipeline stats computation approach (client-side rolling window or simple accumulator)
- Controls page layout structure
- Default pipeline card expansion state (collapsed vs expanded)
- Alert history pagination/infinite scroll approach on STAT page

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/REQUIREMENTS.md` -- DASH-07, DASH-08, DASH-09, DASH-10 requirement definitions

### Frontend source files
- `dashboard/src/app.tsx` -- App root, view router, SSE connection lifecycle, DRY RUN banner
- `dashboard/src/components/Sidebar.tsx` -- Navigation, stats panel, connection bar. View type union to extend
- `dashboard/src/components/Performance.tsx` -- Existing equity curve, win rate, stat cards, trade history table. DASH-07 target
- `dashboard/src/components/PnlChart.tsx` -- lightweight-charts wrapper for equity curve
- `dashboard/src/components/FeedCard.tsx` -- Existing event card pattern (expandable) -- reuse for pipeline cards
- `dashboard/src/components/LiveFeed.tsx` -- Streaming list with auto-scroll pattern -- reuse for pipeline view
- `dashboard/src/components/Settings.tsx` -- Settings page
- `dashboard/src/store/feed.ts` -- SSE feed store with Preact signals
- `dashboard/src/store/config.ts` -- Config store

### Backend source files
- `src/dashboard/dashboard-server.ts` -- Fastify route registration, auth hook
- `src/dashboard/routes/events.ts` -- SSE streaming via @fastify/sse, BotEventBus subscription pattern
- `src/dashboard/routes/health.ts` -- GET /api/health consuming HealthService
- `src/dashboard/routes/alerts.ts` -- GET /api/alerts with pagination from AlertStore
- `src/dashboard/routes/metrics.ts` -- GET /api/metrics from MetricsTracker
- `src/dashboard/routes/trades.ts` -- GET /api/trades, GET /api/trades/history
- `src/dashboard/routes/config.ts` -- PATCH /api/config pattern (reference for new POST endpoints)
- `src/dashboard/bot-event-bus.ts` -- BotEventBus singleton, BotEventType enum
- `src/dashboard/auth.ts` -- API key auth

### Monitoring infrastructure (Phase 20)
- `src/monitoring/health-service.ts` -- HealthService with provider registration, 3-state status model
- `src/monitoring/alert-store.ts` -- SQLite alert persistence, query with pagination
- `src/monitoring/metrics-tracker.ts` -- Per-endpoint latency percentiles and error rates

### Detection (for pause/resume)
- `src/detection/detection-manager.ts` -- Manages PumpPortal + Raydium listeners
- `src/detection/pump-portal-listener.ts` -- PumpPortal WebSocket
- `src/detection/raydium-listener.ts` -- Raydium onLogs detection

### Execution (for force-sell)
- `src/execution/sell/sell-ladder.ts` -- 6-step sell escalation (entry point for force-sell)
- `src/index.ts` -- Bot startup, component wiring, sellsInFlight tracking

### Types
- `src/types/index.ts` -- BotEventType, BotEvent, RpcManagerEvents -- extend with SAFETY_EVALUATION

### Config
- `src/config/trading.ts` -- Zod config schemas

### Prior phase context
- `.planning/phases/20-reliability-monitoring/20-CONTEXT.md` -- Health, alerts, metrics design decisions

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `FeedCard` component -- expandable card pattern with industrial styling, reuse for pipeline evaluation cards
- `LiveFeed` component -- streaming list with auto-scroll and live/paused toggle, reuse pattern for pipeline view
- `PnlChart` component -- lightweight-charts wrapper, extend with source filtering
- `StatCard` component in Performance.tsx -- reusable stat display, use for per-source and pipeline stats
- `SourceBadge` component in Performance.tsx -- colored source label (pumpportal/raydium/pumpswap)
- `WinRateGauge` component -- progress bar gauge, reuse pattern for pipeline pass rate
- SSE subscription pattern in `store/feed.ts` -- Preact signals + EventSource, reuse for pipeline event filtering
- `BotEventBus` emit pattern -- extend with SAFETY_EVALUATION event type

### Established Patterns
- **Inline styles with CSS variables** -- all components use Record<string, string> style objects with design tokens (--bg, --border, --amber, etc.)
- **Preact signals for state** -- configSignal, feedEvents patterns
- **Fastify plugin registration** -- healthRoute, alertsRoute, metricsRoute pattern for new control endpoints
- **SSE streaming** -- reply.sse.send() in events.ts, BotEventBus.on('event') subscription
- **Polling for data** -- 5s intervals for stats, 30s for history in Performance.tsx
- **View type union** -- `type View = 'feed' | 'performance' | 'settings'` in Sidebar.tsx -- extend with new views

### Integration Points
- `dashboard/src/components/Sidebar.tsx` -- extend View type, add nav items, add e-stop button, enhance connection bar
- `dashboard/src/app.tsx` -- add new view components to router
- `dashboard/src/components/Performance.tsx` -- add per-source stat cards + chart source filter
- `src/dashboard/dashboard-server.ts` -- register new control routes
- `src/dashboard/bot-event-bus.ts` -- add SAFETY_EVALUATION to BotEventType enum
- `src/types/index.ts` -- extend BotEvent with safety evaluation payload
- `src/safety/safety-pipeline.ts` -- emit SAFETY_EVALUATION event after each evaluation
- `src/index.ts` -- wire detection pause flag, force-sell handler, emergency stop handler
- New route files: `src/dashboard/routes/controls.ts` (pause/resume, emergency-stop, force-sell)

</code_context>

<specifics>
## Specific Ideas

- Emergency stop confirmation requires typing 'STOP' (not just a click) -- per user's selected mockup
- Pipeline cards follow same expandable pattern as FeedCard -- tap to expand per-check detail
- Sidebar e-stop button always visible above connection status bar
- Connection bar shows PAUSED state in yellow when detection is paused

</specifics>

<deferred>
## Deferred Ideas

None -- discussion stayed within phase scope.

</deferred>

---

*Phase: 21-dashboard-overhaul*
*Context gathered: 2026-03-31*
