# Quick Task 260322-q4u: fix validated bugs from codebase audit - Context

**Gathered:** 2026-03-22
**Status:** Ready for planning

<domain>
## Task Boundary

Fix 7 validated issues from BUGS.md codebase audit: BUG 1 (Jito poll loop), BUG 2 (recovery counter), BUG 3 (deep merge config), BUG 4 (orphaned dashboard event), BUG 5 (double-count display), BUG 6 (memory leak), S1 (API key in URL). Skip BUG 7, D1, D2.

</domain>

<decisions>
## Implementation Decisions

### BUG 2: Recovery counter fix
- Don't increment any counter on RPC failure — let the summary totals speak for themselves
- No new sellingFailed field added to RecoverySummary

### BUG 3: Deep merge scope
- Deep merge ALL nested objects: positionManagement, safety (+ safety.weights), execution (+ execution.buy, execution.sell), detection
- Future-proof — any nested key patched via dashboard or programmatic call will merge correctly

### D1/D2: Skip confirmation
- Skip both — deliberate design choices, not accidental bugs
- D1 (as any cast): known Phase 8 shortcut
- D2 (dead config fields): known Phase 7 backward-compat decision

### Claude's Discretion
- BUG 1 polling loop: interval/max attempts for Jito polling
- BUG 4: whether to emit SELL_CONFIRMED or skip SELL_TRIGGERED on zero-balance path
- BUG 6: cleanup timing (fireSell .finally vs explicit cleanup method)
- S1: URL sanitization approach

</decisions>

<specifics>
## Specific Ideas

- BUG 1: ~500ms poll interval, break on 'Landed' or 'Failed', let SellLadder timeout manage upper bound
- BUG 4: Move SELL_TRIGGERED emission after the zero-balance check, so it's never emitted for empty wallets
- BUG 5: Use priorTrade.sellPriceSol directly (already includes just-added amount) — don't add solReceived again
- BUG 6: Clean up Maps in fireSell's .finally() when trade reaches terminal state
- S1: Sanitize URL in catch block error message (mask api-key param)

</specifics>
