# Phase 5: Execution Engine - Context

**Gathered:** 2026-02-26
**Status:** Ready for planning

<domain>
## Phase Boundary

Bot can buy bonding-curve tokens via PumpPortal trade-local API and migrated tokens via Jupiter Swap API (routing based on token state), and can sell positions through a multi-step escalation ladder using Jito bundles and multi-RPC broadcast. Position management triggers are a separate phase.

</domain>

<decisions>
## Implementation Decisions

### Sell escalation ladder
- Steps in order: Standard → Higher fees → Jito bundle → Chunked sell → Emergency slippage
- Advancement trigger: Timeout per step (not failure count — time-based only)
- Timeouts are configurable per-step in config.json with sensible defaults
- Chunked sell: split position into 3 equal tranches, sent sequentially
- Emergency slippage is the final step (last resort before SELL_FAILED)

### Slippage configuration
- Buy slippage: configurable in config.json, default 10%
- Standard sell slippage: configurable in config.json, default 5%
- Emergency sell slippage: configurable in config.json, default 49%
- Each ladder step uses the appropriate slippage for that step

### Priority fee escalation
- Configurable multiplier per ladder step (e.g., 1x → 3x → 10x base fee)
- Jito bundle step uses a separate configurable Jito tip amount (not a multiplier)
- All fee values configurable in config.json

### Multi-RPC broadcast
- Parallel broadcast: fire to all available RPCs simultaneously on every transaction
- Applies to both buys and sells (not sells-only)
- Required confirmation level: `confirmed` (2/3 supermajority)
- Confirmation polling strategy: Claude's discretion

### Buy failure behavior
- No retry on buy — single attempt only (speed over resilience, miss and move on)
- Failed buy recorded as BUY_FAILED terminal state in SQLite
- BUY_FAILED entry cleaned from in-memory duplicate guard so future buys of that token are allowed

### Sell exhaustion behavior
- When escalation ladder fully exhausts without confirmed sell: record as SELL_FAILED terminal state
- SELL_FAILED is terminal for this phase — no further retry attempts
- Alerting: structured ERROR log only, no external alerting or event emission

### Claude's Discretion
- Confirmation polling interval and retry strategy
- Exact config.json key naming and structure
- Jito bundle construction internals
- Error classification logic (which errors trigger step timeout vs explicit failure)

</decisions>

<specifics>
## Specific Ideas

- Blockhash must be fetched as the absolute last step before signing (never before safety checks), and refreshed on every retry attempt
- Chunked sell tranches are sequential (not parallel) — wait for each to confirm before sending next

</specifics>

<deferred>
## Deferred Ideas

- None — discussion stayed within phase scope

</deferred>

---

*Phase: 05-execution-engine*
*Context gathered: 2026-02-26*
