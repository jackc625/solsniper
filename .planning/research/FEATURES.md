# Feature Landscape: v1.1 Hardening & Polish

**Domain:** Solana Token Sniper Bot -- Hardening an operational v1.0 MVP
**Researched:** 2026-03-27
**Overall Confidence:** HIGH (based on v1.0 codebase analysis, 2026 ecosystem research, academic rug detection research, and production bot comparisons)

This document maps the hardening features for a shipped Solana sniper bot. The baseline is a fully functional v1.0 with detection, safety, execution, position management, persistence, dashboard, and dry-run mode. The question is: what makes the bot production-grade vs what remains v1.0-adequate.

---

## Table Stakes

Features that are expected at this maturity level. Missing = the bot has known exploitable weaknesses or operational blind spots that will cost real money.

| # | Feature | Why Expected | Complexity | Dependencies | Notes |
|---|---------|-------------|------------|--------------|-------|
| TS-1 | Fix SQL injection risk (trade-store.ts template literal) | Identified in security audit. Template literals in SQL are a classic injection vector -- even in single-user tools, malformed data from external APIs could trigger unintended queries. | Low | None | BUGS.md finding. Replace template literal with parameterized `?` placeholder. 30-minute fix. |
| TS-2 | Move API key from URL query param to header (tier3-creator.ts) | Helius API key in URL leaks in logs, browser history, server access logs, and error traces. Already partially mitigated with masking but the root cause (key in URL) persists. | Low | None | BUGS.md finding. Helius supports `Authorization: Bearer` header. |
| TS-3 | Validate config endpoint request body with Zod | Dashboard config PATCH endpoint accepts unvalidated input. Malformed payloads could corrupt runtime config (e.g., negative buyAmountSol, string where number expected). The Zod schema already exists (TradingConfigSchema) but is not applied to the PATCH body. | Low | Existing Zod schema | BUGS.md finding. Apply `TradingConfigSchema.partial().safeParse()` to request body. |
| TS-4 | Resolve dependency vulnerabilities | npm audit shows 2 high + 1 moderate. Even in a personal tool, known vulns in the dependency tree can be exploited if the bot is network-exposed (dashboard server). | Low | npm audit | BUGS.md finding. Run `npm audit fix` or pin patched versions. |
| TS-5 | SOL balance guard / circuit breaker | The bot currently has no minimum SOL balance check before executing buys. If the wallet drains below rent-exempt minimums or transaction fee reserves, buys will fail silently or worse -- the wallet could become unfunded mid-sell-ladder. Every production trading bot implements a balance floor. | Med | Execution engine | Check wallet SOL balance before each buy. Configurable `minSolBalance` threshold (e.g., 0.05 SOL). Reject buys when balance is insufficient. Emit WARNING event to dashboard. |
| TS-6 | Dynamic priority fee estimation | Current implementation uses a static `priorityFeeBaseLamports` config value. The Solana fee market is highly dynamic -- static fees either overpay during calm periods or fail to land during congestion. Competitive bots in 2026 use `getRecentPrioritizationFees` or Helius `getPriorityFeeEstimate` to adapt. | Med | RPC connection, Helius API | Replace static fee with percentile-based dynamic estimation. Use 75th percentile for buys (time-sensitive), 50th for monitoring sells, 90th for emergency sells. Fall back to static config if API fails. |
| TS-7 | Structured error surfacing / silent failure detection | v1.0 logs errors via pino but has no mechanism to surface "silent" failures to the operator -- e.g., WebSocket disconnected for 5 minutes, RugCheck API returning errors for all checks, Jupiter rate-limited for extended periods. These degrade the bot's effectiveness without any visible alert. | Med | Dashboard SSE, bot-event-bus | Add a health-check module that monitors critical subsystem states. Emit HEALTH_WARNING events when: detection feeds are disconnected > threshold, safety API error rate exceeds threshold, Jupiter rate limit active for > N seconds, no tokens detected in > M minutes. Dashboard displays these prominently. |
| TS-8 | Compute unit optimization for transactions | Current implementation does not set ComputeUnitLimit or ComputeUnitPrice instructions explicitly on transactions. This means: (a) transactions request default 200K CUs even if they use less, wasting priority fee budget, and (b) priority fee per CU is not optimized. Jupiter and Jito both benefit from tight CU budgets. | Med | Broadcaster, execution paths | Add `ComputeBudgetProgram.setComputeUnitLimit()` and `setComputeUnitPrice()` instructions. Estimate actual CU usage via simulation, request actual + 10% buffer. This directly improves transaction landing rate and reduces overpayment. |
| TS-9 | RPC health tracking with latency metrics | v1.0 has multi-RPC broadcast but no visibility into which RPCs are healthy, slow, or failing. When an RPC degrades, the bot continues using it without awareness. Production bots track per-RPC latency, error rate, and slot lag to make informed routing decisions. | Med | rpc-manager.ts | Track per-connection: p50/p99 latency, error count, last successful call timestamp, slot lag vs cluster. Log periodic RPC health summary. Emit health events for the dashboard. Enable intelligent primary selection (fastest healthy RPC for blockhash fetch). |

---

## Differentiators

Features that elevate the bot above baseline functionality. Not expected at v1.1, but provide measurable trading performance or operational improvements.

| # | Feature | Value Proposition | Complexity | Dependencies | Notes |
|---|---------|-------------------|------------|--------------|-------|
| DF-1 | Holder cluster analysis (funded-from-same-source detection) | Current holder concentration check (tier2-holder) counts top-holder percentages. But 2026 research shows rug operators distribute tokens across 20-100 wallets funded from the same source. Cluster analysis detects this pattern -- checking whether top holders share a common funding source reveals coordinated manipulation that simple % thresholds miss. | High | Helius API (enhanced transaction history), new safety check | Query funding history of top N holders. If >50% of top holders received initial SOL from the same source within 24h, flag as clustered. This catches the dominant 2026 rug pattern that bypasses simple holder % checks. Adds latency -- must be async/non-blocking. |
| DF-2 | Liquidity depth verification | Check DEX pool liquidity depth before buying. A token can pass all safety checks but have paper-thin liquidity -- meaning the buy itself moves the price significantly, and selling becomes nearly impossible. Verifying minimum liquidity (e.g., >$5K SOL-side) prevents buying into tokens where exit is impossible. | Med | Jupiter quote API or on-chain pool query | Fetch pool reserves for the token's primary trading pair. Reject tokens below configurable `minLiquiditySol` threshold. This directly prevents buying tokens that can't be sold -- a common v1.0 loss pattern. |
| DF-3 | Token age / lifecycle awareness | SolRugDetector research shows rug tokens have median 0.01-day lifespans and >90% of DeFi activity occurs on creation day. Adding a "token age" signal that checks time-since-creation helps the safety pipeline differentiate between brand-new tokens (higher risk, higher reward) and tokens that have survived their vulnerable period. | Low | Detection event timestamp, on-chain slot query | Already have `detectedAt` in TokenEvent. Can derive creation slot from mint account. Add as Tier 2 scoring signal -- not a hard block, but influences aggregate score. Tokens surviving >1 hour without holder exodus score higher. |
| DF-4 | Adaptive sell timing (momentum-aware exits) | Current position manager uses fixed interval polling with static thresholds. Smarter exits consider price momentum -- if a token is still appreciating rapidly, the trailing stop should widen dynamically rather than using a fixed percentage. Conversely, if momentum reverses sharply (>20% drop in 2 ticks), exit immediately rather than waiting for stop-loss threshold. | High | Position manager, Jupiter quote history | Maintain a rolling window of recent quote values (last 5-10 ticks). Calculate short-term momentum (rate of change). Adjust trailing stop dynamically: widen when momentum is positive, tighten when negative. Add "momentum crash" immediate exit trigger. Significant logic change. |
| DF-5 | Dashboard P&L analytics improvements | v1.0 dashboard has P&L charts and trade history. v1.1-worthy improvements: cumulative P&L over time (equity curve), win/loss ratio display, average hold time, best/worst trade, rolling 24h/7d/30d performance, per-source (pump vs raydium) performance breakdown. These give the operator data-driven feedback on config tuning. | Med | TradeStore queries, dashboard components | Pure analytics -- read-only queries on existing trade data. No risk to core pipeline. High value for config optimization. |
| DF-6 | Pipeline visibility in dashboard | Show real-time safety pipeline activity: tokens currently being evaluated, which checks passed/failed, aggregate scores, rejection reasons. Currently the dashboard shows post-decision events (BUY_SENT, REJECTED) but not the in-progress pipeline state. This gives the operator visibility into what the bot is actually doing and helps tune safety thresholds. | Med | Safety pipeline, SSE events, new dashboard components | Add SAFETY_EVALUATING and SAFETY_DETAIL events to bot-event-bus. Dashboard renders a "Pipeline" tab showing recent evaluations with per-check breakdowns. |
| DF-7 | Configurable Jito tip amounts with dynamic adjustment | Current Jito tip is static (`jitoTipLamports: 100000`). In 2026, competitive Jito usage requires dynamic tips that adapt to validator demand. Under-tipping causes bundle rejection; over-tipping wastes SOL. Dynamic adjustment based on recent Jito bundle acceptance rates or Jito tip floor API improves landing rate while minimizing cost. | Med | Jito API, sell-ladder | Query Jito tip distribution endpoint (getRecentBundleTips or equivalent). Set tip at configurable percentile of recent accepted tips. Maintain floor and ceiling config bounds. |
| DF-8 | Dashboard operational controls (pause/resume, force-sell) | v1.0 dashboard allows config changes but not operational control. Operators need: pause detection (stop taking new positions), resume detection, force-sell a specific position, force-sell all positions. These are critical during incidents (e.g., bot buying into a known rug that somehow passed safety). | Med | Dashboard routes, execution engine, detection manager | New API endpoints: POST /api/control/pause, /resume, /force-sell/:mint, /force-sell-all. Dashboard renders control buttons. Detection pause is straightforward (DetectionManager.stop/start). Force-sell triggers SellLadder directly. |
| DF-9 | Transaction simulation before broadcast | Current implementation skips preflight simulation (skipPreflight: true) for speed. Adding optional pre-simulation catches predictable failures (insufficient balance, wrong token program, expired blockhash) before wasting a network round trip. This is particularly valuable for sells where the token state may have changed. | Low | Broadcaster, Connection.simulateTransaction | Add optional `simulate: true` parameter to broadcastAndConfirm. When enabled, simulate before sign+send. Log simulation results. Default off for buys (speed priority), on for sell ladder steps 4-6 (reliability priority at later escalation steps). |

---

## Anti-Features

Features to explicitly NOT build for v1.1. Each has been considered and rejected with clear rationale.

| # | Anti-Feature | Why Avoid | What to Do Instead |
|---|-------------|-----------|-------------------|
| AF-1 | Social media sentiment analysis (Twitter/Telegram/Discord) | Adds 1-5 seconds of latency per token for API calls to social platforms. Incompatible with first-block-inclusion goal. Signal quality is extremely low for newly launched tokens (no social history exists). Already explicitly out-of-scope in PROJECT.md. | Rely on on-chain signals only. The safety pipeline's 3-tier approach covers the signals that actually predict rug pulls (authority, holder distribution, creator history). |
| AF-2 | AI/ML-based token scoring | Memecoin price action is essentially random in the first minutes. ML models trained on historical data suffer severe survivorship bias. Rule-based scoring is more interpretable, debuggable, and tunable. Already explicitly rejected in PROJECT.md key decisions. | Continue with rule-based weighted scoring. Tune weights based on observed performance data from dashboard analytics. |
| AF-3 | Multi-wallet rotation for buy execution | Some competitive bots rotate across 5-10 keypairs to avoid DEX pattern detection. This adds massive complexity (wallet management, balance distribution, key security) for a personal bot. The SolSniper architecture is single-wallet by design. | Keep single wallet. If buy success rate is low due to pattern detection, increase priority fees rather than adding wallet rotation complexity. |
| AF-4 | Copy trading / wallet tracking | Copy trading adds latency (detect whale tx -> construct our tx -> execute) that makes it non-competitive. By the time you detect and copy, price has moved. Already out of scope in PROJECT.md. | Focus on independent detection through PumpPortal/Raydium feeds. |
| AF-5 | gRPC/Yellowstone migration | Migrating detection from WebSocket (PumpPortal) + onLogs (Raydium) to Geyser gRPC would provide 1-5ms vs 50-200ms detection latency. However: (a) PumpPortal only provides WebSocket API, so half the detection can't migrate; (b) gRPC requires Yellowstone-compatible RPC provider (significant cost increase); (c) v1.0 detection latency is already adequate for pump.fun tokens where competition is moderate. | Keep current WebSocket detection. If detection latency becomes the bottleneck (evidence from dashboard analytics), revisit for v1.2. |
| AF-6 | Backtesting engine | Survivorship bias makes backtesting unreliable for memecoin trading. Tokens that rug-pulled no longer exist in historical data. Dry-run mode on mainnet provides far more realistic validation. Already rejected in PROJECT.md. | Use dry-run mode for strategy validation. Use dashboard analytics to evaluate live performance. |
| AF-7 | Telegram notifications/bot interface | Dashboard SSE already provides real-time event visibility. Adding a Telegram bot duplicates notification infrastructure and introduces a second interface to maintain. Already out of scope in PROJECT.md. | Enhance dashboard health warnings and operational controls instead. |
| AF-8 | Astralane or Lil-JIT MEV protection integration | Astralane provides stronger privacy than Jito but adds relay-hop latency and has smaller validator coverage. Lil-JIT is QuickNode-only. The bot already uses Jito bundles with ~70% validator coverage. Adding secondary MEV protection layers adds complexity for marginal benefit on a personal bot. | Keep Jito bundles as primary MEV protection. Improve Jito tip dynamics (DF-7) rather than adding alternative bundle services. |

---

## Feature Dependencies

```
TS-1 (SQL injection fix) ── standalone, no dependencies
TS-2 (API key to header) ── standalone
TS-3 (Config validation) ── standalone
TS-4 (Dep vulns) ── standalone
TS-5 (SOL balance guard) ── depends on execution engine entry points
TS-6 (Dynamic priority fees) ── depends on broadcaster.ts, RPC manager
TS-7 (Health monitoring) ── depends on detection-manager, safety-pipeline, jupiter-client
TS-8 (Compute unit optimization) ── depends on broadcaster.ts
TS-9 (RPC health tracking) ── depends on rpc-manager.ts

TS-6 → TS-8 (dynamic fees benefit from CU optimization -- fees are per-CU)
TS-9 → TS-6 (RPC health informs which connection to use for fee estimation)

DF-1 (Holder clusters) ── depends on existing tier2-holder check, Helius API
DF-2 (Liquidity depth) ── depends on safety pipeline, Jupiter or pool query
DF-3 (Token age) ── depends on detection events, minor safety pipeline addition
DF-4 (Adaptive sell timing) ── depends on position-manager.ts quote history
DF-5 (P&L analytics) ── depends on trade-store queries, dashboard only
DF-6 (Pipeline visibility) ── depends on safety-pipeline events, dashboard
DF-7 (Dynamic Jito tips) ── depends on sell-ladder, Jito API
DF-8 (Operational controls) ── depends on dashboard routes, detection-manager, sell-ladder
DF-9 (Tx simulation) ── depends on broadcaster.ts

DF-5 requires no backend changes (read-only queries on existing data)
DF-6 requires safety pipeline to emit additional events
DF-8 requires DF-6 conceptually (you want to see pipeline state before force-selling)
```

---

## MVP Recommendation for v1.1

### Must-have (ship or the bot has known holes):

1. **TS-1 through TS-4** -- Security audit fixes. Low effort, zero risk, mandatory. Ship first.
2. **TS-5** -- SOL balance guard. Prevents the catastrophic scenario where the bot drains itself below operational minimums.
3. **TS-7** -- Health monitoring. Without this, the operator has no way to know when the bot is degraded (detection disconnected, APIs failing, rate limited). This is the most impactful reliability feature.
4. **TS-6 + TS-8** -- Dynamic fees + CU optimization. Together these directly improve transaction landing rate, which is the core value proposition of the bot. Static fees are a competitive disadvantage in 2026.

### High-value additions (strongly recommended):

5. **DF-2** -- Liquidity depth verification. Prevents buying tokens that can't be sold. Directly prevents a common loss pattern.
6. **DF-5** -- P&L analytics. Essential for data-driven config tuning. Read-only, zero risk to core pipeline.
7. **DF-8** -- Operational controls. Pause/resume/force-sell are critical incident response tools.
8. **DF-6** -- Pipeline visibility. Makes safety pipeline tuning possible with real data.

### Defer to v1.2+:

9. **DF-1** -- Holder cluster analysis (high complexity, needs careful latency management)
10. **DF-4** -- Adaptive sell timing (high complexity, needs backtesting data to validate)
11. **DF-7** -- Dynamic Jito tips (useful but static tips work adequately)
12. **DF-3** -- Token age signal (low complexity but low impact -- most tokens are evaluated at creation time anyway)
13. **DF-9** -- Transaction simulation (low effort but conflicts with speed-first buy philosophy; useful only for late sell ladder steps)
14. **TS-9** -- RPC health tracking (useful for observability but current multi-RPC broadcast already provides implicit failover)

---

## Sources

- [SolRugDetector: Investigating Rug Pulls on Solana (2025 research paper)](https://arxiv.org/html/2603.24625) -- HIGH confidence, academic research on 100K+ tokens
- [Solidus Labs: Solana Rug Pulls & Pump-and-Dumps Report](https://www.soliduslabs.com/reports/solana-rug-pulls-pump-dumps-crypto-compliance) -- HIGH confidence, institutional compliance research
- [Building Production-Grade Solana Sniper Bots: 2026 Technical Blueprint (Dysnix)](https://dysnix.com/blog/complete-stack-competitive-solana-sniper-bots) -- MEDIUM confidence, vendor content but technically detailed
- [MEV Protection on Solana in 2026 -- Jito Bundles, Astralane (DEV.to)](https://dev.to/gerus_team/mev-protection-on-solana-in-2026-jito-bundles-astralane-and-what-actually-works-3gbc) -- MEDIUM confidence, community technical analysis
- [Priority Fees: Understanding Solana's Transaction Fee Mechanics (Helius)](https://www.helius.dev/blog/priority-fees-understanding-solanas-transaction-fee-mechanics) -- HIGH confidence, official provider documentation
- [Solana Trading Bots Guide 2026 Edition (RPC Fast)](https://rpcfast.com/blog/solana-trading-bot-guide) -- MEDIUM confidence, vendor guide
- [SolRPDS: A Dataset for Analyzing Rug Pulls in Solana DeFi](https://arxiv.org/pdf/2504.07132) -- HIGH confidence, academic dataset paper
- [Solana Security Guide 2026 (CoinTrenches)](https://cointrenches.io/solana-security-guide-2026/) -- LOW confidence, general security advice
- [Chainstack: Estimate Priority Fees with getRecentPrioritizationFees](https://docs.chainstack.com/docs/solana-estimate-priority-fees-getrecentprioritizationfees) -- HIGH confidence, provider documentation
- SolSniper v1.0 codebase analysis (direct code review) -- HIGH confidence
- SolSniper BUGS.md security audit findings -- HIGH confidence
