# SolSniper

## What This Is

A personal Solana token sniper bot that detects new token launches on Pump.fun and Raydium in real-time, runs a 3-tier safety pipeline (authority checks, RugCheck scoring, creator history), and executes buy transactions targeting first-block inclusion via Jupiter and PumpPortal. It automatically manages open positions with tiered take-profit, stop-loss, and trailing stop exits through a 6-step sell escalation ladder. An industrial-themed web dashboard provides live SSE trade feeds, P&L charts, sortable trade history, and hot-reloadable configuration. Includes a dry-run mode for safe mainnet validation without real trades.

## Core Value

Land buy transactions in the first block on new token launches while filtering out scams — speed and safety together.

## Requirements

### Validated

- ✓ DET-01 to DET-05: Real-time detection on Pump.fun + Raydium with auto-reconnect — v1.0
- ✓ SAF-01 to SAF-09: 3-tier safety pipeline with parallel checks and aggregate scoring — v1.0
- ✓ EXE-01 to EXE-09: Dual-path execution with 6-step sell escalation ladder — v1.0
- ✓ POS-01 to POS-06: Position management with stop-loss, tiered TP, trailing stop — v1.0
- ✓ PER-01 to PER-05: SQLite persistence with write-ahead and crash recovery — v1.0
- ✓ OPS-01 to OPS-06: Structured logging, RPC failover, graceful shutdown — v1.0
- ✓ DASH-01 to DASH-06: Web dashboard with SSE feed, P&L, and live config — v1.0
- ✓ DRY-01 to DRY-08: Dry-run mode with gate interception and shadow tracking — v1.0
- ✓ UI-01 to UI-06: Industrial trading terminal with sidebar layout and rich feed cards — v1.0

### Active

(None — define with `/gsd:new-milestone`)

### Out of Scope

- Multi-user support — personal tool, single wallet, no auth system
- Social presence filtering (Twitter/Telegram checks) — adds latency incompatible with first-block goal
- Mobile app — web dashboard is sufficient
- Telegram bot interface — web dashboard covers control and alerts
- AI/ML token scoring — unreliable for memecoin timeframes; rule-based scoring is more interpretable
- Copy trading — by the time you detect and execute, price has already moved
- Backtesting — survivorship-biased; use dry-run mode on mainnet instead
- Devnet testing — no real DEXs, liquidity, or competition

## Context

Shipped v1.0 with 13,653 LOC TypeScript/TSX/CSS across 243 commits in 31 days.

**Tech stack:** TypeScript ES2022, Node.js, @solana/web3.js v1, Jupiter Swap API, PumpPortal APIs, better-sqlite3, pino, Fastify 5 + @fastify/sse, Preact + Vite, lightweight-charts.

**Architecture:** Reactive event-driven pipeline: Detection → Safety → Execution → Position Management, with SQLite write-ahead persistence and SSE-connected web dashboard.

**Known tech debt:**
- 12 test files need Jupiter API key mock (pre-existing since Phase 9)
- Nyquist validation coverage partial (1/16 phases fully compliant)

## Constraints

- **Speed**: Must target first-block inclusion — every millisecond matters
- **Single process**: One Node.js process; SQLite is appropriate (no multi-instance)
- **Cost**: Helius Developer ($49/mo) + VPS ($5-15/mo) budget tier
- **Security**: Private key never logged, loaded from env vars only
- **Reliability**: All state persisted to SQLite, pending trades resumed on restart

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| TypeScript over Rust | Faster development, strong Solana SDK ecosystem | ✓ Good — shipped in 31 days |
| @solana/web3.js v1 over v2 | Battle-tested, more community examples | ✓ Good |
| Jupiter REST API over SDK | Simpler integration, no SDK version management | ✓ Good |
| PumpPortal trade-local API | Easy to implement, 0.5% fee acceptable for v1 | ✓ Good |
| SQLite over PostgreSQL | Single-process bot, zero config, fast | ✓ Good |
| Jito bundles for MEV protection | Atomic execution, ~95% validator coverage | ✓ Good |
| Preact+Vite+Fastify dashboard | In-process SSE, no separate service | ✓ Good |
| Pattern A (getAccountInfo + unpackMint) | Handles both SPL Token and Token-2022 | ✓ Good — critical for pump.fun create_v2 |
| getRuntimeConfig() hot-reload | Live config changes without restart | ✓ Good — dashboard Settings work immediately |
| Dual-gate dry-run interception | Full mainnet pipeline minus real transactions | ✓ Good — safe validation |

---
*Last updated: 2026-03-24 after v1.0 milestone*
