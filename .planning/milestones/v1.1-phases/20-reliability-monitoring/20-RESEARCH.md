# Phase 20: Reliability & Monitoring - Research

**Researched:** 2026-03-30
**Domain:** Node.js observability -- health endpoints, system alerting, metrics collection, log rotation
**Confidence:** HIGH

## Summary

Phase 20 adds four reliability primitives to an existing Node.js/TypeScript trading bot: a structured health endpoint (REL-01), system alert events via the existing BotEventBus (REL-02), per-endpoint latency/error metrics (REL-03), and automatic log file rotation using pino-roll (REL-04). The codebase already has all the foundational infrastructure -- BotEventBus with SSE streaming, RpcManager with failover/recovered/degraded events, ResilientWebSocket with reconnectCount and lastMessageAt, better-sqlite3 with migration patterns, Fastify route registration, and Zod config schemas with hot-reload. The phase introduces three new services (HealthService, MetricsTracker, AlertStore) and extends existing types and config schemas.

The key architectural insight is that no new event plumbing is needed. SYSTEM_ALERT events flow through the existing BotEventBus singleton and are automatically pushed to SSE clients via the existing `/events` route. The new `/api/health`, `/api/metrics`, and `/api/alerts` endpoints follow the exact same Fastify route plugin pattern as `/api/trades` and `/api/config`. The only new dependency is pino-roll (v4.0.0) for log rotation -- everything else uses libraries already in the project.

**Primary recommendation:** Implement as four clean-cut plans aligned 1:1 with requirements (health/alerts/metrics/log-rotation), keeping HealthService + AlertStore in a new `src/monitoring/` directory to avoid polluting `src/core/`.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** 3-state status model per component: healthy/degraded/down
- **D-02:** Four monitored components: detection feeds, RPC connections, safety pipeline, execution engine
- **D-03:** Top-level aggregate status = worst-of rollup across all components. HTTP 200 always (status in body), 503 when any component is 'down'
- **D-04:** Include metadata: process uptime (seconds), bot version from package.json, response timestamp
- **D-05:** Authenticated like other /api/* routes -- behind optional DASHBOARD_API_KEY
- **D-06:** Safety pipeline and execution engine health determined by last-activity timestamp -- degraded if no activity in configurable window (e.g., 5 min for safety, 15 min for execution)
- **D-07:** Detection health from ResilientWebSocket connection state + silence duration. RPC health from RpcManager primary/backup state + consecutive failures
- **D-08:** New `SYSTEM_ALERT` event type added to BotEventType enum
- **D-09:** BotEvent extended with `severity` field (warn/error/info) and `alertSource` field (detection/rpc/api/rateLimit)
- **D-10:** Alert triggers: detection disconnect, RPC failover, repeated API failures (consecutive threshold), rate limit activation (HTTP 429)
- **D-11:** Per-source cooldown debouncing -- same alert type + source fires at most once per configurable cooldown (e.g., 60s). Resets on recovery
- **D-12:** Recovery events emitted as SYSTEM_ALERT with severity 'info' when previously-alerted component recovers
- **D-13:** Alerts persisted to SQLite 'alerts' table (timestamp, type, severity, source, message) for durable history
- **D-14:** GET /api/alerts endpoint exposed in Phase 20 with pagination -- Phase 21 dashboard consumes directly
- **D-15:** Track p50, p99 latency percentiles and error rate per endpoint
- **D-16:** Scope: RPC connections AND external APIs (Helius fee estimation, Jupiter quote/swap, RugCheck)
- **D-17:** Separate GET /api/metrics endpoint returning per-endpoint stats as JSON
- **D-18:** 5-minute sliding window for percentile computation
- **D-19:** Central MetricsTracker service with `record(endpoint, latencyMs, success)` method -- callers wrap their calls and report
- **D-20:** Use pino-roll transport for in-process file rotation
- **D-21:** Rotation triggers: 50MB file size OR daily, whichever first. Keep 7 days of rotated files, auto-delete older
- **D-22:** Production only -- development keeps current stdout + pino-pretty behavior unchanged
- **D-23:** All rotation values (size, retention days) configurable via trading config
- **D-24:** Expose key thresholds only: alert cooldown duration, API failure threshold (consecutive failures before alert), log rotation size/retention
- **D-25:** Central HealthService that components register with at startup via callback pattern
- **D-26:** Health route calls `healthService.check()` which invokes all registered providers and computes aggregate
- **D-27:** HealthService also handles alert emission -- detects status transitions and emits SYSTEM_ALERT via BotEventBus

### Claude's Discretion
- Exact pino-roll configuration options and file naming pattern
- SQLite alerts table schema details (indexes, column types)
- MetricsTracker internal data structure for sliding window (array vs circular buffer)
- Percentile computation algorithm (exact sort vs approximation)
- Default values for all configurable thresholds (alert cooldown, failure threshold, activity windows)
- How rate limit detection hooks into existing fetch calls
- Whether MetricsTracker and HealthService live in `src/core/` or `src/monitoring/`

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| REL-01 | /api/health endpoint returns structured status of all components (detection, RPC, safety, execution) | HealthService with callback registration pattern; 3-state model; worst-of aggregate; Fastify route plugin pattern from existing codebase |
| REL-02 | Bot emits SYSTEM_ALERT events when detection disconnects, APIs fail, or rate limits activate | BotEventType enum extension; AlertStore SQLite table; cooldown debouncing; transition detection in HealthService |
| REL-03 | Bot tracks per-RPC-connection latency and error rates | MetricsTracker with sliding window; sorted-array percentile computation; 9 fetch call sites identified for instrumentation |
| REL-04 | Log files rotate automatically by size/time to prevent disk fill | pino-roll v4.0.0 transport; production-only conditional; configurable via MonitoringConfigSchema |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| pino | 10.3.1 | Structured logging (already installed) | Project standard; pino-roll is its official rotation transport |
| pino-roll | 4.0.0 | Log file rotation transport | Official pino ecosystem transport; in-process rotation without external tools like logrotate |
| better-sqlite3 | 12.6.2 | SQLite persistence (already installed) | Project standard for alerts table; synchronous API matches existing TradeStore pattern |
| fastify | 5.8.4 | HTTP server (already installed) | Project standard; new routes follow existing plugin pattern |
| zod | 4.3.6 | Config schema validation (already installed) | Project standard; MonitoringConfigSchema follows existing pattern |
| eventemitter3 | 5.0.4 | Typed event emission (already installed) | Project standard; BotEventBus already uses this |

### Supporting
No new supporting libraries needed -- all functionality builds on existing dependencies.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| pino-roll | logrotate (OS) | External dependency, requires sysadmin setup, not cross-platform (Windows VPS support needed) |
| pino-roll | pino-rotating-file-stream | Less maintained, pino-roll is the official pino team solution |
| sorted-array percentiles | tdigest/hdr-histogram | Over-engineered for 5-min window of ~1000 samples; exact sort is O(n log n) but n is small |
| SQLite alerts table | In-memory ring buffer | Loses history on restart; SQLite provides durable history that Phase 21 dashboard queries |

**Installation:**
```bash
pnpm add pino-roll
```

**Version verification:** pino-roll 4.0.0 confirmed current via `pnpm view pino-roll version` on 2026-03-30. pino 10.3.1 already installed, compatible with pino-roll 4.x.

## Architecture Patterns

### Recommended Project Structure
```
src/
  monitoring/              # NEW directory for Phase 20 services
    health-service.ts      # Central HealthService with callback registration
    metrics-tracker.ts     # Sliding-window latency/error tracking
    alert-store.ts         # SQLite alerts table wrapper
  dashboard/
    routes/
      health.ts            # GET /api/health route
      metrics.ts           # GET /api/metrics route
      alerts.ts            # GET /api/alerts route (with pagination)
  types/index.ts           # Extended BotEventType + BotEvent
  config/trading.ts        # Extended with MonitoringConfigSchema
  core/logger.ts           # pino-roll transport added in production
  persistence/schema.ts    # alerts table schema + migration
```

### Pattern 1: HealthService Callback Registration
**What:** Components register health-check callbacks at startup. HealthService invokes all registered providers on demand and computes aggregate status.
**When to use:** When health sources are scattered across the codebase (detection, RPC, safety, execution) and you want a single point of aggregation.
**Example:**
```typescript
// Source: Derived from existing RpcManager EventEmitter pattern in src/core/rpc-manager.ts
type ComponentStatus = 'healthy' | 'degraded' | 'down';
interface ComponentHealth {
  status: ComponentStatus;
  detail?: string;
}
type HealthProvider = () => ComponentHealth;

class HealthService {
  private providers = new Map<string, HealthProvider>();

  register(name: string, provider: HealthProvider): void {
    this.providers.set(name, provider);
  }

  check(): { status: ComponentStatus; components: Record<string, ComponentHealth>; uptime: number; version: string; timestamp: number } {
    const components: Record<string, ComponentHealth> = {};
    let worstStatus: ComponentStatus = 'healthy';

    for (const [name, provider] of this.providers) {
      const health = provider();
      components[name] = health;
      if (health.status === 'down') worstStatus = 'down';
      else if (health.status === 'degraded' && worstStatus !== 'down') worstStatus = 'degraded';
    }

    return {
      status: worstStatus,
      components,
      uptime: process.uptime(),
      version: /* from package.json */ '1.0.0',
      timestamp: Date.now(),
    };
  }
}
```

### Pattern 2: Sliding Window MetricsTracker
**What:** Records latency and success/failure per endpoint in a time-bounded array. Computes percentiles on demand by sorting the window.
**When to use:** When you need recent percentile stats without heavy dependencies. 5-minute window with typical call rates (~200 calls/min across all endpoints) means ~1000 entries max -- trivially sortable.
**Example:**
```typescript
// Source: Derived from existing withLatency() pattern in src/core/logger.ts
interface MetricEntry {
  latencyMs: number;
  success: boolean;
  ts: number;
}

class MetricsTracker {
  private windows = new Map<string, MetricEntry[]>();
  private readonly windowMs: number;

  record(endpoint: string, latencyMs: number, success: boolean): void {
    const entries = this.windows.get(endpoint) ?? [];
    entries.push({ latencyMs, success, ts: Date.now() });
    this.windows.set(endpoint, entries);
  }

  getStats(endpoint: string): { p50: number; p99: number; errorRate: number; count: number } {
    const cutoff = Date.now() - this.windowMs;
    const entries = (this.windows.get(endpoint) ?? []).filter(e => e.ts >= cutoff);
    // Prune stale entries in place
    this.windows.set(endpoint, entries);

    if (entries.length === 0) return { p50: 0, p99: 0, errorRate: 0, count: 0 };

    const latencies = entries.map(e => e.latencyMs).sort((a, b) => a - b);
    const errors = entries.filter(e => !e.success).length;

    return {
      p50: latencies[Math.floor(latencies.length * 0.5)],
      p99: latencies[Math.floor(latencies.length * 0.99)],
      errorRate: errors / entries.length,
      count: entries.length,
    };
  }
}
```

### Pattern 3: Alert Transition Detection with Cooldown
**What:** HealthService tracks previous component states. On status transitions (healthy->degraded, degraded->down), it emits SYSTEM_ALERT via BotEventBus with cooldown debouncing. Recovery events emitted when a previously-alerted component returns to healthy.
**When to use:** Whenever you want to bridge health state changes to an event bus without flooding it.
**Example:**
```typescript
// Source: Derived from existing BotEventBus pattern in src/dashboard/bot-event-bus.ts
// HealthService tracks previousStatus per component
// On check(): compare current vs previous, emit SYSTEM_ALERT on transitions
// Cooldown: Map<string, number> tracking last alert emission time per source
```

### Pattern 4: pino-roll Production Transport
**What:** Conditional transport configuration in logger.ts based on NODE_ENV.
**When to use:** When development needs human-readable stdout (pino-pretty) but production needs rotating log files.
**Example:**
```typescript
// Source: pino-roll GitHub README (https://github.com/mcollina/pino-roll)
import pino from 'pino';

const isDev = env.NODE_ENV === 'development';

// Production: pino-roll for file rotation
// Development: pino-pretty for human-readable stdout
const transport = isDev
  ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard' } }
  : {
      target: 'pino-roll',
      options: {
        file: 'logs/solsniper',    // -> logs/solsniper.2026-03-30.1.log
        frequency: 'daily',
        size: '50m',               // 50MB
        limit: { count: 7 },       // Keep 7 rotated files
        mkdir: true,
        dateFormat: 'yyyy-MM-dd',
      },
    };

const logger = pino({ level: env.LOG_LEVEL, transport });
```

### Anti-Patterns to Avoid
- **Polling-based health checks from dashboard:** Dashboard should call GET /api/health on demand, not subscribe to a health polling interval. Health computation is cheap (just invoke callbacks).
- **Global fetch() monkey-patching for metrics:** Do NOT wrap globalThis.fetch. Instead, have each call site explicitly call `metricsTracker.record()` after each fetch. Explicit is better than magic.
- **Storing metrics in SQLite:** Percentile data is ephemeral (5-min window). SQLite is for durable alert history only. MetricsTracker uses in-memory arrays.
- **Separate pino logger instance for rotation:** There must be ONE pino root logger. pino-roll replaces the undefined (stdout) transport in production mode, not a second logger.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Log file rotation | Custom file watcher + rename logic | pino-roll | Handles atomic rotation, naming, cleanup, date formatting; battle-tested by pino team |
| Percentile approximation | t-digest or HDR histogram implementation | Sorted array with Math.floor(n * percentile) | Window is ~1000 entries; exact sort is trivially fast; no library needed |
| SQLite migration runner | Custom migration framework | Existing MIGRATION_SQL array pattern from schema.ts | Project already has a proven try-catch ALTER TABLE pattern |
| SSE event delivery | Custom SSE implementation | Existing BotEventBus + @fastify/sse | SYSTEM_ALERT events flow through existing infrastructure with zero new plumbing |

**Key insight:** The codebase already has 90% of the infrastructure. Phase 20 is primarily wiring -- connecting existing health signals to a unified HealthService and adding metering to existing fetch calls.

## Common Pitfalls

### Pitfall 1: pino-roll Transport Path Resolution
**What goes wrong:** pino-roll creates files relative to `process.cwd()`, not relative to the source file. If the bot is started from a different directory, logs end up in the wrong place.
**Why it happens:** `pino.transport()` runs the target in a worker thread. The `file` option in pino-roll is resolved relative to `process.cwd()`.
**How to avoid:** Use a relative path like `'logs/solsniper'` -- the bot is always started from the project root (package.json scripts use `tsx src/index.ts`). Set `mkdir: true` so the `logs/` directory is auto-created.
**Warning signs:** Log files appearing in unexpected locations; `ENOENT` errors in pino-roll output.

### Pitfall 2: pino-roll Transport Initialization Timing
**What goes wrong:** `pino.transport()` returns a stream that connects asynchronously. If pino logs before the transport stream is ready, those early log lines may be lost or buffered.
**Why it happens:** Worker thread startup is async; pino buffers messages until the transport is ready, but if the process exits immediately (e.g., config validation failure), buffered logs may be lost.
**How to avoid:** This is acceptable for this project -- config validation failures already call `process.exit(1)` before logger.ts is imported. Normal startup logs will be buffered briefly and then flushed. No special handling needed.
**Warning signs:** Missing startup logs in production log files.

### Pitfall 3: BotEvent Interface Extension Breaking SSE Clients
**What goes wrong:** Adding `severity` and `alertSource` as required fields on BotEvent would break all existing event emissions that don't include them.
**Why it happens:** TypeScript would require all `botEventBus.emit('event', {...})` calls to include the new fields.
**How to avoid:** Make `severity` and `alertSource` optional fields on BotEvent (`severity?: 'info' | 'warn' | 'error'`). Only SYSTEM_ALERT events set them. Existing events continue to work unchanged.
**Warning signs:** TypeScript compilation errors on existing botEventBus.emit() calls throughout the codebase.

### Pitfall 4: Health Check Circular Dependency
**What goes wrong:** HealthService imports from detection-manager, rpc-manager, etc. for health data, creating circular dependencies if those modules also import from monitoring/.
**Why it happens:** TypeScript ESM strict module resolution.
**How to avoid:** Use the callback registration pattern (D-25). HealthService never imports from component modules. Instead, `index.ts` calls `healthService.register('detection', () => ...)` with closure-based callbacks. HealthService depends only on types, not concrete imports.
**Warning signs:** `ERR_MODULE_NOT_FOUND` or undefined imports at startup.

### Pitfall 5: MetricsTracker Memory Growth
**What goes wrong:** Without pruning, the sliding window arrays grow unbounded as more calls are recorded.
**Why it happens:** `record()` pushes entries but nothing removes old ones between `getStats()` calls.
**How to avoid:** Prune stale entries on every `getStats()` call AND on a periodic timer (every 60s). The timer handles the case where `getStats()` is never called for a quiet endpoint.
**Warning signs:** Node.js heap growing steadily over hours; `process.memoryUsage().heapUsed` increasing linearly.

### Pitfall 6: SQLite WAL Mode for Alert Writes
**What goes wrong:** Alert inserts could block the event loop if SQLite is in journal mode (default).
**Why it happens:** Synchronous better-sqlite3 writes hold a database lock.
**How to avoid:** The existing TradeStore already enables WAL mode (`this.db.pragma('journal_mode = WAL')`). The alerts table lives in the same database, so it benefits automatically. No separate database needed.
**Warning signs:** Alert inserts appearing as latency spikes in MetricsTracker for the dashboard API.

### Pitfall 7: Alert Cooldown Key Collision
**What goes wrong:** If cooldown keys are too generic (e.g., just "detection"), different failure modes within the same source (e.g., PumpPortal disconnect vs Raydium silence) would suppress each other.
**Why it happens:** D-11 says "per-source cooldown" -- but a source can have multiple distinct failure types.
**How to avoid:** Use composite cooldown keys: `alertType:source` (e.g., `disconnect:detection`, `failover:rpc`, `429:jupiter`). This ensures each distinct failure scenario has its own cooldown timer.
**Warning signs:** Missing alerts for one failure type when another failure type recently fired.

## Code Examples

### Extending BotEventType and BotEvent
```typescript
// Source: Existing pattern in src/dashboard/bot-event-bus.ts
// Add SYSTEM_ALERT to the union
export type BotEventType =
  | 'TOKEN_DETECTED'
  | 'BUY_SENT'
  | 'BUY_CONFIRMED'
  | 'BUY_FAILED'
  | 'SELL_TRIGGERED'
  | 'SELL_PARTIAL'
  | 'SELL_CONFIRMED'
  | 'SELL_FAILED'
  | 'ERROR'
  | 'CONFIG_CHANGED'
  | 'LOW_BALANCE'
  | 'SYSTEM_ALERT';     // REL-02: system health alerts

export interface BotEvent {
  type: BotEventType;
  mint: string;
  ts: number;
  detail?: string;
  isDryRun?: boolean;
  safetyScore?: number;
  source?: string;
  buyAmountSol?: number;
  pnlSol?: number;
  // REL-02: alert-specific fields (optional -- only set on SYSTEM_ALERT)
  severity?: 'info' | 'warn' | 'error';
  alertSource?: 'detection' | 'rpc' | 'api' | 'rateLimit';
}
```

### Alerts Table Schema
```sql
-- Source: Following existing pattern in src/persistence/schema.ts
CREATE TABLE IF NOT EXISTS alerts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp  INTEGER NOT NULL,           -- Unix ms
  type       TEXT    NOT NULL,           -- e.g., 'disconnect', 'failover', 'api_failure', 'rate_limit', 'recovery'
  severity   TEXT    NOT NULL,           -- 'info' | 'warn' | 'error'
  source     TEXT    NOT NULL,           -- 'detection' | 'rpc' | 'api' | 'rateLimit'
  message    TEXT    NOT NULL            -- Human-readable alert description
);

CREATE INDEX IF NOT EXISTS idx_alerts_timestamp ON alerts (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_source ON alerts (source);
```

### MonitoringConfigSchema Extension
```typescript
// Source: Following existing pattern in src/config/trading.ts
const MonitoringConfigSchema = z.object({
  alertCooldownMs: z.number().int().positive().default(60_000),         // 60s per-source cooldown
  apiFailureThreshold: z.number().int().positive().default(5),          // consecutive failures before alert
  logRotation: z.object({
    sizeMb: z.number().int().positive().default(50),                    // 50MB
    retentionDays: z.number().int().positive().default(7),              // keep 7 days
  }),
});

// Add to TradingConfigSchema:
// monitoring: MonitoringConfigSchema,
```

### pino-roll Logger Configuration
```typescript
// Source: pino-roll README (https://github.com/mcollina/pino-roll)
// In src/core/logger.ts, replace the current transport logic:

import { getRuntimeConfig } from '../config/trading.js';

const isDev = env.NODE_ENV === 'development';

function getTransport() {
  if (isDev) {
    return { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard' } };
  }
  // Production: pino-roll for file rotation
  // Config values read at startup (logger is created once)
  return {
    target: 'pino-roll',
    options: {
      file: 'logs/solsniper',
      frequency: 'daily',
      size: '50m',       // from monitoring.logRotation.sizeMb
      limit: { count: 7 },  // from monitoring.logRotation.retentionDays
      mkdir: true,
      dateFormat: 'yyyy-MM-dd',
    },
  };
}
```

### Health Route Plugin
```typescript
// Source: Following existing pattern in src/dashboard/routes/trades.ts
import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import type { HealthService } from '../../monitoring/health-service.js';

interface HealthPluginOptions extends FastifyPluginOptions {
  healthService: HealthService;
}

export async function healthRoute(fastify: FastifyInstance, opts: HealthPluginOptions): Promise<void> {
  fastify.get('/health', async (_request, reply) => {
    const result = opts.healthService.check();
    const httpStatus = result.status === 'down' ? 503 : 200;
    return reply.code(httpStatus).send(result);
  });
}
```

### MetricsTracker Instrumentation Pattern
```typescript
// Source: Wrapping existing fetch calls (e.g., src/core/fee-estimator.ts line 37)
// Before:
const response = await fetch(this.rpcUrl, { ... });

// After:
const start = Date.now();
let success = false;
try {
  const response = await fetch(this.rpcUrl, { ... });
  success = response.ok;
  return response;
} finally {
  metricsTracker.record('helius:fee-estimate', Date.now() - start, success);
}
```

### Fetch Call Sites Requiring Instrumentation
Per D-16, the following 9 fetch call sites need MetricsTracker wrapping:
1. `src/core/fee-estimator.ts:37` -- Helius getPriorityFeeEstimate
2. `src/execution/buy/pump-portal-buyer.ts:35` -- PumpPortal buy API
3. `src/execution/jupiter-client.ts:75` -- Jupiter quote
4. `src/execution/jupiter-client.ts:121` -- Jupiter swap
5. `src/execution/sell/jito-seller.ts:192` -- Jito bundle submit
6. `src/execution/sell/jito-seller.ts:237` -- Jito bundle status
7. `src/execution/sell/pump-portal-seller.ts:49` -- PumpPortal sell API
8. `src/safety/checks/tier2-rugcheck.ts:43` -- RugCheck API
9. `src/safety/checks/tier3-creator.ts:115` -- Helius DAS API (creator history)

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| logrotate (OS-level) | pino-roll (in-process) | pino-roll v1 (2022) | No OS dependency; works on Windows; no cron setup |
| External metrics (Prometheus/Grafana) | In-process MetricsTracker | N/A (design choice) | No external infrastructure; fits single-VPS deployment model |
| Separate health check process | In-process HealthService | N/A (design choice) | Single process; no IPC; callback pattern avoids polling |

**Deprecated/outdated:**
- pino-roll v1/v2/v3: v4.0.0 is current; uses "Extension Last Format" for filenames (e.g., `solsniper.2026-03-30.1.log`)
- `pino.destination()` for file output: pino-roll wraps this internally with rotation logic; don't use raw destination

## Open Questions

1. **Logger initialization order with configurable rotation values**
   - What we know: Logger is created at module load time (top-level `const logger = pino(...)` in logger.ts). Config is loaded from config.jsonc in trading.ts, also at module load time. The import order in index.ts is: env.ts -> trading.ts -> logger.ts.
   - What's unclear: The monitoring config (rotation size/retention) needs to be available when logger.ts constructs pino. Since trading.ts is imported before logger.ts, this should work -- but the config must be parsed before the logger transport is configured.
   - Recommendation: Read monitoring config values directly in logger.ts using a synchronous import of the parsed trading config. Since trading.ts is loaded first (it's higher in index.ts import order), this is safe.

2. **Health status for safety pipeline and execution engine inactivity windows**
   - What we know: D-06 says "configurable window (e.g., 5 min for safety, 15 min for execution)". These are code defaults per D-24 ("keep health check intervals and metrics window as sensible code defaults").
   - What's unclear: Whether 5 min and 15 min are the right defaults, given that token launches can be bursty (many in 10 min, then silence for 30 min).
   - Recommendation: Use generous defaults: 10 min for safety, 30 min for execution. Components report "degraded" not "down" when no activity is seen. "Down" should only occur when an actual error or disconnect is detected. This prevents false-degraded alerts during quiet market periods.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.0.18 |
| Config file | vitest.config.ts |
| Quick run command | `pnpm test -- --reporter=verbose` |
| Full suite command | `pnpm test` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| REL-01 | GET /api/health returns structured status with 4 components | unit (Fastify inject) | `pnpm test -- src/dashboard/routes/health.test.ts -x` | Wave 0 |
| REL-01 | HealthService registers providers and computes aggregate (worst-of) | unit | `pnpm test -- src/monitoring/health-service.test.ts -x` | Wave 0 |
| REL-01 | HTTP 503 when any component is 'down', 200 otherwise | unit (Fastify inject) | `pnpm test -- src/dashboard/routes/health.test.ts -x` | Wave 0 |
| REL-02 | SYSTEM_ALERT emitted on detection disconnect | unit | `pnpm test -- src/monitoring/health-service.test.ts -x` | Wave 0 |
| REL-02 | Alert cooldown debouncing suppresses duplicate alerts | unit | `pnpm test -- src/monitoring/health-service.test.ts -x` | Wave 0 |
| REL-02 | Recovery events emitted when component recovers | unit | `pnpm test -- src/monitoring/health-service.test.ts -x` | Wave 0 |
| REL-02 | Alerts persisted to SQLite alerts table | unit | `pnpm test -- src/monitoring/alert-store.test.ts -x` | Wave 0 |
| REL-02 | GET /api/alerts returns paginated alert history | unit (Fastify inject) | `pnpm test -- src/dashboard/routes/alerts.test.ts -x` | Wave 0 |
| REL-03 | MetricsTracker records latency and computes p50/p99 | unit | `pnpm test -- src/monitoring/metrics-tracker.test.ts -x` | Wave 0 |
| REL-03 | Sliding window prunes stale entries | unit | `pnpm test -- src/monitoring/metrics-tracker.test.ts -x` | Wave 0 |
| REL-03 | GET /api/metrics returns per-endpoint stats | unit (Fastify inject) | `pnpm test -- src/dashboard/routes/metrics.test.ts -x` | Wave 0 |
| REL-04 | pino-roll transport configured in production | unit (mock) | `pnpm test -- src/core/logger.test.ts -x` | Wave 0 |

### Sampling Rate
- **Per task commit:** `pnpm test -- src/monitoring/ src/dashboard/routes/health.test.ts src/dashboard/routes/alerts.test.ts src/dashboard/routes/metrics.test.ts -x`
- **Per wave merge:** `pnpm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/monitoring/health-service.test.ts` -- covers REL-01, REL-02 (transition detection, aggregate, cooldown)
- [ ] `src/monitoring/metrics-tracker.test.ts` -- covers REL-03 (record, percentiles, sliding window)
- [ ] `src/monitoring/alert-store.test.ts` -- covers REL-02 (SQLite insert, pagination query)
- [ ] `src/dashboard/routes/health.test.ts` -- covers REL-01 (Fastify inject, status codes)
- [ ] `src/dashboard/routes/alerts.test.ts` -- covers REL-02 (pagination, auth)
- [ ] `src/dashboard/routes/metrics.test.ts` -- covers REL-03 (JSON response shape)

## Sources

### Primary (HIGH confidence)
- **Codebase inspection** - All source files listed in CONTEXT.md canonical references read and analyzed
- **pino-roll GitHub README** (https://github.com/mcollina/pino-roll) - Full API documentation, configuration options, code examples
- **npm registry** - pino-roll v4.0.0 confirmed as latest via `pnpm view pino-roll version`

### Secondary (MEDIUM confidence)
- **WebSearch** - pino-roll configuration patterns and community usage confirmed against official GitHub README

### Tertiary (LOW confidence)
- None -- all findings verified against primary sources

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Only one new dependency (pino-roll) verified against npm registry; everything else already installed
- Architecture: HIGH - All patterns derived from existing codebase (BotEventBus, TradeStore, Fastify routes); no novel architecture
- Pitfalls: HIGH - Based on direct code inspection of logger.ts initialization, BotEvent interface shape, and SQLite patterns

**Research date:** 2026-03-30
**Valid until:** 2026-04-30 (stable -- no fast-moving dependencies; pino ecosystem is mature)
