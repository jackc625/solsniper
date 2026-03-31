# Phase 20: Reliability & Monitoring - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md -- this log preserves the alternatives considered.

**Date:** 2026-03-30
**Phase:** 20-reliability-monitoring
**Areas discussed:** Health endpoint design, Alert trigger rules, RPC metrics scope, Log rotation strategy, Metrics collection pattern, Alert history persistence, Config surface, Health service architecture

---

## Health Endpoint Design

### Status Granularity

| Option | Description | Selected |
|--------|-------------|----------|
| 3-state per component | Each component reports healthy/degraded/down | ✓ |
| 2-state per component | Each component reports healthy/unhealthy | |
| Aggregate only | Single overall status derived from worst component | |

**User's choice:** 3-state per component
**Notes:** Matches REL-01 requirement exactly. Distinguishes 'working on backup' from 'completely dead'.

### Monitored Components

| Option | Description | Selected |
|--------|-------------|----------|
| Detection feeds | PumpPortal WS + Raydium onLogs connection state and silence duration | ✓ |
| RPC connections | Primary/backup state from RpcManager | ✓ |
| Safety pipeline | Last successful evaluation timestamp | ✓ |
| Execution engine | Last successful transaction timestamp | ✓ |

**User's choice:** All four components
**Notes:** All recommended options selected.

### Aggregate Status

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, worst-of rollup | Top-level status = worst component. HTTP 200 always, 503 when any down | ✓ |
| Components only | No aggregate, consumer inspects each | |

**User's choice:** Worst-of rollup
**Notes:** Quick check for load balancer integration.

### Metadata

| Option | Description | Selected |
|--------|-------------|----------|
| Uptime + version | Process uptime, bot version from package.json, timestamp | ✓ |
| Minimal | Components only, no extra metadata | |

**User's choice:** Uptime + version

### Authentication

| Option | Description | Selected |
|--------|-------------|----------|
| Same auth as dashboard | Behind optional DASHBOARD_API_KEY | ✓ |
| Always public | Bypasses API key check | |

**User's choice:** Same auth as dashboard
**Notes:** Consistent with existing auth hook. Prevents exposing internal state.

### Health Source for Safety/Execution

| Option | Description | Selected |
|--------|-------------|----------|
| Last-activity timestamp | Track last successful operation, degraded if no activity in window | ✓ |
| Error rate based | Track recent error rate in sliding window | |

**User's choice:** Last-activity timestamp
**Notes:** Simple, no false positives during quiet market periods.

---

## Alert Trigger Rules

### Alert Triggers

| Option | Description | Selected |
|--------|-------------|----------|
| Detection disconnect | WS close or silence > threshold | ✓ |
| RPC failover | Switch to backup endpoint | ✓ |
| Repeated API failures | N consecutive failures for Helius/Jupiter/RugCheck | ✓ |
| Rate limit activation | HTTP 429 detection | ✓ |

**User's choice:** All four triggers

### Debouncing

| Option | Description | Selected |
|--------|-------------|----------|
| Per-source cooldown | Same alert type + source fires once per cooldown, resets on recovery | ✓ |
| No debouncing | Every failure fires an alert | |

**User's choice:** Per-source cooldown

### Event Model

| Option | Description | Selected |
|--------|-------------|----------|
| New SYSTEM_ALERT event type | New enum value with severity and alertSource fields | ✓ |
| Reuse ERROR event type | Use existing ERROR with structured detail | |

**User's choice:** New SYSTEM_ALERT event type

### Recovery Events

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, emit recovery alerts | SYSTEM_ALERT with severity 'info' on recovery | ✓ |
| No recovery events | Only alert on failures | |

**User's choice:** Yes, emit recovery alerts

---

## RPC Metrics Scope

### Latency Metrics

| Option | Description | Selected |
|--------|-------------|----------|
| p50 + p99 + error rate | Percentile latency plus error rate per endpoint | ✓ |
| Simple averages + error count | Rolling average and total errors | |

**User's choice:** p50 + p99 + error rate

### API Scope

| Option | Description | Selected |
|--------|-------------|----------|
| RPC + external APIs | Track Helius, Jupiter, RugCheck alongside RPC | ✓ |
| RPC endpoints only | Only Solana RPC connections | |

**User's choice:** RPC + external APIs

### Exposure

| Option | Description | Selected |
|--------|-------------|----------|
| GET /api/metrics endpoint | Separate JSON endpoint for metrics data | ✓ |
| Include in /api/health | Bundle metrics into health response | |

**User's choice:** GET /api/metrics endpoint

### Window Size

| Option | Description | Selected |
|--------|-------------|----------|
| 5-minute window | Responsive without being noisy | ✓ |
| 1-minute window | Very responsive but noisy | |

**User's choice:** 5-minute window

---

## Log Rotation Strategy

### Implementation

| Option | Description | Selected |
|--------|-------------|----------|
| pino-roll transport | In-process file rotation via pino transport | ✓ |
| OS-level logrotate | External tool, requires VPS configuration | |

**User's choice:** pino-roll transport

### Policy

| Option | Description | Selected |
|--------|-------------|----------|
| Size + daily, keep 7 days | 50MB or daily rotation, 7-day retention | ✓ |
| Size-only, keep 5 files | Rotate at size, keep last 5 | |

**User's choice:** Size + daily, keep 7 days

### Environment Scope

| Option | Description | Selected |
|--------|-------------|----------|
| Production only | Dev keeps stdout + pino-pretty unchanged | ✓ |
| Both environments | Write rotated files in dev too | |

**User's choice:** Production only

---

## Metrics Collection Pattern

### Instrumentation Approach

| Option | Description | Selected |
|--------|-------------|----------|
| Central MetricsTracker service | Shared service with record(endpoint, latencyMs, success) | ✓ |
| Fetch wrapper/middleware | Instrumented fetch() auto-tracking | |

**User's choice:** Central MetricsTracker service

---

## Alert History Persistence

### Storage

| Option | Description | Selected |
|--------|-------------|----------|
| SQLite alerts table | Persistent table for dashboard history | ✓ |
| In-memory ring buffer | Last N alerts, lost on restart | |
| SSE only | Ephemeral, no persistence | |

**User's choice:** SQLite alerts table

### API Timing

| Option | Description | Selected |
|--------|-------------|----------|
| Expose GET /api/alerts now | Phase 20 exposes endpoint with pagination | ✓ |
| Defer to Phase 21 | Only persist, API later | |

**User's choice:** Expose GET /api/alerts now

---

## Config Surface

### Configurability Scope

| Option | Description | Selected |
|--------|-------------|----------|
| Key thresholds only | Alert cooldown, failure threshold, rotation size/retention | ✓ |
| Everything configurable | All 10+ settings in trading config | |
| Code defaults only | All hardcoded | |

**User's choice:** Key thresholds only

---

## Health Service Architecture

### Collection Pattern

| Option | Description | Selected |
|--------|-------------|----------|
| Central HealthService | Components register with callbacks | ✓ |
| Direct queries from route | Route imports and queries each component | |

**User's choice:** Central HealthService

### Alert Emission

| Option | Description | Selected |
|--------|-------------|----------|
| Unified in HealthService | HealthService detects transitions and emits alerts | ✓ |
| Separate alert system | Components emit their own alerts | |

**User's choice:** Unified in HealthService

---

## Claude's Discretion

- pino-roll configuration details and file naming
- SQLite alerts table schema (indexes, types)
- MetricsTracker sliding window data structure
- Percentile computation algorithm
- Default threshold values
- Rate limit detection hook approach
- Module location (src/core/ vs src/monitoring/)

## Deferred Ideas

None -- discussion stayed within phase scope.
