---
phase: 21
reviewers: [gemini, codex]
reviewed_at: 2026-04-04T12:00:00Z
plans_reviewed: [21-01-PLAN.md, 21-02-PLAN.md, 21-03-PLAN.md, 21-04-PLAN.md, 21-05-PLAN.md]
---

# Cross-AI Plan Review — Phase 21

## Gemini Review

### Summary
The proposed plans are architecturally sound and strictly adhere to the user's "zero new backend endpoints for analytics" constraint by leveraging client-side computation. The wave-based approach correctly prioritizes the backend event infrastructure and navigation framework before layering on the data-intensive Pipeline and Performance views. The integration of safety guards (typing 'STOP', `isSellInFlight` checks) demonstrates a mature understanding of the risks associated with automated trading bots.

### Strengths
- **Performance Optimization**: Refactoring the `PnlChart` for instance reuse and computing P&L per source on the client side avoids unnecessary backend complexity and reduces server load.
- **Safety-First Controls**: The "Emergency Stop" implementation (D-13) with required string confirmation and the `409 Conflict` guard for in-flight sells (D-14) are excellent operational safeguards.
- **Observability Depth**: The Pipeline page (D-08, D-09) provides rare "under-the-hood" visibility into why tokens were skipped, which is critical for debugging "missed" trades.
- **Consistent State Management**: Using Preact signals for `pausedSignal` and `estopDialogOpen` ensures that the "Paused" state is synchronized across the sidebar, connection bar, and controls page.

### Concerns
- **MEDIUM**: High Volume SSE Flooding (Pipeline) — The `SAFETY_EVALUATION` event could trigger dozens of times per second during high-volatility periods. If the frontend attempts to render every event immediately, the browser thread may lock up.
- **MEDIUM**: Pause State Persistence — Plan 21-01 mentions a "Detection pause flag," but doesn't explicitly state if this is persisted to SQLite. If the bot restarts, it might resume sniping automatically when the user intended it to remain paused.
- **LOW**: Client-Side Analytics Scalability — If a user has 10,000+ trades, re-calculating the entire equity curve and source breakdown on every page load/filter change might cause a noticeable lag.
- **LOW**: Emergency Stop Atomicity — If the Emergency Stop triggers a "force-sell all," and the RPC fails halfway through the list, what is the retry logic?

### Suggestions
- Implement a "circular buffer" or maximum limit for the Pipeline and Alert lists in the Preact store to prevent memory leaks and UI sluggishness.
- For the `SAFETY_EVALUATION` feed, consider batching UI updates every 100-200ms rather than rendering on every single SSE message.
- Ensure the `detection_paused` state is stored in SQLite during 21-01 implementation, not just an in-memory variable.
- Ensure the `emergency-stop` endpoint returns a summary of success/failures so the UI can warn if some positions are still open.

### Risk Assessment
**Overall Risk: LOW**

The plan is well-contained. The most significant technical risk is UI performance (SSE handling), which is easily mitigated with standard frontend throttling patterns. The operational risk of the "Emergency Stop" is handled via high-friction confirmation logic. The dependency on Phase 20 is clear, and the wave structure allows for incremental testing.

**Recommendation:** Proceed with Wave 1 (21-01, 21-02) immediately, with a specific focus on ensuring the "Pause" state survives a process restart.

---

## Codex Review

### Plan 21-01: Backend Foundation

**Summary**: This is the critical plan for the whole phase, covering the right backend primitives. The scope is mostly appropriate, but the plan is underspecified in a few places that matter for correctness and safety, especially around auth/CSRF assumptions, idempotency, emergency-stop semantics, and what exactly gets emitted in `SAFETY_EVALUATION`.

**Strengths**:
- Establishes the minimum backend surface needed for DASH-08 and DASH-09
- Keeps analytics backend-neutral by not adding unnecessary performance endpoints
- Sell-in-flight guard is explicitly called out, addressing a real concurrency hazard
- Detection pause as an early guard is the right architectural placement
- Includes unit tests for control endpoints rather than leaving them implicit
- Adds TradeStore.getTradeById(), a sensible primitive for force-sell flows

**Concerns**:
- **HIGH**: No explicit authorization / local-operator protection model mentioned for force-sell, pause, or emergency-stop endpoints
- **HIGH**: Emergency stop semantics are vague — needs defined execution model: snapshot positions first, mark system paused before any sells, define partial-failure behavior
- **HIGH**: SAFETY_EVALUATION emission "after every non-cached evaluation" may miss useful operator visibility if cached paths are common
- **MEDIUM**: No idempotency behavior described for repeated pause/resume or emergency-stop requests
- **MEDIUM**: POST /api/trades/:id/force-sell needs explicit handling for nonexistent trades, closed trades, already-exited trades
- **MEDIUM**: Detection pause as a first guard may not be sufficient if there are multiple entry paths or buffered events downstream
- **LOW**: GET /api/controls/status payload contract is unclear

**Suggestions**:
- Define endpoint protection explicitly, even if single-user localhost-only
- Specify response contracts for all control endpoints, including idempotent cases
- Define emergency stop ordering precisely: set paused → snapshot positions → dispatch sells → return summary
- Add tests for repeated requests, already-closed positions, nonexistent IDs, partial emergency-stop failure
- Decide whether cached safety results should emit a distinct event

### Plan 21-02: Frontend Navigation Foundation

**Summary**: Clean, appropriately scoped UI foundation plan. Aligns well with locked navigation decisions and creates shells needed for later waves.

**Concerns**:
- **MEDIUM**: Shared state beyond pausedSignal and estopDialogOpen not specified (health, connection derivation)
- **MEDIUM**: CONNECTED/PAUSED/NO SIGNAL precedence rules needed
- **MEDIUM**: Health dot dependency on /api/health — polling bootstrapped here or deferred?
- **LOW**: No route persistence/deep linking behavior mentioned

**Risk**: LOW-MEDIUM

### Plan 21-03: Per-Source Analytics

**Summary**: Efficient and well aligned. Avoids backend expansion. Main risks are data-shape assumptions and scale/performance.

**Concerns**:
- **HIGH**: Assumes /api/trades/history already exposes canonical source data mapping to pumpportal/raydium/pumpswap — if missing, plan fails
- **MEDIUM**: Full client-side recomputation may become expensive as dataset grows
- **MEDIUM**: Win/loss definition unclear (realized vs unrealized, break-even, partial exits)
- **MEDIUM**: Source label translation layer between cards and toggle buttons not specified

**Risk**: MEDIUM

### Plan 21-04: Pipeline & Controls Pages

**Summary**: Targets the heart of the phase. Major concern is degraded-state handling, race conditions, and UX safeguards around streaming volume and stale control state.

**Concerns**:
- **HIGH**: Streaming pipeline cards can become unbounded and degrade UI during high token volume
- **HIGH**: Control actions need stale-state handling — position may close between render and click
- **HIGH**: Emergency stop lacks duplicate-submit prevention, in-progress state, summary/error reporting
- **MEDIUM**: Pipeline stats need defined time window (lifetime vs rolling)
- **MEDIUM**: Inline confirmation for force-sell may be too easy to trigger accidentally in dense table

**Risk**: MEDIUM-HIGH

### Plan 21-05: System Status Page

**Summary**: Reasonable and contained. Covers health, metrics, alerts. Biggest issues are polling strategy and stale-data handling.

**Concerns**:
- **MEDIUM**: Polling freshness behavior unclear across sections
- **MEDIUM**: Stale health data if polling stops or tab sleeps
- **MEDIUM**: No threshold coloring or interpretation cues for RPC metrics
- **LOW**: No alert filtering/grouping mentioned
- **LOW**: Visual verification checkpoint is weak validation

**Risk**: MEDIUM

### Codex Overall Assessment

**MEDIUM** overall risk. Plans are generally good and should achieve phase goals, but need tightened contracts around control safety, data freshness, and real-time rendering behavior before implementation.

---

## Consensus Summary

### Agreed Strengths
- **Wave-based dependency ordering** — Both reviewers praised the backend-first, navigation-second, pages-third approach as architecturally sound
- **Safety-first controls** — The 409 Conflict guard for sellsInFlight, STOP confirmation for emergency stop, and inline force-sell confirmation were highlighted as excellent operational safeguards by both
- **Client-side analytics** — Both agreed the zero-new-backend-endpoints approach for per-source analytics is the right call, avoiding scope creep
- **PnlChart instance reuse** — Both recognized the chart flickering fix (Pitfall 5) as a valuable quality improvement
- **Consistent state management** — Preact signals for cross-component state synchronization praised by both

### Agreed Concerns
- **SSE/Pipeline event volume** (MEDIUM-HIGH) — Both reviewers flagged that SAFETY_EVALUATION events could overwhelm the browser during high token volume. Need bounded rendering and/or batched UI updates
- **Emergency stop robustness** (MEDIUM-HIGH) — Both raised concerns about partial-failure handling, duplicate-submit prevention, and whether the UI properly reports which sells succeeded vs failed
- **Pause state persistence** (MEDIUM) — Gemini explicitly flagged in-memory-only pause state not surviving restart. Codex raised it indirectly via idempotency concerns
- **Stale data handling** (MEDIUM) — Both noted insufficient specification for what happens when polling stops, tabs sleep, or data becomes stale. Health dots showing "green" on stale data is misleading
- **Client-side computation scale** (MEDIUM) — Both noted that client-side analytics recomputation could lag with large trade histories

### Divergent Views
- **Authorization model**: Codex flagged HIGH concern about missing endpoint auth/CSRF for control endpoints. Gemini did not mention this, likely because the project is documented as single-user/personal tool with existing API key auth
- **Cached evaluation visibility**: Codex raised HIGH concern that skipping SAFETY_EVALUATION emission on cache hits creates incomplete picture. Gemini did not flag this, focusing more on fresh event volume
- **Risk severity**: Gemini assessed overall LOW risk. Codex assessed MEDIUM risk. The delta appears to be Codex's focus on under-specified operational contracts vs Gemini's focus on the existing mitigations already in the plans
- **Integration testing**: Codex repeatedly recommended integration tests across plans. Gemini suggested frontend throttling as the primary mitigation. Different validation philosophies
