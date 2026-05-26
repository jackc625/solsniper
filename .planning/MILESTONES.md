# Milestones

## v1.1 Hardening & Polish (Shipped: 2026-05-26)

**Phases completed:** 5 phases, 21 plans executed (+1 superseded gap-closure plan), 38 tasks
**Timeline:** ~60 days (2026-03-27 → 2026-05-26)
**Commits:** 118 (v1.0..HEAD) | **Diff:** 160 files, +22,677 / −1,626 (incl. planning docs, tests, lockfile)
**Requirements:** 19/20 satisfied; SAF-10 partial (deferred)
**Known deferred items at close:** 2 (see STATE.md Deferred Items)

**Delivered:** Production-hardening pass over the v1.0 bot — closed all security findings, extended the safety pipeline with three new rug-detection checks, added network-aware dynamic fees + compute-unit optimization + a wallet balance guard, built a health/metrics/alerts monitoring layer with log rotation, and overhauled the dashboard with analytics, a live safety-pipeline view, operational controls (pause / force-sell / emergency-stop), and a system-status panel.

**Key accomplishments:**

- ESLint 10 with two custom security rules (SQL injection guard, API key URL guard) and Helius API key migrated from URL query param to X-Api-Key header
- 3-layer PATCH /api/config validation with structuredClone rollback, cross-field semantic checks for safety weights and TP percentages, and human-friendly Zod error formatting
- Fastify upgraded to 5.8.4, picomatch and brace-expansion overridden via pnpm, bigint-buffer documented as accepted LOW-risk, BUGS.md updated with all 4 security finding resolutions
- Standalone audit script correlating safety pipeline decisions with trade P&L outcomes, generating Markdown reports with per-check accuracy and scoring weight recommendations
- Three new safety checks wired into pipeline: liquidity depth as Tier 1 hard gate, LP lock and metadata mutability as Tier 2 penalty signals with RugCheck lpLockedPct data flowing to LP lock scoring
- Helius-integrated FeeEstimator with 5s TTL cache, cap enforcement, and static fallback; BalanceGuard with cached getBalance and threshold logic; config schema extended with maxPriorityFeeCapLamports and minBalanceBufferSol
- Dynamic Helius-based fees wired into all 5 buyer/seller paths; Jito seller adds CU simulation with ComputeBudgetProgram instruction replacement in MessageV0, 15% buffer, and graceful degradation
- BalanceGuard wired into detection handler between max-positions check and safety pipeline, emitting LOW_BALANCE events when wallet SOL is below buy threshold
- SYSTEM_ALERT event type, MonitoringConfigSchema, SQLite AlertStore, pino-roll production log rotation, and ResilientWebSocket health accessors for downstream monitoring plans
- HealthService with worst-of aggregate health, alert transition detection with cooldown debouncing, and MetricsTracker with p50/p99 sliding-window percentile computation
- Three Fastify route plugins exposing monitoring data via GET /api/health (503 on down), GET /api/alerts (paginated), and GET /api/metrics (per-endpoint stats) registered in dashboard-server.ts
- SAFETY_EVALUATION event emission from safety pipeline, controls route plugin (pause/resume, force-sell, emergency-stop), and detection pause flag wiring
- Per-source stat cards, equity curve source filter, and table source dropdown -- all computed client-side from existing /api/trades/history data with flicker-free chart updates
- Full Pipeline page with streaming safety evaluation cards and stats header, plus Controls page with pause/resume, positions table with force-sell inline confirmation, and emergency stop dialog
- System Status page with component health grid (colored status dots), RPC metrics table (p50/p99/error rate), and paginated alert history with type badges from Phase 20 monitoring endpoints

**Known gaps / deferred:**

- **SAF-10** (partial): safety FP/FN audit — tooling + first trade-outcome report shipped (`reports/safety-audit-2026-05-26.md`), but FP/FN rates need live safety-scored trades (all 76 DB trades predate Phase 18 persistence)
- **SEC-02** (resolved, noted): Helius key was reverted from header back to URL query-param (Enhanced TX API requires query-param) and scrubbed from all logs — accomplishment #1 above describes the original Phase 17 header migration that was later reverted
- **config-changed-sse-feed**: diagnosed SSE-drop-on-tab-switch bug, deferred (possibly moot after Phase 21 connection-bar rework)
- Nyquist validation: only Phase 21 fully compliant; phases 17-20 have draft VALIDATION.md

**Archives:** [ROADMAP](milestones/v1.1-ROADMAP.md) | [REQUIREMENTS](milestones/v1.1-REQUIREMENTS.md) | [AUDIT](milestones/v1.1-MILESTONE-AUDIT.md)

---

## v1.0 MVP (Shipped: 2026-03-24)

**Phases completed:** 16 phases, 42 plans, 76 tasks
**Timeline:** 31 days (2026-02-20 → 2026-03-23)
**Commits:** 243 | **LOC:** 13,653 TypeScript/TSX/CSS
**Requirements:** 60/60 satisfied (DET, SAF, EXE, POS, PER, OPS, DASH, DRY, UI)

**Delivered:** Full-stack Solana token sniper with real-time detection, multi-tiered safety pipeline, dual-path execution engine, position management, crash recovery, and a web dashboard with live trade feed, P&L tracking, and hot-reloadable configuration.

**Key accomplishments:**

1. Real-time token detection on Pump.fun and Raydium with auto-reconnecting WebSockets, heartbeat silence detection, and dedup filtering
2. 3-tier safety pipeline: hard blocks (authority/sell route), RugCheck + holder concentration scoring, creator history analysis — all parallel with configurable aggregate threshold
3. Dual-path execution engine (Jupiter + PumpPortal) with 6-step sell escalation ladder (standard, high-fee, Jito MEV bundle, chunked, PumpPortal fallback, emergency 49% slippage)
4. Crash recovery reconciles in-flight trades against on-chain wallet state, supporting both SPL Token and Token-2022 programs
5. Industrial trading terminal dashboard (Preact+Vite+Fastify SSE) with live feed, P&L charts, sortable trade history, and live config hot-reload
6. Dry-run mode runs full mainnet pipeline with gate interception and shadow price tracking for safe validation

**Tech debt carried forward:**

- 12 test files need Jupiter API key mock (pre-existing, low severity)
- Nyquist validation coverage partial (1/16 phases fully compliant)

**Archives:** [ROADMAP](milestones/v1.0-ROADMAP.md) | [REQUIREMENTS](milestones/v1.0-REQUIREMENTS.md) | [AUDIT](milestones/v1.0-MILESTONE-AUDIT.md)

---
