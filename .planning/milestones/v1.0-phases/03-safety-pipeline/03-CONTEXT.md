# Phase 3: Safety Pipeline - Context

**Gathered:** 2026-02-21
**Status:** Ready for planning

<domain>
## Phase Boundary

Bot evaluates every detected token against a multi-tiered safety pipeline (Tier 1 hard checks, Tier 2 scoring signals, Tier 3 deep analysis) and only allows buying tokens that pass a configurable safety score threshold. This phase builds the evaluation pipeline and scoring engine. Actual buy execution is Phase 5; persistence is Phase 4.

</domain>

<decisions>
## Implementation Decisions

### Scoring & thresholds
- Score scale: Claude's discretion (pick most practical internal representation)
- Check weights (Tier 2 vs Tier 3 relative importance): Claude's discretion
- Default minimum safety score threshold: **moderate (60+)** — catch obvious rugs but allow tokens with some yellow flags
- Per-check soft blocks: individual Tier 2/3 checks CAN independently reject tokens regardless of aggregate score (e.g., extreme holder concentration auto-rejects even if aggregate is fine)
- Rejection logging: **detailed** — log exactly which check(s) caused rejection and by how much it missed (e.g., "REJECTED: holder_concentration=0.25 (threshold 0.40), aggregate=52 (threshold 60)")
- All scoring config (weights, thresholds, per-check soft blocks) lives in **main config.json**, not a separate file

### Async check behavior
- Tier 2/3 timing strategy (wait vs proceed vs timeout): Claude's discretion
- API failure handling: **pessimistic** — treat failed/timed-out checks as negative signal ("if we can't verify, assume the worst")
- Tier 2 vs Tier 3 parallelism: Claude's discretion (parallel vs sequential gating)
- Safety result caching: **cache with TTL** — if same token mint detected again (e.g., from both PumpPortal and Raydium), skip re-running checks within cache window

### Holder concentration rules
- Metrics: check **both** top-1 holder % AND top-10 holders combined %
- Exclude known system accounts (bonding curve, LP pool, burn addresses) from calculations — only count real wallets
- Top-1 soft block threshold: **25%+** of supply held by single non-system wallet triggers auto-rejection
- Top-10 soft block threshold: **50%+** combined supply held by top 10 non-system wallets triggers auto-rejection
- Both thresholds configurable in config.json

### Creator history signals
- What patterns to flag: Claude's discretion (serial deployment, create-then-dump, etc.)
- Lookback depth: Claude's discretion (balance API cost vs signal quality)
- Known rug creator enforcement: **hard reject** — if creator has clear rug history, auto-reject regardless of other scores. Zero tolerance.
- Local blocklist: **yes, persist** known-bad creator addresses locally. Instant reject on repeat encounters without API calls. Grows over time.

### Claude's Discretion
- Score scale representation (0-100, 0-1, etc.)
- Tier 2/3 check weights in aggregate
- Async timing strategy (wait/timeout/proceed)
- Tier 2 vs Tier 3 parallelism approach
- Creator history pattern detection specifics and lookback depth
- Event-driven vs direct return for pipeline results
- Logging verbosity for passing tokens
- Safety result cache TTL duration

</decisions>

<specifics>
## Specific Ideas

- Rejection logs should be actionable: show which check failed, the actual value, and the threshold it missed — so the operator can tune thresholds based on real data
- Pessimistic on API failures — "if we can't verify, assume the worst" is the guiding principle
- Creator blocklist should persist and grow over time, becoming more effective as the bot runs longer

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 03-safety-pipeline*
*Context gathered: 2026-02-21*
