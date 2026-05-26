# Phase 19: Execution Performance - Context

**Gathered:** 2026-03-30
**Status:** Ready for planning

<domain>
## Phase Boundary

Dynamic priority fees replace static fees, compute units are precise on self-built transactions, and a balance guard prevents buying below operational minimums. Covers: Helius getPriorityFeeEstimate integration (EXE-10), ComputeBudgetProgram optimization on non-Jupiter paths (EXE-11), and wallet SOL balance guard before buys (EXE-12). No new execution paths or sell ladder steps -- strictly optimizing existing transaction handling.

</domain>

<decisions>
## Implementation Decisions

### Fee Source Strategy (EXE-10)
- **D-01:** Use Helius getPriorityFeeEstimate as a **dynamic cap** for Jupiter paths -- Helius sets a network-aware `maxLamports` ceiling, Jupiter picks optimal fee within that cap via `priorityLevelWithMaxLamports`
- **D-02:** For PumpPortal paths (buy and sell), use Helius estimate **directly** as the priority fee -- PumpPortal has no built-in fee estimation
- **D-03:** Request `veryHigh` priority level from Helius -- matches current Jupiter setting, targets top-of-block inclusion
- **D-04:** If Helius call fails or times out, **fall back to existing static config values** (priorityFeeBaseLamports * priorityFeeMultiplier) -- never block a transaction due to fee estimation failure
- **D-05:** Add new config field `maxPriorityFeeCapLamports` as absolute ceiling -- even if Helius returns an extreme estimate during congestion, never exceed this cap. Protects wallet from runaway fees
- **D-06:** Cache Helius fee estimate with **short TTL (5-10 seconds)** -- multiple transactions in a burst reuse the same estimate, reduces Helius API load
- **D-07:** Log fee details per transaction: Helius estimate, cap applied, whether fallback was used -- enables post-trade fee analysis and tuning
- **D-08:** Keep existing static config fields (priorityFeeBaseLamports, priorityFeeMultiplier) as fallback values -- no breaking config change, add new dynamic fee fields alongside

### Compute Unit Optimization (EXE-11)
- **D-09:** Jupiter paths already use `dynamicComputeUnitLimit: true` -- do NOT override Jupiter's CU handling
- **D-10:** PumpPortal API builds transactions server-side -- leave CU to PumpPortal, not our concern
- **D-11:** For Jito bundle sell path (where we build the transaction): **simulate first**, then set CU limit to consumed + 10-20% buffer via ComputeBudgetProgram.setComputeUnitLimit()
- **D-12:** CU simulation only on **sell transactions** -- buy path is speed-critical, simulation adds ~50-100ms latency that's unacceptable for first-block targeting
- **D-13:** No extra CU logging -- keep logs lean

### Claude's Discretion (Compute Units)
- Where exactly CU limits add value beyond Jito sells -- investigate which self-built transaction paths exist
- Whether to use a generous fixed CU limit for buy-path self-built transactions instead of simulation

### Balance Guard (EXE-12)
- **D-14:** Check wallet SOL balance **before safety pipeline** -- saves ~200-500ms of wasted safety check work when balance is insufficient
- **D-15:** When balance is below threshold: **skip buy + emit BotEventBus event** for dashboard-visible low-balance alert via SSE stream
- **D-16:** Threshold = `buyAmountSol + minBalanceBufferSol` -- accounts for buy amount plus fees/rent buffer
- **D-17:** New config field: `minBalanceBufferSol` (e.g., default 0.01 SOL) -- user-configurable buffer for tx fees and rent
- **D-18:** Cache getBalance result with **short TTL (5-10 seconds)** -- reduces RPC load during burst token detections
- **D-19:** Balance guard applies to **buys only** -- sells must always attempt regardless of balance (exiting positions is critical)

### Sell Ladder Fees
- **D-20:** PumpPortal sell path uses dynamic Helius fee estimate (same as buy path) -- consistent, no extra API calls thanks to cache
- **D-21:** Keep Jito bundle tips **fixed** -- dynamic Jito tips are EXE-14 scope (deferred to v1.2)
- **D-22:** Same `maxPriorityFeeCapLamports` applies to both buys and sells -- sell ladder has its own escalation (multipliers, then Jito) for urgency

### Claude's Discretion (Sell Ladder)
- Whether sell ladder STANDARD step uses Helius dynamic base with multiplier escalation on top, or keeps existing static approach -- pick based on how escalation multipliers interact with dynamic fees
- Whether HIGH_FEE escalation step can exceed maxPriorityFeeCap or stays capped -- pick based on wallet drain risk vs exit urgency tradeoff

### Claude's Discretion (Fee Estimation)
- Whether to pass specific account keys to getPriorityFeeEstimate for per-transaction accuracy, or use global network estimate -- pick based on what Helius API supports and latency tradeoffs

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/REQUIREMENTS.md` -- EXE-10, EXE-11, EXE-12 requirement definitions

### Execution source files
- `src/execution/buy/jupiter-buyer.ts` -- Jupiter buy path: prioritizationFeeLamports with priorityLevelWithMaxLamports, dynamicComputeUnitLimit: true
- `src/execution/buy/pump-portal-buyer.ts` -- PumpPortal buy path: static priorityFee in SOL
- `src/execution/sell/standard-seller.ts` -- Jupiter sell path: same Jupiter fee pattern with feeMultiplier
- `src/execution/sell/pump-portal-seller.ts` -- PumpPortal sell path: static priorityFee
- `src/execution/sell/jito-seller.ts` -- Jito bundle sell path: highFeeMultiplier, fixed tip
- `src/execution/sell/sell-ladder.test.ts` -- Sell ladder test with fee config structure

### Config and types
- `src/config/trading.ts` -- BuyConfigSchema (priorityFeeBaseLamports, priorityFeeMultiplier), SellConfigSchema (highFeeMultiplier)
- `config.jsonc` -- Current static fee values

### Infrastructure
- `src/execution/broadcaster.ts` -- broadcastWithRetry, broadcastAndConfirm -- transaction sending
- `src/execution/jupiter-client.ts` -- Jupiter API wrapper (quote, swap endpoints)

### Prior phase context
- `.planning/phases/17-security-fixes/17-CONTEXT.md` -- D-05 Helius API uses X-Api-Key header format
- `.planning/phases/18-safety-pipeline-audit-enhancement/18-CONTEXT.md` -- Safety pipeline structure, tier ordering

### Architecture
- `.planning/codebase/ARCHITECTURE.md` -- Execution Layer description, buy/sell flow, retry escalation ladder

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `jupiterClient` in `src/execution/jupiter-client.ts` -- wraps Jupiter API calls (quote, swap), reuse for fee-augmented swap calls
- `broadcastWithRetry` / `broadcastAndConfirm` in `src/execution/broadcaster.ts` -- transaction sending patterns, no changes needed
- `createModuleLogger` in `src/core/logger.ts` -- structured pino logging, use for fee/balance logging
- `BotEventBus` pattern -- used for SSE dashboard events, reuse for balance guard alerts

### Established Patterns
- **Jupiter prioritizationFeeLamports:** All Jupiter paths use `priorityLevelWithMaxLamports` with `priorityLevel: 'veryHigh'` and `maxLamports` -- replace static maxLamports with Helius dynamic cap
- **PumpPortal priorityFee:** Both buy and sell PumpPortal paths accept `priorityFee` in SOL -- replace static calculation with Helius estimate / 1e9
- **Sell ladder escalation:** STANDARD (1x) -> HIGH_FEE (highFeeMultiplier) -> Jito (fixed tip) -- dynamic fee slots in as the base
- **Zod config schemas:** New config fields added to existing schemas with defaults -- pattern from Phase 17/18
- **Config hot-reload:** All config changes via dashboard PATCH endpoint -- new fields automatically hot-reloadable

### Integration Points
- `src/config/trading.ts` -- add maxPriorityFeeCapLamports to execution config, minBalanceBufferSol to new balance guard config
- `src/index.ts` or detection handler -- insert balance check before safety pipeline call
- All 4 buyer/seller files -- replace static fee calculation with dynamic Helius estimate
- New module: Helius fee estimation service with caching (e.g., `src/core/fee-estimator.ts`)
- `BotEventBus` -- emit LOW_BALANCE event type for dashboard SSE

</code_context>

<specifics>
## Specific Ideas

No specific requirements -- open to standard approaches.

</specifics>

<deferred>
## Deferred Ideas

- **Dynamic Jito tip amounts** -- EXE-14, explicitly deferred to v1.2. Jito tips stay fixed in Phase 19.
- **Per-transaction account-based fee estimation** -- could improve accuracy by passing mint/pool accounts to Helius. Deferred to see if global estimates are sufficient first.

</deferred>

---

*Phase: 19-execution-performance*
*Context gathered: 2026-03-30*
