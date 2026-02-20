# SolSniper

## What This Is

A personal Solana token sniper bot that detects new token launches on Pump.fun and Raydium, runs smart safety filters, and executes buy transactions in the first block. It automatically manages positions with take-profit and stop-loss exits. A web dashboard provides real-time trade monitoring, P&L tracking, filter configuration, and wallet management.

## Core Value

Land buy transactions in the first block on new token launches while filtering out scams — speed and safety together.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Detect new token launches on Pump.fun via PumpPortal WebSocket
- [ ] Detect new Raydium pool creation via logsSubscribe
- [ ] Run parallel safety checks: mint authority, freeze authority, sell simulation
- [ ] Analyze creator wallet history for prior rugs
- [ ] Check liquidity metrics: initial size, lock status, LP burn
- [ ] Score tokens and enforce minimum safety threshold before buying
- [ ] Execute buy transactions targeting first-block inclusion
- [ ] Use Jito bundles for MEV-protected execution
- [ ] Send transactions to multiple RPC providers simultaneously
- [ ] Auto take-profit at configurable multiplier targets
- [ ] Auto stop-loss at configurable loss threshold
- [ ] Persist all trades to SQLite for crash recovery
- [ ] Resume pending trades on bot restart
- [ ] Web dashboard with live trade feed (real-time snipes, buys, sells)
- [ ] Web dashboard with P&L tracking (per-trade and overall performance)
- [ ] Web dashboard with filter configuration (adjust thresholds and rules)
- [ ] Web dashboard with wallet management (view balances, fund/withdraw)
- [ ] Retry escalation ladder for failed sell transactions
- [ ] Multi-RPC failover for reliability
- [ ] Structured logging for debugging and operational insights

### Out of Scope

- Multi-user support — personal tool, single wallet, no auth system
- Social presence filtering (Twitter/Telegram checks) — adds latency incompatible with first-block goal
- Mobile app — web dashboard is sufficient
- Telegram bot interface — web dashboard covers control and alerts
- Direct Pump.fun CPI (bypass PumpPortal fee) — Phase 3 optimization, not v1
- Rust rewrite of hot paths — optimization for later if needed

## Context

- Codebase map exists at `.planning/codebase/` with detailed architecture, stack, and structure docs
- Research document (`solana-sniper-bot-research.md`) informed the codebase map
- No implementation code exists yet — this is greenfield
- Architecture follows reactive event-driven pipeline: Detection → Safety → Execution → Position Management → Operations
- Stack: TypeScript on Node.js 20+, @solana/web3.js v1, Jupiter Swap API, PumpPortal APIs, better-sqlite3, pino
- RPC: Helius primary, QuickNode backup
- Competition in this space is intense — latency matters at every step

## Constraints

- **Speed**: Must target first-block inclusion — every millisecond in the pipeline matters
- **Single process**: Bot runs as one Node.js process; SQLite is appropriate (no multi-instance)
- **Cost**: Personal project — Helius Developer ($49/mo) + VPS ($5-15/mo) budget tier
- **Security**: Private key handling must be secure — never logged, loaded from env vars
- **Reliability**: Bot must recover from crashes — all state persisted to SQLite, pending trades resumed on restart

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| TypeScript over Rust | Faster development, strong Solana SDK ecosystem, Rust optimization deferred | — Pending |
| @solana/web3.js v1 over v2 | Battle-tested, more community examples and documentation | — Pending |
| Jupiter REST API over SDK | Simpler integration, no SDK version management | — Pending |
| PumpPortal trade-local API | Easy to implement, 0.5% fee acceptable for v1 | — Pending |
| SQLite over PostgreSQL | Single-process bot, zero config, fast | — Pending |
| Jito bundles for execution | MEV protection, atomic execution, ~95% validator coverage | — Pending |
| Web dashboard over CLI/Telegram | Richer visualization for P&L and trade monitoring | — Pending |

---
*Last updated: 2026-02-20 after initialization*
