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
- ✓ SEC-01 to SEC-04: Security hardening — SQL audit, API key handling, config validation, dependency fixes — v1.1
- ✓ SAF-11 to SAF-14: Safety enhancement — liquidity depth, LP lock, metadata mutability checks — v1.1
- ✓ EXE-10 to EXE-12: Execution performance — dynamic Helius fees, CU optimization, balance guard — v1.1
- ✓ REL-01 to REL-04: Reliability & monitoring — health endpoints, system alerts, per-RPC metrics, log rotation — v1.1
- ✓ DASH-07 to DASH-10: Dashboard overhaul — per-source analytics, live pipeline view, operational controls, system status — v1.1

### Partially Validated

- ◐ SAF-10: Safety pass/fail audit vs real outcomes — audit tooling + first trade-outcome report shipped (v1.1, `reports/safety-audit-2026-05-26.md`); false-positive/negative quantification deferred until live safety-scored trades accumulate

### Active

(None — next milestone not yet defined. Run `/gsd-new-milestone` to scope v1.2.)

## Current State

**Shipped:** v1.1 Hardening & Polish (Phases 17-21), archived 2026-05-26. The bot is production-hardened — security findings closed, safety pipeline extended with liquidity-depth / LP-lock / metadata-mutability checks, dynamic Helius priority fees + Jito CU simulation + balance guard, health/metrics/alert monitoring with log rotation, and a full dashboard overhaul (per-source analytics, live safety-pipeline view, pause/force-sell/emergency-stop controls, system status).

**Known deferred:**
- SAF-10 FP/FN analysis — needs live safety-scored trades (all DB trades predate Phase 18 persistence)
- `config-changed-sse-feed` — diagnosed SSE-drop-on-tab-switch bug; may be moot after Phase 21 connection-bar rework, unconfirmed

## Next Milestone

Not yet defined. Candidate directions in REQUIREMENTS.md "Future Requirements": SAF-15/16 (holder-cluster + token-age), EXE-13/14/15 (adaptive sells, dynamic Jito tips, late-step simulation), REL-05 (adaptive polling). Run `/gsd-new-milestone` to scope v1.2.

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

Shipped v1.0 (13,653 LOC, 243 commits, 31 days) then v1.1 Hardening & Polish (Phases 17-21). Test suite at 474 tests green as of Phase 21.

**Tech stack:** TypeScript ES2022, Node.js, @solana/web3.js v1, Jupiter Swap API, PumpPortal APIs, better-sqlite3, pino + pino-roll, Fastify 5 + @fastify/sse, Preact + Vite, lightweight-charts. ESLint 10 with custom security rules.

**Architecture:** Reactive event-driven pipeline: Detection → Safety → Execution → Position Management, with SQLite write-ahead persistence, a HealthService / MetricsTracker / AlertStore monitoring layer, and an SSE-connected web dashboard.

**Known tech debt:**
- SAF-10 FP/FN audit deferred — needs live safety-scored trade data
- `config-changed-sse-feed` diagnosed SSE bug — deferred, possibly moot post-Phase-21
- Nyquist validation: only Phase 21 fully compliant; phases 17-20 have draft VALIDATION.md (tests green, formal pass pending)
- 12 test files need Jupiter API key mock (pre-existing since Phase 9)

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
| Helius key via X-Api-Key header then reverted to query-param (v1.1 P17→P18) | Enhanced Transactions API only supports query-param auth | ⚠️ Revisit — works + key scrubbed from logs; requirement wording corrected |
| Liquidity depth as Tier-1 hard gate; LP-lock + metadata as Tier-2 penalties (v1.1 P18) | Hard-reject illiquid tokens; soft-penalize rug signals | ✓ Good |
| Dynamic Helius priority fees + Jito CU simulation (v1.1 P19) | Network-aware fees; tight CU vs 200K default | ✓ Good |
| Module-level setter injection for monitoring wiring (v1.1 P20) | Avoids cascading constructor changes through engine/ladder/pipeline | ✓ Good |
| Client-side per-source analytics from existing /api/trades/history (v1.1 P21) | No new backend endpoint; reuse trade history | ✓ Good |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd:transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-05-26 — v1.1 Hardening & Polish shipped and archived*
