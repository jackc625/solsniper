# Phase 1: Foundation & Operations - Context

**Gathered:** 2026-02-20
**Status:** Ready for planning

<domain>
## Phase Boundary

All cross-cutting infrastructure: config loading, structured logging, RPC connectivity with failover, wallet security, and graceful shutdown. Every subsequent phase depends on these foundations. No detection, safety, trading, or UI logic.

</domain>

<decisions>
## Implementation Decisions

### Config & environment
- Environment variables use flat naming with `SOLSNIPER_` prefix (e.g., `SOLSNIPER_RPC_URL`, `SOLSNIPER_PRIVATE_KEY`)
- Fail-fast strict validation at startup — missing or invalid config causes immediate exit with all errors listed at once (no partial startup)
- Secrets (private key, RPC URLs/API keys) live in `.env`; trading parameters (buy amount, slippage, position limits, thresholds) live in a separate `config.json`
- Config loads once at startup — restart required to pick up changes (dashboard in Phase 8 will handle live changes later)

### RPC provider setup
- Helius as primary RPC provider + one backup provider
- Failover triggers after 2-3 consecutive failures (not single failure — avoids flapping on transient errors)
- While on backup, periodic health check pings primary and switches back when it responds
- RPC manager emits events (`failover`, `recovered`, `degraded`) so other modules can observe connection health

### Logging output
- Default pino-pretty output in development — no custom prettifier config needed
- Standard pino structured JSON in production

### Claude's Discretion
- Log destination strategy (stdout only vs stdout + file)
- Default dev log level (debug vs trace)
- Latency logging approach (always vs threshold-based)
- Source code module organization pattern
- Exact health check interval and consecutive failure count for RPC failover

### Project conventions
- Package manager: pnpm
- Runtime: Node.js with tsx (run TypeScript directly, no build step in dev)
- Testing: Vitest
- Zod for config/env validation (per requirements OPS-06)

</decisions>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 01-foundation-operations*
*Context gathered: 2026-02-20*
