# Phase 2: Token Detection - Context

**Gathered:** 2026-02-21
**Status:** Ready for planning

<domain>
## Phase Boundary

Real-time detection of new token launches from two sources: PumpPortal WebSocket for Pump.fun token creations, and Solana RPC logsSubscribe for Raydium pool creations. Includes resilient WebSocket connections with auto-reconnect, heartbeat-based dead connection detection, and reconnection alerting. Safety checks, trade execution, and persistence are separate phases.

</domain>

<decisions>
## Implementation Decisions

### Token event data
- Claude's discretion on how much metadata to capture from PumpPortal events (mint, creator, liquidity, name/symbol, bonding curve address — grab what's available and useful for downstream)
- Claude's discretion on Raydium log parsing depth (extract what's practical from logsSubscribe data for downstream needs)
- Track detection latency: stamp each event with detection time (when bot received it) for speed measurement and optimization
- Basic pre-filter at detection layer: drop obvious junk (known scam patterns, etc.) before passing to safety pipeline to reduce downstream load

### Dual-source overlap
- Claude's discretion on dedup strategy when a Pump.fun token migrates to Raydium and gets detected by both listeners
- Claude's discretion on source priority (PumpPortal vs Raydium)
- Config toggles for each source: PUMPPORTAL_ENABLED and RAYDIUM_ENABLED flags so either source can be independently disabled
- Claude's discretion on single-source behavior adjustments

### Connection resilience
- Conservative reconnection: start at 2-5s backoff, exponential up to 60s max. Accept some missed launches during extended downtime rather than hammering the server
- Claude's discretion on excessive reconnection threshold (make it configurable)
- Claude's discretion on max-retry failure behavior (keep retrying vs stop listener)
- Claude's discretion on heartbeat ping interval (whether fixed or configurable)

### Detection logging
- One-liner per detected token: mint address, source (pump/raydium), detection latency, pre-filter result. Compact, one log line per event
- Periodic stats every 15 minutes: total detected, filtered out, per-source breakdown
- Filtered-out tokens logged at debug level (invisible in normal operation, available when verbose)

### Claude's Discretion
- PumpPortal event metadata capture depth
- Raydium log parsing detail level
- Dedup strategy for cross-source overlap
- Source priority handling
- Single-source mode behavior
- Excessive reconnection threshold value
- Max-retry failure behavior
- Heartbeat interval configuration approach

</decisions>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches. User wants a reliable detection layer that's transparent about its activity (latency tracking, periodic stats) without being noisy.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 02-token-detection*
*Context gathered: 2026-02-21*
