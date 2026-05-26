# Project Research Summary

**Project:** SolSniper v1.1 Hardening & Polish
**Domain:** Solana token sniper bot — hardening a shipped v1.0 MVP
**Researched:** 2026-03-27
**Confidence:** HIGH

## Executive Summary

SolSniper v1.1 is a hardening milestone on a fully shipped, battle-tested v1.0 bot. The research framing is fundamentally different from a greenfield project: the existing stack is validated and unchanged, the architecture is well-understood, and the question is surgical improvement rather than design. The recommended approach is to fix known security holes first, then improve the safety pipeline accuracy, then optimize transaction execution, then harden infrastructure reliability, and finally expose everything in an overhauled dashboard. This ordering is non-negotiable: security fixes unblock the Helius API refactor that safety depends on, better filtering reduces wasted execution attempts, and the dashboard is a consumer of all the new events and endpoints built in prior phases.

The key risk in this milestone is not feature complexity — most individual changes are well-understood — but interaction effects between changes. The three highest-consequence interaction risks are: (1) safety scoring recalibration that silently shifts pass rates in the wrong direction, (2) dashboard write paths (operational controls) that race with the bot's autonomous state machine, and (3) dependency updates that break the ESM/CJS interop on which `better-sqlite3` and `@solana/spl-token` depend. Each of these can cause financial loss or silent operational degradation without obvious error signals.

The net-new production dependency footprint is deliberately minimal: only 4 packages needed (rate-limit, helmet, under-pressure, pino-roll), all from the established Fastify ecosystem. Every other v1.1 improvement uses existing capabilities — Helius `getPriorityFeeEstimate` via a direct JSON-RPC POST, compute budget via built-in `@solana/web3.js` classes, analytics from existing SQLite data, and safety improvements via existing `getAccountInfo` patterns. This restraint is correct; the bot's current dependency surface is a competitive advantage.

## Key Findings

### Recommended Stack

The v1.0 stack (TypeScript ES2022, Fastify 5, @solana/web3.js v1, better-sqlite3, Preact + Vite, pino, Zod 4, eventemitter3) requires no new frameworks. Four Fastify ecosystem plugins are the only additions. See `.planning/research/STACK.md` for full version compatibility analysis.

**New production dependencies (v1.1 only):**
- `@fastify/rate-limit@^10.3`: API rate limiting for dashboard — prevents brute-force, in-memory store sufficient for single-process bot
- `@fastify/helmet@^13.0`: Security headers (CSP, X-Frame-Options, etc.) — one-line registration, covers 11+ headers with tested defaults
- `@fastify/under-pressure@^9.0`: Event loop and heap monitoring — returns 503 under load, exposes memoryUsage for dashboard health display
- `pino-roll@^4.0`: Log file rotation by size/time — prevents unbounded log growth on VPS, cross-platform (dev+VPS)

**Explicitly not adding:** helius-sdk, @metaplex-foundation/mpl-token-metadata, opossum, prometheus-client, @opentelemetry/*, node-cron, helmet (standalone Express version), express-rate-limit. Each would duplicate existing functionality, add operational burden, or be incompatible with Fastify 5.

**One security fix:** Move Helius API key from URL query parameter to `Authorization: Bearer` header in `tier3-creator.ts`. Helius supports both; header auth prevents key leakage in access logs and error traces.

### Expected Features

See `.planning/research/FEATURES.md` for the full feature taxonomy with complexity, dependency, and rationale for each item.

**Must have (table stakes — ship or the bot has known holes):**
- TS-1 through TS-4: Security audit fixes from BUGS.md (SQL injection audit, API key migration, config validation tightening, dependency vulns) — low effort, mandatory
- TS-5: SOL balance guard before buys — prevents wallet draining below operational minimums
- TS-6 + TS-8: Dynamic priority fees + compute unit optimization — static fees are a competitive disadvantage in 2026's Solana fee market; both use existing @solana/web3.js, no new deps
- TS-7: Structured health monitoring / silent failure detection — operator has no way to know when detection is disconnected, APIs are failing, or rate limits are active

**Should have (high-value additions):**
- DF-2: Liquidity depth verification before buying — directly prevents buying tokens that cannot be sold
- DF-5: P&L analytics improvements (equity curve, win/loss ratio, per-source breakdown) — read-only, zero pipeline risk, essential for config tuning
- DF-8: Dashboard operational controls (pause/resume detection, force-sell) — critical incident response tools
- DF-6: Live safety pipeline visibility in dashboard — makes threshold tuning possible with real data

**Defer to v1.2+:**
- DF-1: Holder cluster analysis (high complexity, needs careful latency management)
- DF-4: Adaptive sell timing with momentum awareness (high complexity, needs real data to validate)
- DF-7: Dynamic Jito tip amounts (static tips work adequately)
- DF-3: Token age signal (low impact — most tokens evaluated at creation time anyway)
- DF-9: Transaction simulation before broadcast (useful only for late sell ladder steps; conflicts with speed-first buy philosophy)
- TS-9: RPC health tracking with latency metrics (current multi-RPC broadcast provides implicit failover)

**Anti-features (never build):** Social media sentiment analysis, AI/ML scoring, multi-wallet rotation, copy trading, gRPC/Yellowstone migration, backtesting engine, Telegram interface, Astralane/Lil-JIT MEV alternatives.

### Architecture Approach

The v1.0 single-process reactive pipeline (Detection -> Safety -> Execution -> Position Manager -> Sell Ladder) is the correct architecture and requires no structural changes in v1.1. All improvements are either surgical modifications to existing modules or additions that follow established patterns. The most architecturally significant change is adding a dashboard-to-trading write path for operational controls — currently the dashboard is read-only. This requires careful design to avoid race conditions with the bot's autonomous state machine. See `.planning/research/ARCHITECTURE.md` for full integration analysis.

**Modules modified (surgical changes):**
1. `src/safety/checks/tier3-creator.ts` — Helius API key header migration
2. `src/config/trading.ts` + `src/dashboard/routes/config.ts` — full-schema config validation after merge
3. `src/execution/broadcaster.ts` — integrate priority fee estimator
4. `src/position/position-manager.ts` — adaptive poll intervals, forceSell method
5. `src/detection/detection-manager.ts` — pause/resume methods, stats getters
6. `src/core/rpc-manager.ts` — latency tracking, smarter recovery
7. `src/dashboard/bot-event-bus.ts` — new event types (SAFETY_*, SYSTEM_*, SELL_STEP_*)
8. `src/index.ts` — bridge component events to BotEventBus

**New components (additive):**
1. `src/execution/priority-fee-estimator.ts` — dynamic fee from Helius getPriorityFeeEstimate
2. `src/dashboard/routes/analytics.ts` — time-series P&L, safety stats, detection stats
3. `src/dashboard/routes/controls.ts` — pause/resume, force-sell, emergency stop
4. `src/dashboard/routes/health.ts` — structured health check endpoint
5. `dashboard/src/components/Analytics.tsx` — analytics dashboard view
6. `dashboard/src/components/PipelineView.tsx` — real-time safety pipeline visualization
7. `dashboard/src/components/Controls.tsx` — operational controls UI
8. `dashboard/src/components/SystemStatus.tsx` — RPC health, rate limits, alerts

### Critical Pitfalls

Full analysis with prevention strategies in `.planning/research/PITFALLS.md`. Top 5:

1. **Safety scoring recalibration causes cascade** — Adjusting weights or adding checks near the decision threshold can flip pass/fail decisions for 20-30% of tokens. Prevention: run any scoring change in dry-run mode for 24-48 hours first; change only one parameter at a time; initialize new check weights at 0 before enabling.

2. **Dashboard write paths race with the state machine** — Operational controls (force-sell, pause/resume) can create split-brain if they bypass TradeStore's state machine or fire while SellLadder is already active for the same mint. Prevention: all writes go through TradeStore methods; force-sell uses SellLadder, not direct RPC; check `sellsInFlight` before any force action.

3. **Dependency update breaks ESM/CJS interop** — Never run `npm audit fix --force`. The `bigint-buffer` HIGH finding has no patched version. `picomatch` findings are dev-only and zero runtime risk. `fastify` 5.8.3 and `@fastify/static` are safe point bumps. After any dep change, manually verify `createRequire()` resolution and `unpackMint()` for both token programs.

4. **RPC failover hardening creates split-brain in sell execution** — Failover should not swap `Connection` objects mid-sell-ladder. Prevention: make failover decisions only at operation start, never mid-ladder.

5. **Write-ahead pattern broken by execution optimization** — The ordering `createBuyingRecord()` (synchronous) then `executionEngine.buy()` (async fire-and-forget) is both the duplicate guard and crash recovery guarantee. Never parallelize or reorder these. Speed optimizations belong in the execution path after the write-ahead record.

## Implications for Roadmap

Based on the dependency graph in ARCHITECTURE.md and risk analysis from PITFALLS.md, the research strongly suggests a 5-phase structure. This ordering is not arbitrary — each phase is a prerequisite for the next, and the architecture file's build order rationale validates this sequence from direct codebase dependency analysis.

### Phase 1: Security Fixes

**Rationale:** Known vulnerabilities must be fixed before adding new attack surface. All four BUGS.md findings are surgical and standalone — they have no upstream dependencies and unblock downstream work (the Helius API key fix is required before Phase 2 can confidently run the tier3-creator check). Highest urgency, lowest risk.
**Delivers:** A bot with no known security holes; dependency vulnerability audit complete.
**Addresses:** TS-1 (SQL injection audit), TS-2 (API key migration), TS-3 (config validation), TS-4 (dep vulns)
**Avoids:** Pitfall 1 (hot path latency — verify SQL finding is a false positive before refactoring), Pitfall 2 (dep update breakage — update one at a time, never --force), Pitfall 12 (don't fix what isn't broken)

### Phase 2: Safety Pipeline Audit & Enhancement

**Rationale:** Safety accuracy directly determines profitability. Improving filtering before execution optimization means fewer wasted buy attempts. Phase 1's Helius API key fix must land first (it touches tier3-creator.ts). This phase also introduces the BotEventBus event extension pattern (SAFETY_* events) that later phases follow.
**Delivers:** Calibrated safety checks with validated thresholds; optional new checks (LP lock, metadata mutability) if gaps are found; safety pipeline emitting structured events.
**Addresses:** TS-7 (partial — safety-side health signals), DF-2 (liquidity depth check)
**Avoids:** Pitfall 3 (scoring cascade — dry-run first, one change at a time, new checks start at weight=0), Pitfall 7 (source bias — test all checks against both PumpPortal and Raydium tokens)

### Phase 3: Execution Performance

**Rationale:** Priority fee and compute unit optimization land on top of Phase 2's better filtering. Sell ladder observability establishes the event emission pattern for Phase 4.
**Delivers:** Dynamic priority fees (Helius getPriorityFeeEstimate), compute unit optimization (ComputeBudgetProgram), sell ladder per-step events, adaptive position polling, SOL balance guard.
**Addresses:** TS-5 (SOL balance guard), TS-6 (dynamic priority fees), TS-8 (compute unit optimization)
**Avoids:** Pitfall 1 (latency regression — priority fee estimator must use cached data, <50ms; profile before/after), Pitfall 8 (sandwich attack — add jitter to sell timing), Pitfall 11 (write-ahead pattern — optimize only after the record, not the orchestration)

### Phase 4: Reliability & Infrastructure Monitoring

**Rationale:** Infrastructure improvements should be stable before the dashboard exposes them. RPC health tracking, component-event-to-BotEventBus bridging, and the health endpoint are foundations for Phase 5's dashboard views. This phase completes the silent failure detection story started in Phase 2.
**Delivers:** RPC health module with latency tracking; component events bridged to BotEventBus (SYSTEM_ALERT, SYSTEM_RECOVERY); /api/health endpoint; recovery manager audit logging.
**Addresses:** TS-7 (complete — infrastructure health monitoring), TS-9 (partial RPC health tracking)
**Avoids:** Pitfall 4 (RPC split-brain — don't swap connections mid-sell-ladder), Pitfall 9 (alert noise — limit to 5-7 critical alert types), Pitfall 14 (infinite retry loops — bounded retries, not "retry the whole ladder")

### Phase 5: Dashboard Overhaul

**Rationale:** The dashboard is a consumer of everything built in Phases 2-4: new SSE event types, new control methods on DetectionManager and PositionManager, new analytics query interfaces on TradeStore, new API endpoints. Building it last means building it once rather than reworking it as each feature lands.
**Delivers:** Analytics view (equity curve, win/loss ratio, per-source performance), live pipeline visibility view, operational controls panel (pause/resume/force-sell), system status display (RPC health, rate limit indicators, alerts).
**Addresses:** DF-5 (P&L analytics), DF-6 (pipeline visibility), DF-8 (operational controls), TS-7 (dashboard surface for health warnings)
**Avoids:** Pitfall 5 (accidental write paths — all writes through TradeStore methods, never raw SQL backdoor), Pitfall 13 (analytics query blocking — pre-compute aggregations, add indexes, use LIMIT on all queries)

### Phase Ordering Rationale

- **Security before safety:** API key fix touches tier3-creator.ts which the safety phase also modifies; clean separation prevents merge conflicts.
- **Safety before execution:** Better filtering reduces wasted buy attempts; execution optimization on top of bad safety filtering amplifies losses, not gains.
- **Execution before reliability:** Sell ladder events (Phase 3) are bridged to BotEventBus in Phase 4's wiring pass — doing this in one pass is cleaner than two separate wiring passes.
- **Reliability before dashboard:** Dashboard should expose stable, real metrics. The /api/health and analytics endpoints require Phase 4's monitoring data.
- **Dashboard last:** Consumes all previous phases' event types, API routes, and control methods. Any other order means rework.

### Research Flags

Phases needing deeper research during planning:
- **Phase 2 (Safety Pipeline):** Safety weight calibration is empirical — requires analysis of recent dry-run or live trade data to determine whether current thresholds are producing false positives or false negatives. Cannot be derived from code analysis alone.
- **Phase 5 (Dashboard Controls):** The operational controls write path is architecturally new for this codebase. The force-sell implementation in particular needs a careful plan to avoid the race conditions documented in Pitfall 5.

Phases with standard patterns (skip research-phase):
- **Phase 1 (Security Fixes):** Surgical changes with direct mapping to BUGS.md findings; no research needed.
- **Phase 3 (Execution Performance):** Dynamic priority fee integration is well-documented in Helius and Solana docs; existing broadcaster.ts structure makes the integration path obvious.
- **Phase 4 (Reliability):** Additive event bridging and health endpoints; established patterns from existing RpcManager and BotEventBus.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Only 4 new packages, all from Fastify ecosystem with verified version compatibility. All other improvements use existing capabilities. Alternatives analysis is thorough. |
| Features | HIGH | Based on direct v1.0 codebase analysis + academic rug detection research (100K+ token dataset) + production bot comparisons. Feature prioritization is opinionated and well-justified. |
| Architecture | HIGH | All integration points verified against actual source files. Dependency graph derived from code imports, not assumptions. Build order validated by Pitfalls analysis. |
| Pitfalls | HIGH | Majority derived from direct codebase analysis with specific file/line citations, not generic Solana advice. The 3 critical pitfalls all have concrete prevention strategies. |

**Overall confidence:** HIGH

### Gaps to Address

- **Safety threshold calibration:** The research identifies what needs calibrating (weights, pass threshold, new check weights) but cannot determine the correct values without trade data analysis. Phase 2 planning should start with a dry-run data collection sprint before changing any thresholds.
- **spl-token 0.5.x upgrade feasibility:** The `bigint-buffer` HIGH vulnerability in @solana/spl-token has no patch for the current version. The research recommends investigating spl-token 0.5.x as a fix path but notes it may have API changes. This needs a targeted investigation during Phase 1 execution — verify `unpackMint()`, `getAccount()`, and `getMint()` API shapes before committing.
- **Force-sell race condition design:** The controls write path is identified as architecturally new and risky (Pitfall 5), but the specific protocol for checking `sellsInFlight` and coordinating with an in-progress SellLadder needs to be designed during Phase 5 planning, not assumed.

## Sources

### Primary (HIGH confidence)
- Direct codebase analysis — all source files in `src/` and `dashboard/src/` (v1.0, 16 phases, 243 commits)
- BUGS.md security audit findings — 4 validated findings with file:line citations
- `pnpm audit` output (2026-03-27) — exact vulnerability list with severity
- [SolRugDetector: Investigating Rug Pulls on Solana](https://arxiv.org/html/2603.24625) — rug pull patterns, 100K+ token dataset
- [SolRPDS: A Dataset for Analyzing Rug Pulls in Solana DeFi](https://arxiv.org/pdf/2504.07132) — academic dataset
- [Helius Priority Fee API](https://www.helius.dev/blog/priority-fees-understanding-solanas-transaction-fee-mechanics) — getPriorityFeeEstimate, ComputeBudget usage
- [Helius Authentication Docs](https://www.helius.dev/docs/api-reference/authentication) — header-based API key auth
- [Chainstack Priority Fee Estimation](https://docs.chainstack.com/docs/solana-estimate-priority-fees-getrecentprioritizationfees) — fee percentile methodology
- [Solidus Labs: Solana Rug Pulls & Pump-and-Dumps](https://www.soliduslabs.com/reports/solana-rug-pulls-pump-dumps-crypto-compliance) — institutional compliance research

### Secondary (MEDIUM confidence)
- [Building Production-Grade Solana Sniper Bots (Dysnix)](https://dysnix.com/blog/complete-stack-competitive-solana-sniper-bots) — 2026 competitive patterns, vendor content
- [MEV Protection on Solana in 2026 (DEV.to)](https://dev.to/gerus_team/mev-protection-on-solana-in-2026-jito-bundles-astralane-and-what-actually-works-3gbc) — Jito vs alternatives
- [Low-latency Solana Playbook (RPCFast)](https://rpcfast.com/blog/low-latency-solana-playbook-hft-traders) — performance patterns

### Tertiary (LOW confidence)
- [Solana Security Guide 2026 (CoinTrenches)](https://cointrenches.io/solana-security-guide-2026/) — general security advice, not bot-specific

---
*Research completed: 2026-03-27*
*Ready for roadmap: yes*
