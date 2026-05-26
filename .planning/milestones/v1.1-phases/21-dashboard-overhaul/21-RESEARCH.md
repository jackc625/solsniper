# Phase 21: Dashboard Overhaul - Research

**Researched:** 2026-03-31
**Domain:** Preact dashboard UI + Fastify REST API controls
**Confidence:** HIGH

## Summary

Phase 21 adds four capabilities to the existing Preact + Fastify dashboard: per-source analytics on the Performance page (DASH-07), a live safety pipeline view via SSE (DASH-08), operational controls for pause/resume/force-sell/emergency-stop (DASH-09), and a system status page consuming Phase 20 health/metrics/alerts endpoints (DASH-10). The phase also extends the sidebar with 3 new nav items, an always-visible emergency stop button, and enhanced connection bar states.

The existing codebase provides strong reusable patterns: FeedCard expandable cards, LiveFeed streaming lists with auto-scroll, StatCard components, SourceBadge, the SSE subscription pattern via Preact signals, and Fastify plugin registration. The primary new backend work is a controls route plugin (pause/resume, force-sell, emergency-stop) and a SAFETY_EVALUATION event type emitted from the safety pipeline. All UI follows the established inline-styles-with-CSS-variables pattern documented in the UI-SPEC.

**Primary recommendation:** Implement backend controls API first (blocking), then frontend in page-by-page order: sidebar modifications, Performance extensions, Pipeline page, Controls page, System Status page. The force-sell race condition (D-14) is the highest-risk integration point -- the 409 Conflict pattern on sellsInFlight must be tested carefully.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Expand sidebar with 6 nav items: FEED, PERF, PIPE (Safety Pipeline), CTRL (Controls), STAT (System Status), CONF (Settings). Flat list under existing NAVIGATION section label
- **D-02:** Add small colored health dot next to STAT nav item reflecting aggregate health status (green/yellow/red from /api/health). No replacement of SYSTEM READOUT stats panel
- **D-03:** Always-visible emergency stop button at bottom of sidebar, above connection status bar -- accessible from any page
- **D-04:** Enhance sidebar connection status bar to reflect both network status AND detection paused state: CONNECTED (green), PAUSED (yellow), NO SIGNAL (red)
- **D-05:** Both per-source stat cards AND chart source filter. Stat cards row below existing aggregate stats showing per-source P&L and win/loss counts. Source toggle buttons above equity curve to filter chart data
- **D-06:** Per-source stats computed client-side from existing /api/trades/history data -- zero new backend endpoints for this
- **D-07:** Claude's discretion on whether to add a source dropdown filter to the trade history table alongside existing mint text filter
- **D-08:** Streaming card list on dedicated PIPE page. Each card shows: mint (shortened), source badge, overall PASS/FAIL, score/100. Cards expandable to show per-check detail (tier breakdown, individual check pass/fail/score/timing)
- **D-09:** New SAFETY_EVALUATION event type emitted via BotEventBus with full per-check detail (checks array, scores, timing). Pipeline view subscribes to existing SSE stream and filters for this event type
- **D-10:** Stats header above streaming list showing: pass rate %, average score, evaluations/min -- computed client-side from received events
- **D-11:** Per-position FORCE SELL buttons on Controls page. Table of open positions with current P&L, each with FORCE SELL button. Calls new POST /api/trades/:id/force-sell endpoint. Backend uses existing sell ladder
- **D-12:** Single PAUSE/RESUME toggle on Controls page. Calls POST /api/controls/detection with {paused: true/false}. Backend sets a flag checked by detection handler before processing new tokens
- **D-13:** Emergency stop = pause detection + force-sell all open positions. Calls POST /api/controls/emergency-stop. Confirmation dialog requires typing 'STOP' to confirm. Sidebar e-stop button triggers same flow
- **D-14:** Force-sell race condition: if position is already mid-sell (sellsInFlight), return 409 Conflict. Dashboard shows 'SELLING...' badge instead of FORCE SELL button. Avoids double-sell attempts
- **D-15:** Dedicated STAT page consuming Phase 20 endpoints: /api/health for per-component status, /api/metrics for RPC latency/error rates, /api/alerts for scrollable alert history
- **D-16:** Claude's discretion on system status page layout and detail level -- the data is well-structured from Phase 20

### Claude's Discretion
- System status page layout and component arrangement (D-16)
- Whether to add source dropdown filter to trade history table (D-07)
- Safety pipeline stats computation approach (client-side rolling window or simple accumulator)
- Controls page layout structure
- Default pipeline card expansion state (collapsed vs expanded)
- Alert history pagination/infinite scroll approach on STAT page

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DASH-07 | Dashboard shows equity curve, win/loss ratio, and per-source P&L breakdown | Performance.tsx extensions: per-source StatCards computed client-side from /api/trades/history, source toggle buttons filtering PnlChart data, optional source dropdown in trade table |
| DASH-08 | Dashboard shows live safety pipeline decisions with per-check detail for each token evaluated | New SAFETY_EVALUATION BotEventType, emission from SafetyPipeline.evaluate(), new Pipeline page with streaming card list reusing FeedCard/LiveFeed patterns |
| DASH-09 | User can pause/resume detection, force-sell positions, and emergency stop from dashboard | New controls route plugin (POST /api/controls/detection, POST /api/trades/:id/force-sell, POST /api/controls/emergency-stop), detection pause flag in index.ts, sellsInFlight guard for 409 Conflict |
| DASH-10 | Dashboard shows system status panel with RPC health, rate limit indicators, and alert history | New SystemStatus page consuming existing /api/health, /api/metrics, /api/alerts endpoints from Phase 20 |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Preact | 10.28.4 | UI framework | Already in use, hooks-based components |
| @preact/signals | 2.8.1 | Reactive state management | Already in use for feedEvents, configSignal |
| lightweight-charts | 5.1.0 | Equity curve chart | Already in use via PnlChart component |
| Fastify | 5.8.4 | HTTP server + REST API | Already in use, plugin system for new routes |
| @fastify/sse | 0.4.0 | Server-sent events | Already in use for BotEventBus streaming |
| Zod | 4.3.6 | Request validation | Already in use in config route pattern |
| eventemitter3 | 5.0.4 | Event bus | Already in use for BotEventBus |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Vitest | 4.0.18 | Test framework | Backend controls route unit tests |
| better-sqlite3 | 12.6.2 | SQLite persistence | Trade queries for force-sell, read-only |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Inline styles | CSS modules | Would break established pattern -- all existing components use inline Record<string, string> |
| Preact signals | useState | Signals already used for cross-component state (feed, config); new stores should follow same pattern |

**Installation:** No new dependencies needed. All libraries are already installed.

## Architecture Patterns

### Recommended Project Structure
```
dashboard/src/
  components/
    Sidebar.tsx          # Modified: 6 nav items, health dot, e-stop button, PAUSED state
    Performance.tsx      # Modified: per-source stats, chart filter, source table filter
    PnlChart.tsx         # Modified: accept source filter prop, re-render on filter change
    Pipeline.tsx          # NEW: streaming safety evaluation cards
    Controls.tsx          # NEW: pause/resume, positions table, force-sell, e-stop
    SystemStatus.tsx      # NEW: health cards, RPC metrics table, alert history
    FeedCard.tsx          # Unchanged (pattern reference)
    LiveFeed.tsx          # Unchanged (pattern reference)
    Settings.tsx          # Unchanged
  store/
    feed.ts              # Modified: add SAFETY_EVALUATION to event type listeners
    config.ts            # Unchanged
    controls.ts          # NEW: detection paused state signal, control API functions

src/dashboard/
  routes/
    controls.ts          # NEW: POST /api/controls/detection, POST /api/controls/emergency-stop, POST /api/trades/:id/force-sell
  bot-event-bus.ts       # Modified: add SAFETY_EVALUATION to BotEventType
  dashboard-server.ts    # Modified: register controlsRoute, pass new deps

src/types/index.ts       # Modified: add SAFETY_EVALUATION to BotEventType, SafetyEvaluationPayload
src/safety/safety-pipeline.ts  # Modified: emit SAFETY_EVALUATION event after each evaluate()
src/index.ts             # Modified: add detectionPaused flag, wire controls route deps
```

### Pattern 1: Fastify Plugin Route Registration
**What:** Each logical API domain is a Fastify plugin registered with opts for dependencies.
**When to use:** All new API endpoints.
**Example:**
```typescript
// Source: existing src/dashboard/routes/config.ts pattern
interface ControlsPluginOptions extends FastifyPluginOptions {
  tradeStore: TradeStore;
  sellLadder: SellLadder;
  positionManager: PositionManager;
  detectionPaused: { value: boolean }; // mutable ref object
}

export async function controlsRoute(
  fastify: FastifyInstance,
  opts: ControlsPluginOptions,
): Promise<void> {
  fastify.post('/controls/detection', async (request, reply) => {
    // ...
  });
}
```

### Pattern 2: Preact Inline Styles with CSS Variables
**What:** All components use `Record<string, string>` style objects referencing CSS custom properties.
**When to use:** All new UI components and modifications.
**Example:**
```typescript
// Source: existing Sidebar.tsx, Settings.tsx, FeedCard.tsx patterns
const CARD: Record<string, string> = {
  background: 'var(--bg2)',
  border: '1px solid var(--border)',
  padding: 'var(--sp-4)',
  borderRadius: 'var(--r-sm)',
};
```

### Pattern 3: SSE Event Subscription via Preact Signals
**What:** EventSource listeners push typed events into a Preact signal array. Components read the signal reactively.
**When to use:** Pipeline page consuming SAFETY_EVALUATION events from SSE stream.
**Example:**
```typescript
// Source: existing store/feed.ts pattern
// The existing connectFeed() already listens for all BotEventType events.
// Pipeline page can filter feedEvents.value for type === 'SAFETY_EVALUATION'.
// Alternatively, a dedicated signal could accumulate pipeline-only events.
```

### Pattern 4: Page Layout Pattern
**What:** Each page view follows the Settings.tsx layout: PAGE container with PAGE_HEADER (title + subtitle) and scrollable content area.
**When to use:** Pipeline, Controls, SystemStatus pages.
**Example:**
```typescript
// Source: Settings.tsx
const PAGE: Record<string, string> = {
  height: '100%',
  overflowY: 'auto',
  padding: 'var(--sp-6)',
};
const PAGE_HEADER: Record<string, string> = {
  marginBottom: 'var(--sp-5)',
};
const PAGE_TITLE: Record<string, string> = {
  fontFamily: 'var(--font-display)',
  fontSize: '20px',
  fontWeight: '700',
  letterSpacing: '0.15em',
  color: 'var(--text-bright)',
};
```

### Pattern 5: Polling with Intervals
**What:** Use setInterval for periodic data fetching (5s for stats, 30s for history, 10s for health/metrics).
**When to use:** SystemStatus page health/metrics/alerts polling, Controls page positions polling.
**Example:**
```typescript
// Source: Performance.tsx
useEffect(() => {
  refreshAll();
  const historyId = setInterval(() => void loadHistory(), 30000);
  const statsId = setInterval(() => { void loadStats(); void loadActive(); }, 5000);
  return () => { clearInterval(historyId); clearInterval(statsId); };
}, []);
```

### Anti-Patterns to Avoid
- **Direct DOM manipulation:** Use Preact state/signals, not document.querySelector
- **New CSS files:** All styles are inline Record<string, string> objects -- no external CSS files
- **Importing React:** This is Preact -- import from 'preact/hooks', not 'react'
- **Default exports:** Project uses named exports (import { X } from) everywhere
- **Async in event handlers without void:** Use `void` prefix for fire-and-forget promises in event handlers

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SSE streaming | Custom WebSocket protocol | Existing @fastify/sse + BotEventBus pattern | Already handles reconnection, typed events, cleanup |
| Chart rendering | Canvas drawing code | lightweight-charts LineSeries | Already set up in PnlChart.tsx |
| State management | Custom pub/sub | @preact/signals | Already used for feedEvents, configSignal |
| Request validation | Manual body parsing | Zod schemas | Already established in config route |
| Expandable cards | Custom accordion | FeedCard pattern (useState + max-height transition) | Proven pattern in LiveFeed |
| Streaming list | Virtual scrolling library | LiveFeed auto-scroll pattern (ref + scrollTop) | Works for 200-item lists |

**Key insight:** This phase is almost entirely about composing existing patterns into new pages. The FeedCard, LiveFeed, StatCard, SourceBadge, page layout, polling, and SSE patterns are all established and proven. The only genuinely new pattern is backend POST endpoints for write operations (pause/resume, force-sell, emergency-stop).

## Common Pitfalls

### Pitfall 1: Force-Sell Race Condition (D-14)
**What goes wrong:** Dashboard sends force-sell while PositionManager is already selling the same position, causing double-sell or SellLadder state machine confusion (MONITORING->SELLING transition fails).
**Why it happens:** sellsInFlight is a private Set on PositionManager; the controls route has no direct access.
**How to avoid:** Either (a) expose a `isSellInFlight(mint: string)` method on PositionManager, or (b) check trade state in TradeStore -- if state is already 'SELLING', return 409. Option (b) is simpler because it uses existing DB state without exposing PositionManager internals. However, there's a race window between the DB check and the actual sell start. The safest approach: expose `isSellInFlight(mint)` on PositionManager AND check DB state -- belt and suspenders.
**Warning signs:** 409 responses never appearing in testing (means the guard isn't being exercised); or conversely, force-sell always returning 409 (means the guard is too aggressive).

### Pitfall 2: Detection Pause Flag Scope
**What goes wrong:** Setting `detectionPaused = true` doesn't stop tokens already in the safety pipeline from completing their buy flow.
**Why it happens:** The pause flag must be checked at the TOP of the token event handler (line 322 of index.ts), before safety pipeline evaluation. If checked too late, tokens already mid-evaluation will still buy.
**How to avoid:** Insert the paused check as the very first guard in the `detectionManager.on('token', ...)` callback, before maxConcurrentPositions and balanceGuard checks. Use a mutable reference object `{ value: boolean }` (not a plain boolean, which would be captured by closure at wire-up time).
**Warning signs:** Tokens still being bought after pausing detection.

### Pitfall 3: Emergency Stop Partial Completion
**What goes wrong:** Emergency stop pauses detection but force-sell-all fails partway through (e.g., 2 of 5 positions sold), leaving an inconsistent state.
**Why it happens:** Emergency stop combines two atomic operations (pause + sell-all) that aren't transactional.
**How to avoid:** Pause detection FIRST (synchronous flag flip), THEN iterate all MONITORING trades and fire force-sell for each. Return the result as { paused: true, sellResults: [...] } so the dashboard knows partial success occurred. Each sell is independent -- some may 409 (already selling), some may succeed, some may fail.
**Warning signs:** Dashboard showing "EXECUTING..." forever because one sell hangs.

### Pitfall 4: SAFETY_EVALUATION Event Size
**What goes wrong:** Each SAFETY_EVALUATION event includes full per-check detail (8+ checks x tier breakdown). If the bot evaluates 100+ tokens/hour, the SSE stream and client-side signal array grow unbounded.
**Why it happens:** Unlike feed events (capped at MAX_FEED_SIZE=200), pipeline events could overwhelm memory.
**How to avoid:** Apply the same MAX_FEED_SIZE cap to pipeline events. Use a separate signal for pipeline events (not the shared feedEvents) to avoid polluting the main feed. Client-side stats (pass rate, avg score, evals/min) should use a rolling accumulator, not re-computing from the full array every render.
**Warning signs:** Browser tab memory growing linearly with time; dashboard becoming sluggish after hours of operation.

### Pitfall 5: PnlChart Source Filtering and Data Duplication
**What goes wrong:** Re-building the lightweight-charts chart on every source filter toggle causes flickering or chart element leaks.
**Why it happens:** PnlChart currently recreates the chart in a useEffect that depends on `data`. If the data array reference changes on every filter toggle, the chart is destroyed and recreated.
**How to avoid:** Pass the source filter as a separate prop. In PnlChart, filter the data before passing to series.setData() rather than recreating the chart. Use useMemo to memoize filtered data. Or: keep the chart instance stable and only update the series data.
**Warning signs:** Chart flickering on source toggle, ResizeObserver warnings, memory leaks from un-removed chart instances.

### Pitfall 6: CORS Methods for POST
**What goes wrong:** POST requests from Vite dev server (port 5173) fail with CORS errors.
**Why it happens:** The CORS config already allows POST (`methods: ['GET', 'POST']`), so this should work. But if preflight OPTIONS handling is broken, it won't.
**How to avoid:** Verify that `@fastify/cors` handles OPTIONS preflight for POST with Content-Type: application/json. The existing config route POST already works, so this is likely fine. Just verify in dev.
**Warning signs:** 405 Method Not Allowed or CORS errors in browser console during development.

### Pitfall 7: Connection Bar State Priority
**What goes wrong:** Connection bar shows CONNECTED when detection is paused (should show PAUSED).
**Why it happens:** The Sidebar polls /api/stats for connection status. Paused state is separate from connection state.
**How to avoid:** Add a paused flag to the /api/stats response OR create a lightweight /api/controls/status endpoint that returns { paused: boolean }. The Sidebar needs both pieces of information: (1) is the server reachable? (2) is detection paused? Priority: if not connected, show NO SIGNAL (red). If connected but paused, show PAUSED (yellow). If connected and active, show CONNECTED (green).
**Warning signs:** Connection bar flashing between states, or showing green when detection is paused.

### Pitfall 8: Stale Position Data on Controls Page
**What goes wrong:** Force-sell button shown for a position that just completed its sell naturally.
**Why it happens:** Controls page polls positions every 5s. Between polls, a position may transition MONITORING->SELLING->COMPLETED.
**How to avoid:** Include `state` in the positions response. Show SELLING positions with SELLING... badge. Only show FORCE SELL for MONITORING positions. On 409 response, update the row to SELLING... badge immediately.
**Warning signs:** Force-sell returning 409 unexpectedly because position completed between poll and click.

## Code Examples

### Backend: Controls Route Plugin
```typescript
// Source: pattern derived from existing config.ts, health.ts routes
import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import type { TradeStore } from '../../persistence/trade-store.js';

interface ControlsPluginOptions extends FastifyPluginOptions {
  tradeStore: TradeStore;
  getDetectionPaused: () => boolean;
  setDetectionPaused: (paused: boolean) => void;
  isSellInFlight: (mint: string) => boolean;
  triggerSell: (mint: string, tokenAmount: bigint) => void;
}

export async function controlsRoute(
  fastify: FastifyInstance,
  opts: ControlsPluginOptions,
): Promise<void> {
  // POST /api/controls/detection -- pause/resume
  fastify.post('/controls/detection', async (request, reply) => {
    const { paused } = request.body as { paused: boolean };
    opts.setDetectionPaused(paused);
    return reply.send({ ok: true, paused });
  });

  // POST /api/trades/:id/force-sell -- sell specific position
  fastify.post('/trades/:id/force-sell', async (request, reply) => {
    const { id } = request.params as { id: string };
    // Look up trade, check sellsInFlight, return 409 if already selling
    // ...
  });

  // POST /api/controls/emergency-stop -- pause + sell all
  fastify.post('/controls/emergency-stop', async (request, reply) => {
    opts.setDetectionPaused(true);
    // Iterate all MONITORING trades, fire sell for each
    // ...
  });
}
```

### Backend: SAFETY_EVALUATION Event Emission
```typescript
// Source: pattern from SafetyPipeline.evaluate() + BotEventBus
// Add to SafetyPipeline after building the SafetyResult:
botEventBus.emit('event', {
  type: 'SAFETY_EVALUATION',
  mint: event.mint,
  ts: Date.now(),
  source: event.source,
  detail: result.pass ? 'PASS' : 'FAIL',
  safetyScore: result.aggregateScore,
  // Extended payload for pipeline view:
  safetyResult: {
    pass: result.pass,
    aggregateScore: result.aggregateScore,
    checks: [
      ...result.tier1.map(c => ({ ...c, tier: 'tier1' })),
      ...result.tier2.map(c => ({ ...c, tier: 'tier2' })),
      ...result.tier3.map(c => ({ ...c, tier: 'tier3' })),
    ],
    durationMs: result.durationMs,
    rejectionReasons: result.rejectionReasons,
  },
});
```

### Frontend: Pipeline Card Component
```typescript
// Source: FeedCard expandable pattern + UI-SPEC specifications
function PipelineCard({ evaluation }: { evaluation: SafetyEvaluation }) {
  const [expanded, setExpanded] = useState(false);
  const borderColor = evaluation.pass ? 'var(--green)' : 'var(--red)';

  return (
    <div style={{ ...CARD, borderLeft: `3px solid ${borderColor}` }} onClick={() => setExpanded(v => !v)}>
      {/* Collapsed: mint, source badge, PASS/FAIL, score */}
      <div style={CARD_HEADER}>
        <span style={MINT}>{shortenMint(evaluation.mint)}</span>
        <SourceBadge source={evaluation.source} />
        <span style={{ ...BADGE, background: borderColor, color: '#000' }}>
          {evaluation.pass ? 'PASS' : 'FAIL'}
        </span>
        <span>{evaluation.aggregateScore}/100</span>
      </div>
      {/* Expanded: per-check detail table */}
      <div style={{ maxHeight: expanded ? '300px' : '0', overflow: 'hidden', transition: 'max-height 150ms ease' }}>
        {/* Tier breakdown table */}
      </div>
    </div>
  );
}
```

### Frontend: Source-Filtered Chart Data
```typescript
// Source: derived from existing buildChartData() in Performance.tsx
function buildFilteredChartData(
  history: HistoryTrade[],
  sourceFilter: string | null,
): PnlDataPoint[] {
  const filtered = sourceFilter
    ? history.filter(t => t.source?.toLowerCase() === sourceFilter)
    : history;
  return buildChartData(filtered);
}
```

### Frontend: Detection Pause Toggle
```typescript
// Source: config store pattern
export async function setDetectionPaused(paused: boolean): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch('/api/controls/detection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paused }),
    });
    if (res.ok) {
      return { ok: true };
    }
    const data = await res.json() as { error?: string };
    return { ok: false, error: data.error ?? 'Failed' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Read-only dashboard | Write endpoints for controls | Phase 21 | First POST endpoints from dashboard that mutate bot state |
| Feed-only SSE | SAFETY_EVALUATION in SSE stream | Phase 21 | Pipeline visibility without new WebSocket connection |
| 3 nav items | 6 nav items | Phase 21 | Sidebar becomes primary navigation hub |

**Deprecated/outdated:**
- None -- all existing patterns are current and should be extended, not replaced.

## Open Questions

1. **PositionManager.sellsInFlight Exposure**
   - What we know: sellsInFlight is private on PositionManager. Force-sell needs to check it to return 409.
   - What's unclear: Whether to add a public method `isSellInFlight(mint)` or check TradeStore state (which has a race window).
   - Recommendation: Add a public `isSellInFlight(mint: string): boolean` method to PositionManager. Minimal API surface, direct check of the Set. Also check trade state === 'SELLING' in DB as a fallback guard.

2. **Detection Pause Flag Wiring**
   - What we know: The token event handler in index.ts is a closure. A plain `let paused = false` would work but can't be changed from the controls route.
   - What's unclear: Best way to share mutable state between index.ts closure and Fastify route handler.
   - Recommendation: Use a simple mutable object `const detectionState = { paused: false }` created in main(), passed to controlsRoute opts as getDetectionPaused/setDetectionPaused. The token event handler reads `detectionState.paused` at the top of each invocation.

3. **SAFETY_EVALUATION Event Payload Size**
   - What we know: SafetyResult includes tier1 (4 checks), tier2 (4 checks), tier3 (1 check) = 9 check results per evaluation.
   - What's unclear: Whether SSE message size becomes a problem at high token detection rates.
   - Recommendation: Include essential fields only (source, pass, score, detail per check). Skip the full CheckResult if detail is verbose. Keep events under 2KB each. The existing SSE setup handles this fine.

4. **Controls Route Dependencies**
   - What we know: The controls route needs TradeStore (positions query), SellLadder (force-sell), PositionManager (sellsInFlight check), and the detection pause flag.
   - What's unclear: SellLadder requires tokenAmount (bigint) for sell(). Force-sell needs to get this from TradeStore or on-chain balance.
   - Recommendation: Use TradeStore.getTradeByMint() to get amountTokens, pass to SellLadder.sell(). SellLadder already does a fresh on-chain balance check internally (line 79-88 of sell-ladder.ts), so the passed amount is a hint -- the actual sell uses fresh balance.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.0.18 |
| Config file | vitest.config.ts |
| Quick run command | `rtk vitest run src/dashboard/routes/controls.test.ts` |
| Full suite command | `rtk vitest run` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DASH-07 | Per-source P&L computed from history | manual | Build dashboard, visual verify in browser | N/A -- client-side compute, no backend test needed |
| DASH-08 | SAFETY_EVALUATION event emitted with per-check detail | unit | `rtk vitest run src/safety/safety-pipeline.test.ts -t "SAFETY_EVALUATION"` | Extends existing file |
| DASH-09 (pause) | POST /api/controls/detection sets pause flag | unit | `rtk vitest run src/dashboard/routes/controls.test.ts -t "pause"` | Wave 0 |
| DASH-09 (force-sell) | POST /api/trades/:id/force-sell triggers sell ladder | unit | `rtk vitest run src/dashboard/routes/controls.test.ts -t "force-sell"` | Wave 0 |
| DASH-09 (force-sell 409) | Force-sell returns 409 when sellsInFlight | unit | `rtk vitest run src/dashboard/routes/controls.test.ts -t "409"` | Wave 0 |
| DASH-09 (e-stop) | POST /api/controls/emergency-stop pauses + sells all | unit | `rtk vitest run src/dashboard/routes/controls.test.ts -t "emergency"` | Wave 0 |
| DASH-10 | SystemStatus page consumes health/metrics/alerts | manual | Build dashboard, visual verify in browser | N/A -- existing endpoints already tested in Phase 20 |

### Sampling Rate
- **Per task commit:** `rtk vitest run src/dashboard/routes/controls.test.ts`
- **Per wave merge:** `rtk vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/dashboard/routes/controls.test.ts` -- covers DASH-09 (pause, force-sell, 409, e-stop)
- [ ] Extend `src/safety/safety-pipeline.test.ts` -- covers DASH-08 (SAFETY_EVALUATION emission)

## Sources

### Primary (HIGH confidence)
- Direct codebase inspection of all referenced files in CONTEXT.md canonical_refs
- Existing component patterns (FeedCard, LiveFeed, StatCard, SourceBadge, Settings page layout)
- Existing route patterns (config.ts, health.ts, alerts.ts, metrics.ts, trades.ts)
- UI-SPEC (.planning/phases/21-dashboard-overhaul/21-UI-SPEC.md) -- visual/interaction contract

### Secondary (MEDIUM confidence)
- Preact 10.28.4 hooks API (useState, useEffect, useRef, useMemo) -- stable, well-known
- lightweight-charts 5.1.0 LineSeries API -- verified via existing PnlChart usage
- Fastify 5.8.4 plugin registration pattern -- verified via existing route files

### Tertiary (LOW confidence)
- None -- all research is backed by direct codebase inspection

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries already installed and in active use; no new deps
- Architecture: HIGH -- all patterns directly observable in existing codebase; new pages follow established patterns
- Pitfalls: HIGH -- force-sell race condition (Pitfall 1) and detection pause scope (Pitfall 2) identified from direct code reading of PositionManager.sellsInFlight and index.ts token handler closure
- Controls API: HIGH -- Fastify plugin registration pattern is well-established; POST endpoint pattern follows config.ts

**Research date:** 2026-03-31
**Valid until:** 2026-04-30 (stable -- no dependency changes expected)
