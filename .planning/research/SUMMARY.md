# Project Research Summary

**Project:** SolSniper - Solana Token Sniper Bot
**Domain:** Automated Solana memecoin trading (Pump.fun + Raydium detection, first-block execution)
**Researched:** 2026-02-20
**Confidence:** HIGH (primary source is a comprehensive internal research document dated 2026-02-19; cross-validated with existing codebase analysis and domain expertise)

## Executive Summary

SolSniper is a personal, single-operator Solana sniper bot targeting the gap between unreliable open-source self-hosted bots and expensive institutional-grade infrastructure. The recommended approach is a TypeScript/Node.js single-process application organized as a reactive event-driven pipeline: Detection -> Safety -> Execution -> Position Management, coupled by an in-process EventEmitter bus with SQLite as the single source of truth for all trade state. This architecture is the de facto standard across the open-source Solana bot ecosystem and is appropriate for the single-wallet, personal-tool constraints.

The recommended tech stack is intentionally conservative: `@solana/web3.js` v1.x (not the newer v2 kit) for maximum community coverage, Jupiter REST API directly (no SDK wrapper), PumpPortal WebSocket for detection, Jito block engine for MEV-protected sell execution, `better-sqlite3` for synchronous persistence, and `pino` for structured logging. Node.js 22 LTS with TypeScript 5.7 provides the runtime foundation. The critical infrastructure cost is a Helius Developer RPC plan ($49/mo) from day one; everything else is free or fee-per-trade.

The most important risk in this domain is counterintuitive: sell reliability, not detection speed, is the primary determinant of profitability. Sells on low-liquidity memecoin tokens fail at 3-5x the rate of buys, and every failed sell attempt burns priority fees while the position loses value. The research is unambiguous: the 7-level sell escalation ladder (standard swap -> aggressive slippage -> Jito bundle -> chunked sell -> emergency exit) must be built in Phase 1 alongside the buy flow, not deferred to Phase 2. Additionally, WebSocket connections to PumpPortal and Solana RPC drop silently and frequently; a `ResilientWebSocket` wrapper with heartbeat and exponential backoff reconnection is a foundation-level component, not an optimization.

## Key Findings

### Recommended Stack

The stack prioritizes developer velocity and community support over theoretical performance. TypeScript with `@solana/web3.js` v1.x is the right choice because the network I/O bottleneck (RPC latency, WebSocket latency) vastly outweighs any CPU savings from Rust. External APIs (Jupiter, PumpPortal, Jito) are called directly via REST/WebSocket with thin custom wrappers rather than through official SDKs — this provides immediate access to new API features without waiting for SDK updates and eliminates unnecessary dependency management overhead. The dashboard is Phase 2+ and should not influence Phase 1 architecture decisions.

**Core technologies:**
- **Node.js 22 LTS + TypeScript ^5.7**: Runtime — native `fetch`, strict mode, excellent Solana ecosystem typing
- **`@solana/web3.js` ^1.98**: Solana SDK — maximum community coverage; v2 kit deferred until ecosystem catches up
- **Jupiter REST API (v1 endpoints)**: Swap execution and sell simulation — best route aggregation, dynamic slippage, no SDK lag
- **PumpPortal WebSocket + trade-local API**: Token detection and bonding curve trades — free detection, 0.5% fee acceptable for v1
- **Jito Block Engine REST API (custom ~30-line wrapper)**: MEV-protected sell bundles — ~95% validator coverage, atomic execution
- **`better-sqlite3` ^11.0**: Trade persistence — synchronous API correct for single-process, fastest Node.js SQLite binding
- **`pino` ^9.0**: Structured logging — 5-10x faster than winston, JSON-native, essential for debugging a high-frequency system
- **`eventemitter3` ^5.0**: Typed internal event bus — decouples pipeline subsystems without message queue complexity
- **`zod` ^3.24**: Runtime validation — validate all API responses, WebSocket messages, and config at boundaries
- **`ws` ^8.18**: WebSocket client — for PumpPortal data stream and Solana RPC subscriptions
- **Helius Developer RPC ($49/mo)**: Primary RPC — staked connections, parsed APIs, Solana-native
- **QuickNode Starter ($49/mo, Phase 2)**: Backup RPC — independent infrastructure for true failover

**Deferred technologies:**
- **Next.js 15 + React 19 + Tailwind CSS 4**: Web dashboard — Phase 2+ only; use logs + SQLite queries for monitoring in Phase 1
- **Direct Pump.fun program calls**: Phase 4+ — eliminates 0.5% PumpPortal fee but very high complexity
- **Geyser gRPC**: Phase 4+ — sub-50ms detection but requires $300-1000+/mo infrastructure

See `.planning/research/STACK.md` for full version list, alternatives considered, and installation commands.

### Expected Features

The MVP is a complete trading pipeline from detection through position management with crash recovery. The dashboard is Phase 2+. Sell reliability (escalation ladder, Jito bundles) is classified as table stakes — not a differentiator — because without it the bot cannot profitably exit positions.

**Must have (table stakes — all required for Phase 1):**
- PumpPortal WebSocket token detection + Raydium logsSubscribe secondary detection
- Tier 1 parallel safety pipeline (<300ms): mint authority + freeze authority + sell simulation
- Jupiter + PumpPortal hybrid buy execution with dynamic slippage
- Full sell escalation ladder (3-7 levels escalating through Jito bundles)
- Auto stop-loss and take-profit (prevent catastrophic losses while sleeping)
- SQLite trade journal with state machine and crash recovery on restart
- Duplicate buy prevention via idempotency keys (crash-and-restart causes double buys)
- Resilient WebSocket wrapper with heartbeat (bot goes blind within minutes without this)
- Multi-RPC transaction broadcast (single RPC is the most common failure point)
- Structured JSON logging with pino (cannot debug a high-frequency system without this)

**Should have (competitive differentiators — Phase 2):**
- Jito bundle support hardened across all sell levels (initial integration in Phase 1, full hardening Phase 2)
- Dynamic slippage via Jupiter `dynamicSlippage` parameter (low effort, high impact on success rate)
- Tiered take-profit (sell 33% at 2x, 33% at 5x, rest at 10x — superior to all-or-nothing exits)
- Trailing stop-loss (captures more upside than fixed take-profit)
- RugCheck.xyz API integration (Tier 2 safety scoring, non-blocking)
- Holder concentration analysis (`getTokenLargestAccounts`, run async)
- Web dashboard: live trade feed, accurate net P&L (after all fees), wallet management

**Defer (v2+):**
- Direct Pump.fun program calls (bypasses 0.5% fee, very high IDL complexity)
- Geyser gRPC detection (sub-50ms latency, expensive infrastructure requirement)
- Creator wallet history analysis (high latency, high complexity, moderate signal value)
- Dashboard hot-reload config (nice to have, not urgent)
- Congestion-aware priority fee adaptation (static tiers first)

**Anti-features to explicitly avoid:**
- Social presence filtering (Twitter/Telegram) — adds 2-10 seconds, incompatible with first-block goal
- Backtesting — survivorship-biased and misleading; use simulation mode on mainnet instead
- Multi-user/auth system — out of scope, transforms a focused tool into a SaaS platform
- AI/ML token scoring — unreliable for memecoin timeframes; rule-based scoring is more interpretable and debuggable
- Copy trading (follow-wallet sniping) — by the time you detect and execute, price has already moved

See `.planning/research/FEATURES.md` for full feature dependency graph, critical path, and competitor feature matrix.

### Architecture Approach

The architecture is a single Node.js process with five subsystems connected by a typed EventEmitter bus. SQLite (WAL mode, synchronous `better-sqlite3` API) serves as the single source of truth. Every state transition is written to the database before the corresponding action executes (write-ahead persistence pattern), enabling deterministic crash recovery without distributed coordination. The dashboard runs as an in-process HTTP server — not a separate service — to eliminate IPC and deployment complexity.

The six critical architectural patterns to implement:
1. **State machine per trade** — explicit, validated state transitions persisted before each action executes; prevents duplicate actions and enables crash recovery
2. **Parallel safety checks via `Promise.all`** — Tier 1 blocking, Tier 2 non-blocking with timeout; serial execution is 500-1200ms, parallel is 200-300ms
3. **Write-ahead state persistence** — persist intent to SQLite before sending transaction; on crash in critical section, restart can resolve state from known record
4. **Sell escalation as strategy pattern** — each escalation level is an independent strategy object; executor iterates until success or exhaustion
5. **Resilient WebSocket wrapper** — heartbeat pings every 15-30 seconds, `lastMessageReceivedAt` staleness detection, exponential backoff reconnection
6. **Dashboard as read-only observer** — subscribes to EventBus for live data, queries SQLite for history; never participates in trading logic

**Major components and responsibilities:**
1. **Detection** — WebSocket listeners (PumpPortal + Solana RPC `logsSubscribe`); owns reconnection state; emits `token:detected`
2. **Safety** — parallel check runner with tiered scoring; hard block on Tier 1 failure (mint/freeze/sell-sim); async scoring from Tier 2 (RugCheck/holders); emits `token:approved` or `token:rejected`
3. **Execution** — transaction builder, signer, multi-RPC sender, retry escalation ladder, Jito bundle constructor; emits `position:opened`, `position:closed`
4. **Position Management** — polls prices, evaluates SL/TP/trailing/time-based exits, triggers sells; owns in-memory position map backed by SQLite
5. **Operations** — RPC manager with failover, SQLite trade journal, pino logger, crash recovery on startup, config management; cross-cutting service used by all components
6. **Dashboard** — in-process Express/Fastify HTTP server with SSE live feed and REST API; read-only observer subscribing to EventBus

**Component build order (dependency-driven):**
- Layer 0: Config, Logger, Types, Constants (build first — everything depends on these)
- Layer 1: RPC Manager, Trade Journal (SQLite), Resilient WebSocket wrapper
- Layer 2: Detection, Safety Checker, Jupiter Client, PumpPortal Client (independent business logic)
- Layer 3: Execution/SwapExecutor, Position Monitor (orchestrate Layer 2 components)
- Layer 4: Main pipeline integration, Jito Bundle Builder
- Layer 5: Dashboard HTTP Server + Frontend (build last — purely observational)

See `.planning/research/ARCHITECTURE.md` for full component diagram, SQLite schema, data flow, scalability analysis, and anti-patterns.

### Critical Pitfalls

Research identified 18 pitfalls across critical, moderate, and minor categories. Six are architecture-defining and cannot be deferred:

1. **Sells fail at 3-5x the rate of buys** — The most important finding. Build the full sell escalation ladder (7 levels through Jito emergency bundle) in Phase 1 alongside buy flow. Test sells with known low-liquidity tokens in simulation. Track sell success rate as a first-class operational metric. Alert operator if success rate drops below 80%.

2. **WebSocket connections die silently** — PumpPortal and Solana RPC WebSockets drop every 5-30 minutes without emitting error or close events. Build `ResilientWebSocket` with heartbeat pings every 15-30 seconds and `lastMessageReceivedAt` staleness detection as the first component. Log every reconnection event with a counter; alert if >10 reconnections in 5 minutes.

3. **Stale blockhash causes systematic transaction failures** — Blockhashes expire after ~60 slots (~60 seconds). Fetch blockhash as the absolute last step before `tx.sign()`, after all safety checks and transaction construction. Refresh blockhash on every retry attempt. Cache TTL maximum: 2 seconds.

4. **No idempotency causes double buys after crash-restart** — Write a `PENDING` entry to SQLite before sending any buy transaction. Maintain an in-memory `Set<mint>` of active buy intents. On restart, reconcile `PENDING` entries against on-chain wallet token accounts before resuming trading.

5. **Sequential safety checks miss entry windows** — Each RPC call is 50-300ms. Running 4 checks serially = 200-1200ms. Parallel via `Promise.all` = 200-300ms. This is the difference between first-block and second-block entry. Use `Promise.all()` from the very first implementation. Target: safety checks complete in under 300ms.

6. **Hardcoded slippage causes either failed trades or massive losses** — Use Jupiter `dynamicSlippage: true` as the default. Define slippage as a function of token state (bonding curve vs migrated) and retry attempt number, not a constant. Emergency sell slippage: 49% (capital recovery over loss prevention).

See `.planning/research/PITFALLS.md` for the full 18-pitfall catalog with detection warning signs and phase-specific warnings.

## Implications for Roadmap

The architecture component dependency graph defines a clear 4-phase build order. The critical insight from PITFALLS.md — that the "build buy first, sell later" instinct is the most common structural mistake in this domain — overrides the natural development sequence. Phase 1 must include both buy AND sell reliability.

### Phase 1: Core Trading Pipeline

**Rationale:** Every subsequent phase depends on a working, reliable trading pipeline. Detection, safety, execution, and position management form a chain where no link can be skipped. The bot must work headlessly before any UI work begins. Simulation mode (full pipeline with `simulateTransaction` instead of `sendRawTransaction`) is the graduation gate before real capital is at risk.

**Delivers:** A fully functional bot that detects tokens on Pump.fun and Raydium, filters via parallel safety pipeline, executes buys and sells with escalation retry, manages positions (stop-loss, take-profit), persists all state to SQLite with crash recovery on restart, and reconnects WebSockets automatically. Runs on mainnet in simulation mode first, then tiny-wallet real trading.

**Addresses (from FEATURES.md):**
- PumpPortal WebSocket detection + Raydium `logsSubscribe` secondary
- Tier 1 parallel safety pipeline: mint authority + freeze authority + sell simulation
- Jupiter + PumpPortal hybrid buy execution with dynamic slippage and `maxAccounts: 64`
- Sell escalation ladder (3-7 levels, initial Jito integration as escalation level)
- Auto stop-loss and take-profit
- SQLite trade journal with full state machine and crash recovery
- Idempotency (write-ahead PENDING before send; in-memory Set check before buy)
- Resilient WebSocket wrapper with heartbeat
- Multi-RPC broadcast for all transaction sends (Helius primary; even free-tier backup from day one)
- Structured pino logging with trade ID threading all log entries from detection to completion

**Avoids (from PITFALLS.md):**
- Pitfall 1 (sell reliability) — escalation ladder built alongside buy flow, not deferred
- Pitfall 2 (silent WebSocket death) — resilient wrapper is Layer 1 foundation
- Pitfall 3 (stale blockhash) — fetch last, refresh on every retry
- Pitfall 4 (double buys) — write-ahead PENDING + in-memory Set
- Pitfall 5 (sequential safety) — `Promise.all` from first implementation
- Pitfall 6 (hardcoded slippage) — dynamic slippage as default, function not constant
- Pitfall 15 (devnet testing) — simulation mode on mainnet, never devnet
- Pitfall 18 (wallet key compromise) — `.gitignore` before first commit, no-log policy, hot wallet limit

**Research flag:** Standard, well-documented patterns. No additional phase research needed. Implementation can begin immediately from ARCHITECTURE.md's build order.

---

### Phase 2: Sell Reliability, Robustness, and Dashboard

**Rationale:** After Phase 1 validates the core pipeline with tiny-wallet real trades, Phase 2 hardens the infrastructure that determines long-term profitability. Jito full integration, multi-RPC failover, advanced position management strategies, and the web dashboard for operational visibility are all Phase 2 concerns. The dashboard is placed here (not Phase 3) because operational visibility becomes important once real capital is at risk.

**Delivers:** Production-grade bot with full Jito MEV protection across all sell levels, QuickNode as backup RPC, tiered take-profit and trailing stop, RugCheck integration, holder concentration analysis, and a web dashboard with live trade feed and accurate net P&L (after all fees, computed from on-chain confirmed data). PM2 for process management and auto-restart.

**Addresses (from FEATURES.md differentiators):**
- Jito bundle support hardened for all sell escalation levels
- QuickNode backup RPC (multi-RPC failover fully operational)
- Tiered take-profit (multi-level exits with per-level percentage configuration)
- Trailing stop-loss (high-water-mark tracking per position)
- Time-based auto-exit (max hold duration)
- RugCheck.xyz API integration (Tier 2 non-blocking scorer)
- Holder concentration check (`getTokenLargestAccounts`, run async)
- Web dashboard: live trade feed via SSE, net P&L (gross minus all costs), wallet management
- Telegram/Discord alerts for critical events (stuck position, daily loss exceeded, bot crashed)

**Avoids (from PITFALLS.md):**
- Pitfall 7 (polling at scale) — cap `MAX_CONCURRENT_POSITIONS`, use `Promise.all` within each poll cycle
- Pitfall 8 (RPC rate limits) — cache mint/freeze authority (1-hour TTL), batch reads via `getMultipleAccounts`
- Pitfall 9 (priority fees burned on failures) — `simulateTransaction` before aggressive-fee sends
- Pitfall 11 (memory leaks from WebSocket listeners) — subscription registry; cleanup on position close
- Pitfall 12 (inflated P&L from quotes) — compute P&L from `getTransaction(sig)` confirmed on-chain data

**Research flags:**
- Jito bundle API: validate current tip account selection, bundle status polling behavior, and competitive tip amounts against current Jito Block Engine docs
- RugCheck.xyz API: validate free tier rate limits and response field names against current Swagger/OpenAPI spec before integration

---

### Phase 3: Advanced Safety and Optimization

**Rationale:** With a profitable, stable bot in Phase 2, Phase 3 adds deeper safety intelligence and execution optimizations that improve win rate. These are deferred because they require either high implementation complexity (creator history), external service dependencies (Helius parsed TX API), or expensive infrastructure (Geyser).

**Delivers:** Creator wallet history analysis via Helius parsed transaction API (Tier 3 safety, run async), LP burn/lock verification, metadata mutability checks, and dashboard filter configuration (hot-reload config without bot restart).

**Addresses (from FEATURES.md):**
- Creator wallet history analysis (Tier 3 async scorer)
- LP burn/lock verification
- Metadata mutability check (`isMutable` flag on Metaplex metadata account)
- Dashboard filter config (PUT /api/config with validation and hot-reload)
- Event-driven position monitoring replacing polling (eliminates the scaling ceiling)

**Research flags:**
- Creator wallet history via Helius parsed TX API: validate endpoint, rate limits, and response format — this is the primary unknown in Phase 3
- Event-driven monitoring via `connection.onAccountChange()`: validate behavior at scale vs polling

---

### Phase 4: Execution Optimization (Conditional)

**Rationale:** Only pursue Phase 4 after demonstrating consistent profitability across Phase 2-3. These optimizations reduce costs and latency at the margin but add significant complexity and infrastructure cost. The investment is only justified when the base strategy is proven.

**Delivers:** Direct Pump.fun program calls (eliminates 0.5% PumpPortal fee per trade), Geyser gRPC detection (sub-50ms latency replacing 100-300ms WebSocket), congestion-aware priority fee adaptation. Conditional on demonstrated profitability from prior phases.

**Addresses (from FEATURES.md defer list):**
- Direct Pump.fun IDL-level program calls with manual account discovery
- Geyser gRPC subscription to program account changes
- Congestion-aware priority fee adaptation based on recent block success rates

**Research flags:**
- Direct Pump.fun program calls: requires IDL parsing research not covered in current research documents — definitely needs `/gsd:research-phase`
- Geyser gRPC: validate Helius vs Triton One offering, API connection setup, and current pricing before committing to infrastructure

---

### Phase Ordering Rationale

- **Detection before safety:** Cannot build safety checks without real token events to test against
- **Safety before execution:** Buying without working safety checks risks immediate honeypot losses
- **Buy and sell built together (not buy then sell):** The single most important deviation from "natural" development order. Sell reliability is the primary profit driver, not an afterthought.
- **Simulation before real trading:** Mainnet simulation validates the real Jupiter/PumpPortal/Jito pipeline. Devnet is useless for this domain (no real DEXs, no liquidity, no competition).
- **Dashboard after core pipeline proven:** Building UI before the pipeline is validated is a common premature-optimization trap explicitly identified in both ARCHITECTURE.md and PITFALLS.md.
- **Dashboard placed in Phase 2 (not Phase 3):** Moved earlier than the default "build last" recommendation because operational visibility becomes critical once real capital is at risk with tiny-wallet real trading.
- **Advanced optimizations (Phase 4) conditional on profitability:** Geyser gRPC costs $300-1000+/mo. Direct program calls require weeks of work. Only justified after proving the base strategy is profitable.

### Research Flags

Phases needing `/gsd:research-phase` during planning:
- **Phase 2:** Jito bundle API — validate current tip account selection, bundle status polling, and competitive tip amounts
- **Phase 2:** RugCheck.xyz API — validate free tier rate limits and response schema
- **Phase 3:** Helius parsed transaction API for creator history — validate endpoint, rate limits, response format
- **Phase 4:** Direct Pump.fun program calls (IDL, account discovery) — high complexity, sparse documentation, requires dedicated research
- **Phase 4:** Geyser gRPC providers — validate Helius vs Triton One offering, cost, connection setup

Phases with standard patterns (skip research-phase):
- **Phase 1:** All components have well-documented patterns from open-source Solana bots, Jupiter REST docs, and the project's own comprehensive research document. Architecture is fully specified in ARCHITECTURE.md. Implementation can begin immediately.
- **Phase 2 (dashboard):** SSE over in-process Express/Fastify is standard Node.js pattern. No research needed.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | MEDIUM | Technology choices are HIGH confidence (well-justified with rationale). Exact npm version numbers are MEDIUM — not verified against live registry (WebFetch unavailable). Use `^` semver ranges; run `npm info <pkg> version` before first install. |
| Features | HIGH | Based on project's comprehensive internal research document (2026-02-19), existing codebase analysis, competitor analysis, and domain expertise. Feature dependency graph and critical path are well-validated. |
| Architecture | HIGH | Event-driven pipeline with state machine per trade is the proven pattern for this domain, validated against multiple open-source implementations and the project's own research document. |
| Pitfalls | HIGH | 18 pitfalls identified across critical/moderate/minor categories. Based on known failure patterns from open-source bots, Solana transaction model fundamentals, and 32 catalogued concerns from existing codebase analysis. |

**Overall confidence:** HIGH

### Gaps to Address

- **Exact npm package versions:** Cannot verify against live registry. Use `^` semver ranges and validate with `npm info <package> version` before pinning. Most at-risk for version drift: `typescript`, `vitest`, `tsx`, `pino-pretty`.

- **Pump.fun/PumpSwap migration status:** Pump.fun launched PumpSwap (their own AMM) in early 2026. The research doc references traditional Raydium migration, but the PumpSwap transition may affect detection and routing logic. Validate current token migration destination (Raydium vs PumpSwap) at Phase 1 implementation time — this could change the routing layer design.

- **Jito bundle tip economics:** Research doc quotes tip ranges (10k-100k lamports) but competitive tip amounts fluctuate with network conditions. Validate current competitive amounts against Jito documentation or community resources during Phase 2 Jito integration.

- **PumpPortal WebSocket message schema:** The `subscribeNewToken` and `subscribeMigration` event field names should be validated against current PumpPortal docs at Phase 1 implementation. PumpPortal is a newer service and schema details may have evolved.

- **Dashboard architecture tension:** STACK.md recommends Next.js for the dashboard; ARCHITECTURE.md recommends in-process Express/Fastify with SSE. Resolution: use Express/Fastify within the bot process for API and SSE, with a lightweight frontend (Preact or vanilla JS) served as static files. This avoids running a separate Next.js server. Full Next.js deployment is only justified if the dashboard grows complex enough to warrant it.

- **`@solana/web3.js` v1 deprecation timeline:** The v2 rewrite (`@solana/kit`) exists and is architecturally superior. Monitor for formal v1 deprecation announcements. Migration can happen later when the ecosystem catches up, but should not be triggered mid-project.

## Sources

### Primary (HIGH confidence)
- `solana-sniper-bot-research.md` (project internal research document, 2026-02-19) — comprehensive domain research: architecture patterns, competitor analysis, API integrations, failure modes, stack recommendation
- `.planning/codebase/ARCHITECTURE.md` — existing codebase architecture analysis
- `.planning/codebase/INTEGRATIONS.md` — external API integration details (PumpPortal, Jupiter, Jito, RugCheck)
- `.planning/codebase/CONCERNS.md` — 32 forward-looking risks catalogued
- `.planning/codebase/STRUCTURE.md` — planned directory layout and module organization
- `.planning/PROJECT.md` — project requirements and single-operator constraints

### Secondary (MEDIUM confidence)
- Open-source reference bots: `fdundjer/solana-sniper-bot`, `tjazerzen/sol-sniper-bot` — architecture patterns and failure modes (cited in primary research doc)
- Claude training data on Solana DeFi ecosystem, Jupiter API v1 endpoints, Jito Block Engine, PumpPortal APIs, Helius RPC — cross-referenced against primary source; knowledge cutoff August 2025

### Tertiary (LOW confidence — validate during implementation)
- npm package version numbers — not verified against live registry (WebFetch unavailable during research)
- Jito bundle API specifics (tip amounts, endpoint URLs) — may have changed since training data cutoff
- PumpPortal WebSocket event schema details — newer service, schema may have evolved post-August 2025
- PumpSwap AMM behavior — launched after training data cutoff; research doc may not reflect current state

---
*Research completed: 2026-02-20*
*Ready for roadmap: yes*
