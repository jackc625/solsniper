# Feature Landscape

**Domain:** Solana Token Sniper Bot (Pump.fun + Raydium)
**Researched:** 2026-02-20
**Overall Confidence:** HIGH (based on project's own deep research document from 2026-02-19, existing architecture analysis, competitor landscape analysis, and domain expertise)

## Table Stakes

Features users expect. Missing = the bot is not competitive or functional.

### Detection & Entry

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Pump.fun new token detection (WebSocket) | Every competing bot monitors Pump.fun. Missing this means missing 80%+ of memecoin launches. | Low | PumpPortal WebSocket `subscribeNewToken` is free, well-documented, ~100-300ms latency. |
| Raydium pool creation detection | Tokens migrating from Pump.fun bonding curve to Raydium represent the second major entry opportunity. Non-Pump tokens also launch on Raydium directly. | Medium | `logsSubscribe` on Raydium program ID. Requires parsing pool creation logs. |
| First-block buy execution | The entire value proposition of a sniper bot. If you buy 10 seconds late, you are exit liquidity for earlier buyers. | High | Requires fast safety pipeline (<300ms), priority fees, fresh blockhash management, multi-RPC broadcast. |
| Jupiter Swap API integration | Industry standard aggregator. Best route finding across all Solana DEXs. Required for selling tokens that have migrated to Raydium/Orca/other pools. | Low | REST API, well-documented. Quote + swap in 200-500ms. |
| PumpPortal trade-local API integration | Fastest execution path for tokens still on Pump.fun bonding curve. Single HTTP call returns ready-to-sign transaction. | Low | 0.5% fee per trade. Acceptable for v1; optimize later with direct program calls. |
| Configurable buy amount | Users need to control risk per trade. A bot that hard-codes position sizes is unusable. | Low | Simple env var or config file. |
| Maximum concurrent position limit | Without this, the bot can drain the wallet by buying everything it detects. Hard cap is essential risk management. | Low | In-memory counter with config-driven limit. |

### Safety & Filtering

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Mint authority check (must be null) | Active mint authority = creator can print unlimited tokens, diluting your position to zero. This is the most basic rug pull vector. | Low | Single RPC call `getAccountInfo`, parse SPL Token account data. <50ms. |
| Freeze authority check (must be null) | Active freeze authority = creator can freeze your token account, making the token a honeypot. You literally cannot sell. | Low | Same RPC call as mint authority check. <50ms. |
| Sell simulation (honeypot detection) | Tokens that let you buy but not sell are a complete loss. Simulating a sell via Jupiter quote before buying is the most reliable honeypot check. | Medium | Jupiter quote for token-to-SOL. If no route or simulation fails, it is a honeypot. 100-300ms. |
| Minimum liquidity threshold | Buying into a pool with <0.5 SOL liquidity means you cannot exit without catastrophic slippage. | Low | Check pool reserves or Jupiter price impact. |
| Configurable safety score threshold | Different users have different risk tolerances. A hardcoded threshold cannot be tuned. | Low | Config-driven minimum score before buy is allowed. |

### Position Management & Exits

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Auto stop-loss | Without automatic stop-loss, a single rug pull during sleep drains the entire position. Manual monitoring is not viable for a 24/7 bot. | Medium | Polling-based price check every 3-5 seconds via Jupiter quote. Sell when loss exceeds threshold. |
| Auto take-profit | Memecoin pumps happen in seconds/minutes. Without auto TP, gains evaporate before manual exit. | Medium | Same price polling. Sell when gain exceeds threshold. |
| Position price monitoring | The bot must continuously know current position value to make exit decisions. | Medium | Jupiter quote polling or PumpPortal trade stream. Must handle multiple concurrent positions. |
| Sell retry with escalation | Sells fail far more often than buys (low liquidity, stale blockhash, insufficient priority fee). A single attempt is not enough. 3-5 retry levels minimum. | High | Escalation ladder: increase priority fee, increase slippage, try Jito bundle, chunk sell. Each level must refresh blockhash. |

### Persistence & Recovery

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Trade journal (SQLite) | Crash recovery requires knowing what trades are pending. Without persistence, a restart means lost positions with no way to manage them. | Medium | SQLite schema with trade state machine. Record entry/exit price, signature, safety score, timestamps. |
| Crash recovery (resume pending trades) | A bot that loses all state on restart is a liability. Open positions must be resumed. | Medium | On startup, query trades in non-terminal states (BUYING, MONITORING, SELLING). Resolve each based on on-chain state. |
| Duplicate trade prevention | Without idempotency, crash-and-restart causes double buys. This is money directly lost. | Medium | In-memory Set of `(mint, direction)` with SQLite persistence. Check before every transaction send. |

### Operations & Reliability

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Multi-RPC transaction broadcast | Sending to a single RPC provider is the most common failure point in sniper bots. Transaction landing probability increases linearly with provider count. | Medium | Send to ALL providers simultaneously for writes. Round-robin with failover for reads. |
| WebSocket reconnection with backoff | PumpPortal and Solana RPC WebSockets drop silently and frequently. Without reconnection, the bot goes blind within minutes. | Medium | Exponential backoff (1s to 30s), heartbeat every 30s, automatic resubscription. |
| Structured logging | When a trade fails, you need to know why. Unstructured logs are useless for debugging a high-frequency system. | Low | pino with JSON output. Required fields: timestamp, event type, mint, signature, latency, error. |
| Environment-based configuration | Settings like buy amount, safety threshold, RPC URLs, and TP/SL levels must be changeable without code changes. | Low | `.env` file with `dotenv`, validated on startup. |

## Differentiators

Features that set the bot apart. Not expected by every user, but provide competitive advantage.

### Execution Edge

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Jito bundle support | MEV protection and atomic execution. ~95% of Solana stake runs Jito validators (early 2026). Bundles guarantee all-or-nothing execution, preventing partial fills and sandwich attacks. Critical for sell reliability. | High | Build tip transaction, submit via Jito block engine REST API. Max 5 txs per bundle. Auction every ~200ms. |
| Dynamic slippage (Jupiter) | Jupiter's `dynamicSlippage` estimates optimal slippage per trade, eliminating the fixed-value guessing game. Dramatically reduces both failed transactions (too low) and unnecessary losses (too high). | Low | Single parameter in Jupiter swap request. Low implementation cost, high impact. |
| Parallel safety pipeline (<300ms) | Running all Tier 1 checks with `Promise.all` instead of sequentially cuts safety pipeline from 600ms+ to 200-300ms. This is the difference between first-block and second-block entry. | Medium | Careful async orchestration. Non-blocking Tier 2/3 checks that score but do not block. |
| Priority fee escalation strategy | Adaptive fee bidding: start low, escalate on retry. Avoids overpaying in normal conditions while ensuring execution during congestion. | Medium | Configurable fee tiers per retry attempt. Different strategies for buys vs sells (sells are more aggressive). |

### Safety Intelligence

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| RugCheck.xyz API integration | Comprehensive automated safety analysis covering risks beyond mint/freeze authority. Provides risk score and specific risk flags (LP unlocked, top holder concentration, etc.). | Low | REST API call in parallel with Tier 1 checks. Use as Tier 2 scoring modifier, never as hard blocker (API can be slow/down). |
| Holder concentration analysis | If top 10 wallets hold >30% of supply (excluding pool accounts), the token is a whale-manipulation target. Detecting this before buy avoids pump-and-dump traps. | Medium | `getTokenLargestAccounts` RPC call. Must exclude pool token accounts from the calculation. |
| Creator wallet history analysis | Repeat rug-pullers use new tokens but often reuse wallets. Detecting a creator with prior rugs is a strong rejection signal. | High | Requires indexing creator transaction history. Can use Helius parsed transaction API. High latency (500ms+), best as Tier 3. |
| LP burn/lock verification | Burned LP tokens mean liquidity cannot be pulled. Locked LP with a timelock provides temporary safety. Unburned, unlocked LP is a rug pull vector. | Medium | Check if LP tokens are sent to burn address (1111...1111) or held in a lock contract. |
| Metadata mutability check | Mutable metadata means the token name, image, and links can be changed post-launch. Used for phishing (rename to a popular token). | Low | Fetch Metaplex metadata account, check `isMutable` flag. |

### Position Intelligence

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Tiered take-profit (multi-level exits) | Sell 33% at 2x, 33% at 5x, remaining at 10x. Locks in profits while maintaining upside exposure. Far superior to all-or-nothing TP. | Medium | Partial sell tracking in trade journal. Each TP level triggers a sell of a configurable percentage. |
| Trailing stop-loss | Track highest price seen, sell when price drops X% from peak. Captures more upside than fixed TP while still protecting against reversal. | Medium | Maintain high-water-mark per position. Requires more frequent price polling (every 1-2 seconds). |
| Time-based auto-exit (max hold duration) | Sell after N minutes regardless of PnL. Prevents bag-holding when a token goes sideways. Memecoin pumps happen in minutes; if it has not moved in 10 minutes, it is not going to. | Low | Simple timer per position. Check on each monitoring tick. |
| Chunked sell for large positions | Split large sells into 2-3 smaller transactions when liquidity is thin. Gets partial exit instead of total failure. | High | Must handle partial fill tracking, multiple transaction confirmations, and PnL accounting for split exits. |

### Observability & Control

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Web dashboard with live trade feed | Real-time visibility into what the bot is doing. See snipes, buys, sells, rejections as they happen. Far superior to tailing log files. | High | Requires web server (Express/Fastify), WebSocket for real-time updates, frontend (React or plain HTML). |
| Web dashboard with P&L tracking | Per-trade and aggregate performance metrics. Win rate, average gain, daily/weekly/monthly P&L. Data-driven strategy tuning. | High | Queries against trade journal SQLite. Aggregate calculations. Chart rendering. |
| Web dashboard with filter configuration | Change safety thresholds, buy amounts, TP/SL levels, and other settings without restarting the bot. Hot-reload config. | Medium | REST API endpoint to update config. Validation layer. Must propagate changes to running monitors. |
| Web dashboard with wallet management | View SOL balance, token balances, fund/withdraw. Operational awareness without needing Phantom or Solscan. | Medium | RPC calls for balance. SOL transfer functionality for withdraw. |
| Telegram/Discord alerts | Push notifications for critical events: trade executed, position stuck, daily loss exceeded, bot crashed. Operators need alerts even when not watching the dashboard. | Low | Simple HTTP POST to Telegram Bot API or Discord webhook. |

### Advanced Execution (Phase 3+)

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Direct Pump.fun program calls (bypass PumpPortal) | Eliminates 0.5% PumpPortal fee per trade. For a bot executing 100 trades/day at 0.05 SOL each, this saves ~0.025 SOL/day. Meaningful at scale. | Very High | Requires parsing Pump.fun IDL, manual instruction building, account discovery. Significant development effort. |
| Geyser gRPC detection | ~0-50ms detection latency vs 100-300ms with PumpPortal WebSocket. At scale, this 200ms advantage means consistently landing in the first block instead of the second. | Very High | Requires dedicated node or Geyser-enabled RPC ($300-1000+/mo). Stream program account changes directly from validator. |
| Simulation/paper trading mode | Full pipeline execution without real transactions. Shadow portfolio tracks what would have happened. Essential for strategy validation before risking capital. | Medium | Run entire pipeline but call `simulateTransaction` instead of `sendRawTransaction`. Track shadow P&L. |
| Congestion-aware fee adaptation | Dynamically adjust priority fees based on recent block success rates and network congestion. Avoid overpaying during quiet periods, ensure execution during peak times. | High | Track recent transaction success rate by fee tier. Time-of-day patterns. Adaptive algorithm. |

## Anti-Features

Features to explicitly NOT build. These seem appealing but are traps.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **Social presence filtering (Twitter/Telegram checks)** | Adds 2-10 seconds of latency to the pipeline. Completely incompatible with first-block execution goal. Many legit meme tokens have no socials at launch; many scams have fake ones. Signal-to-noise ratio is terrible. | Use on-chain safety checks only (mint auth, freeze auth, sell simulation, holder analysis). These are faster and more reliable. |
| **Multi-user support / auth system** | This is a personal tool for a single operator. Multi-user support adds authentication, authorization, rate limiting, wallet isolation, and billing complexity. It transforms a focused tool into a SaaS platform. | Single wallet, single operator. If others want it, they run their own instance. |
| **Mobile app** | Web dashboard accessible from mobile browser is sufficient. A native mobile app adds iOS/Android development, app store management, and push notification infrastructure. Massive scope increase for negligible benefit. | Build a responsive web dashboard. Works on mobile browsers out of the box. |
| **Telegram bot interface** | Telegram bots are the standard for consumer sniper products (GMGN, BonkBot, Trojan). But for a personal tool, a web dashboard is superior: richer visualization, no character limits, direct database access for complex queries. Building a Telegram bot adds message parsing, command routing, and state management overhead. | Web dashboard handles all control and monitoring. |
| **Copy trading / follow-wallet sniping** | Following "smart money" wallets sounds attractive but in practice: (1) by the time you detect their buy and execute yours, the price has already moved, (2) wallet labels are unreliable and change constantly, (3) many "smart money" wallets are actually bots being frontrun themselves. | Focus on independent token detection and safety filtering. Your edge is filtering quality, not following others. |
| **Backtesting with historical data** | Historical memecoin data is noisy, survivorship-biased, and does not reflect real execution conditions (slippage, priority fees, failed transactions). A backtest showing "would have made 500% this month" is misleading because it assumes perfect execution at historical prices. | Use forward-testing: simulation mode with real-time data, then tiny-wallet real trades. This validates the actual pipeline, not a theoretical one. |
| **Multi-chain support (Ethereum, Base, BSC)** | Each chain has different DEXs, different execution models, different MEV landscapes, and different APIs. Multi-chain turns a focused Solana tool into a cross-chain platform with 5x the integration surface. | Solana only. The entire architecture (Jito bundles, Jupiter, PumpPortal, priority fees) is Solana-specific. |
| **AI/ML-based token scoring** | ML models for memecoin prediction are snake oil. The token lifecycle is too short (minutes to hours), the signal is too noisy, and the training data is survivorship-biased. On-chain heuristics (mint auth, freeze auth, holder concentration) are more reliable and interpretable. | Rule-based scoring with configurable thresholds. Transparent, debuggable, adjustable. |
| **Automatic strategy optimization** | Automatically tuning TP/SL/safety parameters sounds smart but is dangerous. Over-fitting to recent market conditions leads to catastrophic losses when conditions change. The operator must make conscious risk decisions. | Provide P&L analytics so the operator can make informed manual adjustments. Log all parameters used for each trade for post-hoc analysis. |

## Feature Dependencies

```
Detection (PumpPortal WS + logsSubscribe)
  |
  v
Safety Pipeline (mint auth + freeze auth + sell simulation)
  |
  v
Buy Execution (Jupiter + PumpPortal trade-local)
  |                                        |
  v                                        v
Trade Journal (SQLite persistence)     Duplicate Prevention (idempotency)
  |
  v
Position Monitoring (price polling)
  |
  +---> Stop-Loss -----> Sell Execution (Jupiter + retry ladder)
  |                            |
  +---> Take-Profit ---->      +---> Jito Bundles (escalation fallback)
  |                            |
  +---> Trailing Stop -->      +---> Chunked Sells (large position fallback)
  |
  +---> Time-based Exit

Crash Recovery (depends on: Trade Journal + Position Monitoring)

WebSocket Resilience (wraps: PumpPortal WS + logsSubscribe + price streams)

Multi-RPC (wraps: all RPC calls across all components)

Web Dashboard (depends on: Trade Journal + Position Monitoring + Config system)
  +---> Live Trade Feed (depends on: bot event emitter)
  +---> P&L Tracking (depends on: trade journal queries)
  +---> Filter Config (depends on: hot-reload config system)
  +---> Wallet Management (depends on: RPC wallet queries)

RugCheck Integration (depends on: Safety Pipeline, non-blocking)

Holder Analysis (depends on: Safety Pipeline, non-blocking)

Creator History (depends on: Safety Pipeline + Helius parsed tx API)

Tiered Take-Profit (depends on: Position Monitoring + partial sell tracking in journal)

Trailing Stop (depends on: Position Monitoring + high-water-mark tracking)

Direct Pump.fun Calls (depends on: Buy Execution working with PumpPortal first)

Geyser gRPC (depends on: Detection working with WebSocket first)

Telegram/Discord Alerts (depends on: structured logging + event system)
```

### Critical Path (MVP)

```
WebSocket Resilience
  -> Detection
    -> Safety Pipeline (parallel: mint + freeze + sell sim)
      -> Buy Execution
        -> Trade Journal
          -> Duplicate Prevention
            -> Position Monitoring
              -> Stop-Loss + Take-Profit
                -> Sell Execution (with retry ladder)
                  -> Crash Recovery
```

Every feature in this chain must work before the bot can trade safely. Removing any link breaks the chain.

### Independent Features (can be added in any order after MVP)

- RugCheck integration (enhances safety, does not gate anything)
- Holder concentration analysis (enhances safety)
- Tiered take-profit (enhances exits)
- Trailing stop (enhances exits)
- Time-based exit (enhances exits)
- Web dashboard (observability, does not affect trading)
- Telegram/Discord alerts (observability)
- Jito bundles (enhances sell reliability)
- Multi-RPC failover (enhances reliability)

## MVP Recommendation

### Must Ship (Table Stakes)

1. **PumpPortal WebSocket detection** - Cannot snipe without detecting tokens
2. **Tier 1 safety pipeline (parallel)** - Mint auth + freeze auth + sell simulation in <300ms
3. **Jupiter + PumpPortal buy execution** - Hybrid strategy: PumpPortal for bonding curve, Jupiter for migrated tokens
4. **Auto stop-loss and take-profit** - Position management prevents catastrophic losses
5. **Sell retry ladder (3+ levels)** - Sells fail more than buys; must have escalation
6. **SQLite trade journal** - Crash recovery and PnL tracking foundation
7. **Duplicate prevention** - Without idempotency, crashes cause double buys
8. **WebSocket reconnection** - Bot goes blind within minutes without this
9. **Multi-RPC broadcast for transactions** - Single RPC is the most common failure point
10. **Structured logging** - Cannot debug a high-frequency system without this

### Ship Next (High-Impact Differentiators)

1. **Jito bundle support for sells** - Dramatically improves sell reliability
2. **Tiered take-profit** - Captures more value than all-or-nothing exits
3. **Trailing stop** - Captures more upside than fixed take-profit
4. **RugCheck API integration** - Additional safety layer, low effort
5. **Web dashboard (live feed + P&L)** - Operational visibility

### Defer (Optimize Later)

- **Direct Pump.fun program calls** - Saves 0.5% fee, very high complexity
- **Geyser gRPC detection** - Saves 200ms latency, requires expensive infrastructure
- **Creator wallet history** - High latency, high complexity, moderate signal
- **Web dashboard filter config** - Hot-reload config is nice but not urgent
- **Congestion-aware fee adaptation** - Optimization; start with static tiers
- **Simulation/paper trading mode** - Use tiny-wallet real trades instead (more realistic)

## Competitor Feature Matrix (for context)

Based on the project's own competitor analysis (research doc, Section 2):

| Feature | Consumer Bots (GMGN, BonkBot, Trojan) | Open Source Self-Hosted | Pro/Institutional | SolSniper Target |
|---------|---------------------------------------|----------------------|-------------------|-----------------|
| Detection latency | 500ms-2s | 200ms-1s | <100ms | 200-500ms |
| Safety checks | Basic (mint/freeze) | Configurable | Advanced + ML | Tiered (3 levels) |
| Execution method | Cloud RPC | Single RPC | Geyser + co-located | Multi-RPC + Jito |
| Sell reliability | Basic retry | Basic retry | Escalation ladder | Full escalation ladder |
| Position management | Simple TP/SL | Simple TP/SL | Tiered + trailing | Tiered + trailing |
| Dashboard | Telegram UI | None (logs) | Custom web | Web dashboard |
| Cost | Free + fees | Self-hosted | $500+/mo infra | $55-60/mo |

SolSniper targets the gap between open-source self-hosted (unreliable, no dashboard) and pro/institutional (expensive infrastructure). The differentiator is sell reliability, safety depth, and web-based observability at a personal budget.

## Sources

- Project research document: `solana-sniper-bot-research.md` (2026-02-19) - HIGH confidence (primary source for all technical details and competitor analysis)
- Project architecture analysis: `.planning/codebase/ARCHITECTURE.md` (2026-02-20) - HIGH confidence
- Project integrations map: `.planning/codebase/INTEGRATIONS.md` (2026-02-20) - HIGH confidence
- Project concerns analysis: `.planning/codebase/CONCERNS.md` (2026-02-20) - HIGH confidence
- Project requirements: `.planning/PROJECT.md` (2026-02-20) - HIGH confidence
- Domain expertise from training data on Solana DeFi ecosystem, Jupiter API, Jito bundles, PumpPortal - MEDIUM confidence (training data may be 6-18 months stale; verified against project research doc)

**Note:** WebSearch and WebFetch were unavailable during this research session. Competitor feature details (GMGN, BonkBot, Trojan) are based on the project's own research document analysis and training data. Consumer bot features should be verified against current documentation if precise feature parity matters.
