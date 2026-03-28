# Phase 18: Safety Pipeline Audit & Enhancement - Context

**Gathered:** 2026-03-28
**Status:** Ready for planning

<domain>
## Phase Boundary

Validate and improve safety filtering accuracy with new rug detection checks. Covers: auditing current pass/fail rates against real trade outcomes (SAF-10), calibrating scoring weights and thresholds based on findings (SAF-11), and adding three new safety checks -- liquidity depth hard gate (SAF-12), LP lock/burn scoring (SAF-13), and metadata mutability scoring (SAF-14). No new features outside the safety pipeline.

</domain>

<decisions>
## Implementation Decisions

### Audit Methodology
- **D-01:** Build a Node.js log analysis script that parses pino JSON safety logs + queries SQLite trades table to correlate safety pass/fail decisions with actual trade P&L outcomes
- **D-02:** Also enrich the trades table with new columns (safety_score, safety_rejection_reasons, safety_checks_detail) for structured ongoing monitoring of future trades
- **D-03:** For rejected tokens (false positive analysis), sample-check ~50 random rejected mints from logs by fetching their current price/status -- not exhaustive, just a rough estimate
- **D-04:** Audit report output as a Markdown file (committed to repo) with summary stats, per-check accuracy tables, score distributions, and recommended weight/threshold changes

### Scoring Calibration
- **D-05:** New checks use a "separate gate + score" model: liquidity depth is a hard gate (reject below threshold, like Tier 1). LP lock and metadata mutability are scoring signals that apply configurable score penalties to the aggregate
- **D-06:** Audit script produces data + recommendations for new weight/threshold values based on correlations found. User reviews and applies manually -- no auto-apply
- **D-07:** Dry-run validation: after applying new weights, run bot in dry-run mode and compare safety pass/fail rates in logs against the audit baseline. Manual comparison, no automated diff script

### New Check Design: Liquidity Depth (SAF-12)
- **D-08:** Read on-chain pool reserves directly via getAccountInfo -- Raydium pool SOL reserves for Raydium tokens, bonding curve contract SOL balance for pump.fun tokens
- **D-09:** Hard gate: reject if SOL reserves below configurable `minLiquiditySol` threshold
- **D-10:** Runs in Tier 1 parallel alongside mint auth, freeze auth, and sell route checks

### New Check Design: LP Lock/Burn (SAF-13)
- **D-11:** Primary source: extract LP lock/burn risk signals from existing RugCheck API response (piggyback on tier2-rugcheck.ts call -- no additional API call)
- **D-12:** Fallback: on-chain LP token check -- verify if LP tokens are sent to known burn address (1nc1nerator) or locked in known locker contracts. Used when RugCheck times out or is unavailable
- **D-13:** Scoring signal: unlocked LP applies configurable `lpLockScorePenalty` (e.g., -30) to aggregate score
- **D-14:** Runs in Tier 2 parallel alongside rugCheck, holder, creator checks

### New Check Design: Metadata Mutability (SAF-14)
- **D-15:** On-chain Metaplex check: derive metadata PDA from mint, fetch via getAccountInfo, check `isMutable` flag
- **D-16:** Scoring signal: mutable metadata applies configurable `metadataMutablePenalty` (e.g., -15) to aggregate score
- **D-17:** Runs in Tier 2 parallel alongside other scoring checks
- **D-18:** Applies to ALL sources (both pump.fun and Raydium) -- Metaplex metadata exists regardless of DEX

### Pipeline Ordering
- **D-19:** Tier 1 (hard gates, parallel): mint auth + freeze auth + sell route + **liquidity depth** -- all run via Promise.all, any failure = immediate reject
- **D-20:** Tier 2+3 (scoring, parallel): rugCheck + holder + creator + **LP lock/burn** + **metadata mutability** -- all run via Promise.allSettled with timeouts
- **D-21:** No new tiers -- new checks slot into existing tier structure

### Pump.fun Source Handling
- **D-22:** Liquidity depth: for pumpportal source, read bonding curve contract SOL balance (PDA already derived in tier2-holder.ts) instead of Raydium pool reserves
- **D-23:** LP lock/burn: skip for pumpportal source (no LP tokens during bonding curve phase) -- return pass=true with neutral score
- **D-24:** Metadata mutability: run normally for all sources including pumpportal

### Config Surface
- **D-25:** Add to safety config in trading.json: `minLiquiditySol` (hard gate threshold), `lpLockScorePenalty` (score deduction if unlocked), `metadataMutablePenalty` (score deduction if mutable)
- **D-26:** All new config values hot-reloadable via existing dashboard PATCH /api/config endpoint

### Claude's Discretion
- Exact bonding curve deserialization approach (read SOL balance from account data)
- Known locker program IDs for on-chain LP lock fallback check
- Metaplex metadata PDA derivation and account parsing implementation
- Audit script internal structure and query design
- Default values for new config thresholds (minLiquiditySol, penalty amounts)
- Schema migration strategy for new trades table columns

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/REQUIREMENTS.md` -- SAF-10 through SAF-14 requirement definitions

### Safety pipeline source files
- `src/safety/safety-pipeline.ts` -- Main orchestrator: tier structure, scoring weights, aggregate computation, cache
- `src/safety/checks/tier1-authority.ts` -- Pattern A (getAccountInfo + unpackMint) for authority checks, retry logic
- `src/safety/checks/tier1-sell-route.ts` -- Source-aware skip pattern for pumpportal (reuse for new checks)
- `src/safety/checks/tier2-rugcheck.ts` -- RugCheck API integration, response parsing (LP lock data lives here)
- `src/safety/checks/tier2-holder.ts` -- Holder concentration, bonding curve PDA derivation (reuse PUMP_FUN_PROGRAM_ID + findProgramAddressSync)
- `src/safety/checks/tier3-creator.ts` -- Helius API with X-Api-Key header pattern (Phase 17 migrated)

### Config and types
- `src/config/trading.ts` -- SafetyWeightsSchema, HolderConfigSchema, SafetyConfigSchema, minSafetyScore
- `src/types/index.ts` -- CheckResult and SafetyResult interfaces (lines 45-61)

### Persistence
- `src/persistence/trade-store.ts` -- SQLite trades table (schema migration target for safety columns)

### Architecture
- `.planning/codebase/ARCHITECTURE.md` -- Safety Evaluation Layer description, data flow, error handling patterns

### Prior phase context
- `.planning/phases/17-security-fixes/17-CONTEXT.md` -- D-05 Helius API key migration, D-03 ESLint security rules

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `PUMP_FUN_PROGRAM_ID` + bonding curve PDA derivation in `tier2-holder.ts` -- reuse for bonding curve SOL balance check
- `resolveSettled()` in `safety-pipeline.ts` -- reuse for new Tier 2 checks with Promise.allSettled
- Source-aware skip pattern in `tier1-sell-route.ts` -- reuse for pumpportal liquidity/LP skip
- `SafetyCache` in `safety-cache.ts` -- results already cached per mint, new checks automatically benefit
- `Blocklist` in `blocklist.ts` -- could extend for LP-related flagging if needed

### Established Patterns
- **CheckResult interface:** All checks return `{ pass, score?, source, detail }` -- new checks follow same contract
- **Tier 1 = Promise.all, Tier 2+3 = Promise.allSettled with AbortSignal.timeout** -- new checks slot into existing parallel structure
- **Pessimistic on error:** Tier 1 errors = hard block (pass=false), Tier 2+3 errors = score=0 pass=true (don't incorrectly hard-block)
- **Pino structured logging:** Every evaluation logged with full check details -- audit script parses these
- **Zod config schemas:** New config fields added to SafetyConfigSchema with defaults

### Integration Points
- `safety-pipeline.ts evaluate()` -- add new checks to Promise.all (Tier 1) and Promise.allSettled (Tier 2) batches
- `src/config/trading.ts SafetyConfigSchema` -- add minLiquiditySol, lpLockScorePenalty, metadataMutablePenalty
- `src/persistence/trade-store.ts` -- schema migration to add safety_score, safety_rejection_reasons, safety_checks_detail columns
- `src/index.ts` -- pass SafetyResult data to trade-store when recording trades
- Aggregate score computation in safety-pipeline.ts -- apply LP lock and metadata penalties after weighted average

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

*Phase: 18-safety-pipeline-audit-enhancement*
*Context gathered: 2026-03-28*
