# Phase 20: Reliability & Monitoring - Context

**Gathered:** 2026-03-30
**Status:** Ready for planning

<domain>
## Phase Boundary

Operator can detect and diagnose silent failures -- structured health checks, system alerts on component failures, per-RPC/API metrics, and automatic log rotation prevent operational blind spots. Covers: GET /api/health with per-component status (REL-01), SYSTEM_ALERT events via BotEventBus with SQLite persistence (REL-02), per-endpoint latency percentiles and error rates exposed via GET /api/metrics (REL-03), and pino-roll file rotation in production (REL-04). No new trading features or dashboard UI -- strictly infrastructure for Phase 21 to consume.

</domain>

<decisions>
## Implementation Decisions

### Health Endpoint Design (REL-01)
- **D-01:** 3-state status model per component: healthy/degraded/down
- **D-02:** Four monitored components: detection feeds, RPC connections, safety pipeline, execution engine
- **D-03:** Top-level aggregate status = worst-of rollup across all components. HTTP 200 always (status in body), 503 when any component is 'down'
- **D-04:** Include metadata: process uptime (seconds), bot version from package.json, response timestamp
- **D-05:** Authenticated like other /api/* routes -- behind optional DASHBOARD_API_KEY
- **D-06:** Safety pipeline and execution engine health determined by last-activity timestamp -- degraded if no activity in configurable window (e.g., 5 min for safety, 15 min for execution)
- **D-07:** Detection health from ResilientWebSocket connection state + silence duration. RPC health from RpcManager primary/backup state + consecutive failures

### Alert System (REL-02)
- **D-08:** New `SYSTEM_ALERT` event type added to BotEventType enum
- **D-09:** BotEvent extended with `severity` field (warn/error/info) and `alertSource` field (detection/rpc/api/rateLimit)
- **D-10:** Alert triggers: detection disconnect, RPC failover, repeated API failures (consecutive threshold), rate limit activation (HTTP 429)
- **D-11:** Per-source cooldown debouncing -- same alert type + source fires at most once per configurable cooldown (e.g., 60s). Resets on recovery
- **D-12:** Recovery events emitted as SYSTEM_ALERT with severity 'info' when previously-alerted component recovers
- **D-13:** Alerts persisted to SQLite 'alerts' table (timestamp, type, severity, source, message) for durable history
- **D-14:** GET /api/alerts endpoint exposed in Phase 20 with pagination -- Phase 21 dashboard consumes directly

### Metrics Tracking (REL-03)
- **D-15:** Track p50, p99 latency percentiles and error rate per endpoint
- **D-16:** Scope: RPC connections AND external APIs (Helius fee estimation, Jupiter quote/swap, RugCheck)
- **D-17:** Separate GET /api/metrics endpoint returning per-endpoint stats as JSON
- **D-18:** 5-minute sliding window for percentile computation
- **D-19:** Central MetricsTracker service with `record(endpoint, latencyMs, success)` method -- callers wrap their calls and report

### Log Rotation (REL-04)
- **D-20:** Use pino-roll transport for in-process file rotation
- **D-21:** Rotation triggers: 50MB file size OR daily, whichever first. Keep 7 days of rotated files, auto-delete older
- **D-22:** Production only -- development keeps current stdout + pino-pretty behavior unchanged
- **D-23:** All rotation values (size, retention days) configurable via trading config

### Config Surface
- **D-24:** Expose key thresholds only: alert cooldown duration, API failure threshold (consecutive failures before alert), log rotation size/retention. Keep health check intervals and metrics window as sensible code defaults

### Health Service Architecture
- **D-25:** Central HealthService that components register with at startup via callback pattern (e.g., `healthService.register('detection', () => getDetectionStatus())`)
- **D-26:** Health route calls `healthService.check()` which invokes all registered providers and computes aggregate
- **D-27:** HealthService also handles alert emission -- detects status transitions (healthy->degraded, degraded->down, recovery) and emits SYSTEM_ALERT via BotEventBus. Components just report state; HealthService handles transition detection and alerting

### Claude's Discretion
- Exact pino-roll configuration options and file naming pattern
- SQLite alerts table schema details (indexes, column types)
- MetricsTracker internal data structure for sliding window (array vs circular buffer)
- Percentile computation algorithm (exact sort vs approximation)
- Default values for all configurable thresholds (alert cooldown, failure threshold, activity windows)
- How rate limit detection hooks into existing fetch calls
- Whether MetricsTracker and HealthService live in `src/core/` or `src/monitoring/`

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/REQUIREMENTS.md` -- REL-01, REL-02, REL-03, REL-04 requirement definitions
- `.planning/REQUIREMENTS.md` -- DASH-10 (Phase 21 consumes alerts table and /api/metrics)

### Core infrastructure
- `src/dashboard/bot-event-bus.ts` -- BotEventBus singleton, BotEventType enum, BotEvent interface -- extend with SYSTEM_ALERT
- `src/core/logger.ts` -- Pino setup, createModuleLogger, transport configuration -- add pino-roll transport
- `src/core/rpc-manager.ts` -- RpcManagerEvents (failover/recovered/degraded), getState(), consecutive failure tracking
- `src/core/resilient-ws.ts` -- ResilientWebSocket base class: reconnectCount, lastMessageAt, heartbeat, silence detection

### Detection
- `src/detection/detection-manager.ts` -- Manages PumpPortal + Raydium listeners, stats logging
- `src/detection/pump-portal-listener.ts` -- Extends ResilientWebSocket
- `src/detection/raydium-listener.ts` -- Uses Connection.onLogs(), has health check interval + silence threshold

### Dashboard server
- `src/dashboard/dashboard-server.ts` -- Fastify route registration, auth hook, static serving
- `src/dashboard/routes/events.ts` -- SSE streaming pattern via @fastify/sse

### Types
- `src/types/index.ts` -- RpcManagerEvents, BotEventType, BotEvent -- extend for SYSTEM_ALERT

### Config
- `src/config/trading.ts` -- Zod config schemas with hot-reload -- add monitoring config section
- `src/config/env.ts` -- Environment variables (LOG_LEVEL, NODE_ENV)

### Persistence
- `src/persistence/trade-store.ts` -- SQLite pattern, schema migrations -- add alerts table
- `src/persistence/schema.ts` -- Existing table definitions

### Prior phase context
- `.planning/phases/19-execution-performance/19-CONTEXT.md` -- D-15 LOW_BALANCE event via BotEventBus (same pattern for SYSTEM_ALERT)
- `.planning/phases/17-security-fixes/17-CONTEXT.md` -- D-05 Helius API uses X-Api-Key header

### Architecture
- `.planning/codebase/ARCHITECTURE.md` -- System architecture, event flow, component relationships

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `BotEventBus` singleton + SSE streaming in `routes/events.ts` -- SYSTEM_ALERT events flow through existing infrastructure with zero new plumbing
- `RpcManager` failover/recovered/degraded events -- bridge directly to HealthService for RPC health status
- `ResilientWebSocket.reconnectCount` + `lastMessageAt` -- detection health status derives from existing tracked state
- `createModuleLogger()` -- new services (HealthService, MetricsTracker) follow same logging pattern
- `withLatency()` in `logger.ts` -- existing latency wrapping utility, could inform MetricsTracker recording pattern
- `TradeStore` SQLite migration pattern -- reuse for alerts table creation

### Established Patterns
- **BotEvent emission:** `botEventBus.emit('event', { type, mint, ts, detail, ... })` -- SYSTEM_ALERT follows same contract
- **Zod config schemas:** New monitoring config section follows existing pattern with defaults
- **Fastify route registration:** `app.get('/api/health', handler)` follows existing route pattern
- **EventEmitter3 typed events:** RpcManager already uses typed EventEmitter -- HealthService can follow same pattern
- **SQLite with better-sqlite3:** Synchronous prepared statements with parameterized queries

### Integration Points
- `src/dashboard/dashboard-server.ts` -- register new routes: /api/health, /api/metrics, /api/alerts
- `src/index.ts` -- instantiate HealthService and MetricsTracker, register component health providers at startup
- `src/core/logger.ts` -- add pino-roll transport in production mode
- `src/types/index.ts` -- extend BotEventType enum and BotEvent interface
- `src/config/trading.ts` -- add MonitoringConfigSchema with alert/rotation settings
- `src/persistence/trade-store.ts` -- add alerts table migration and insert/query methods
- All fetch call sites (Jupiter, Helius, RugCheck, RPC) -- add MetricsTracker.record() calls

</code_context>

<specifics>
## Specific Ideas

No specific requirements -- open to standard approaches.

</specifics>

<deferred>
## Deferred Ideas

None -- discussion stayed within phase scope.

</deferred>

---

*Phase: 20-reliability-monitoring*
*Context gathered: 2026-03-30*
