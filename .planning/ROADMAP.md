# Roadmap: SolSniper

## Milestones

- **v1.0 MVP** — Phases 1-16 (shipped 2026-03-24) | [Archive](milestones/v1.0-ROADMAP.md)
- **v1.1 Hardening & Polish** — Phases 17-21 (in progress)

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

### v1.1 Hardening & Polish

- [ ] **Phase 17: Security Fixes** - Resolve all BUGS.md security findings before adding new attack surface
- [ ] **Phase 18: Safety Pipeline Audit & Enhancement** - Validate and improve safety filtering accuracy with new rug detection checks
- [ ] **Phase 19: Execution Performance** - Dynamic fees, compute optimization, and balance guards for better trade outcomes
- [ ] **Phase 20: Reliability & Monitoring** - Health endpoints, system alerts, RPC tracking, and log rotation
- [ ] **Phase 21: Dashboard Overhaul** - Analytics, pipeline visibility, operational controls, and system status

## Phase Details

### Phase 17: Security Fixes
**Goal**: Bot has no known security vulnerabilities — SQL injection risk resolved, API keys secured, config validation airtight, dependency audit clean
**Depends on**: Nothing (first phase of v1.1; no upstream dependencies)
**Requirements**: SEC-01, SEC-02, SEC-03, SEC-04
**Success Criteria** (what must be TRUE):
  1. SQL queries in trade-store.ts confirmed safe (parameterized) or refactored — no raw string interpolation touches user/external input
  2. Helius API key never appears in URL query parameters, access logs, or error traces — passed exclusively via Authorization header
  3. Dashboard PATCH /api/config rejects any payload that would produce an invalid TradingConfig after merge — validated against full TradingConfigSchema
  4. `pnpm audit` reports zero high/critical vulnerabilities, and any remaining moderate findings are documented with justification
**Plans:** 3 plans
Plans:
- [ ] 17-01-PLAN.md — ESLint setup with custom security rules + Helius API key migration (SEC-01, SEC-02)
- [ ] 17-02-PLAN.md — Config PATCH endpoint merged validation and cross-field semantic checks (SEC-03)
- [ ] 17-03-PLAN.md — Dependency vulnerability resolution + BUGS.md audit documentation (SEC-04)

### Phase 18: Safety Pipeline Audit & Enhancement
**Goal**: Safety pipeline makes better pass/fail decisions — current accuracy validated against real outcomes, scoring calibrated, and new rug detection checks (liquidity depth, LP lock, metadata mutability) fill identified gaps
**Depends on**: Phase 17 (SEC-02 Helius API key fix touches tier3-creator.ts which this phase also modifies)
**Requirements**: SAF-10, SAF-11, SAF-12, SAF-13, SAF-14
**Success Criteria** (what must be TRUE):
  1. An audit report exists documenting current safety pass/fail rates against actual trade outcomes — false positive and false negative rates quantified
  2. Safety scoring weights and pass threshold are updated based on audit findings — changes validated in dry-run mode before live deployment
  3. Bot rejects tokens with insufficient sell-side liquidity before buying — configurable minimum liquidity threshold enforced
  4. Bot scores LP lock/burn status as a rug risk factor — unlocked liquidity pools penalize the safety score
  5. Bot scores token metadata mutability — mutable metadata penalizes the safety score as a soft rug signal
**Plans**: TBD

### Phase 19: Execution Performance
**Goal**: Bot lands buys with optimal fees and protects against wallet drain — dynamic priority fees replace static fees, compute units are precise, and a balance guard prevents buying below operational minimums
**Depends on**: Phase 18 (better filtering reduces wasted buy attempts that execution optimization would otherwise amplify)
**Requirements**: EXE-10, EXE-11, EXE-12
**Success Criteria** (what must be TRUE):
  1. Bot fetches priority fee estimates from Helius getPriorityFeeEstimate and uses them for buy and sell transactions — no more static priority fee values
  2. Bot sets compute unit limits via ComputeBudgetProgram on every transaction — reduced per-transaction cost compared to default 200K CU
  3. Bot checks wallet SOL balance before every buy attempt — skips buy and logs warning if balance is below configurable minimum
**Plans**: TBD

### Phase 20: Reliability & Monitoring
**Goal**: Operator can detect and diagnose silent failures — structured health checks, system alerts on component failures, per-RPC metrics, and automatic log rotation prevent operational blind spots
**Depends on**: Phase 19 (sell ladder events and execution metrics from Phase 19 are bridged to BotEventBus here; infrastructure should stabilize before dashboard exposes it in Phase 21)
**Requirements**: REL-01, REL-02, REL-03, REL-04
**Success Criteria** (what must be TRUE):
  1. GET /api/health returns structured JSON with status of detection feeds, RPC connections, safety pipeline, and execution engine — each component reports healthy/degraded/down
  2. Bot emits SYSTEM_ALERT events via BotEventBus when detection disconnects, API calls fail repeatedly, or rate limits activate — alerts are observable in SSE stream
  3. Bot tracks per-RPC-endpoint latency (p50, p99) and error rates — data accessible via API for dashboard consumption
  4. Log files rotate automatically based on configurable size and time limits — no unbounded log growth on VPS
**Plans**: TBD

### Phase 21: Dashboard Overhaul
**Goal**: Dashboard provides full operational visibility and control — analytics for performance tuning, live safety pipeline view for threshold calibration, operational controls for incident response, and system status for infrastructure monitoring
**Depends on**: Phase 20 (consumes /api/health endpoint, SYSTEM_ALERT events, RPC metrics, and all new event types from Phases 18-20)
**Requirements**: DASH-07, DASH-08, DASH-09, DASH-10
**Success Criteria** (what must be TRUE):
  1. Dashboard displays equity curve chart, win/loss ratio, and per-source (Pump.fun vs Raydium) P&L breakdown — data derived from existing trade history
  2. Dashboard shows live safety pipeline decisions with per-check pass/fail detail for each token evaluated — visible in real-time via SSE
  3. User can pause/resume detection, force-sell any open position, and trigger emergency stop from the dashboard — all controls confirmed working with appropriate safety guards
  4. Dashboard shows system status panel with per-RPC health indicators, rate limit status, and scrollable alert history
**Plans**: TBD
**UI hint**: yes

## Progress

**Execution Order:**
Phases execute in numeric order: 17 -> 18 -> 19 -> 20 -> 21

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Foundation & Operations | v1.0 | 2/2 | Complete | 2026-02-20 |
| 2. Token Detection | v1.0 | 2/2 | Complete | 2026-02-22 |
| 3. Safety Pipeline | v1.0 | 3/3 | Complete | 2026-02-27 |
| 4. Trade Persistence | v1.0 | 2/2 | Complete | 2026-02-27 |
| 5. Execution Engine | v1.0 | 4/4 | Complete | 2026-02-27 |
| 6. Crash Recovery | v1.0 | 2/2 | Complete | 2026-02-27 |
| 7. Position Management | v1.0 | 3/3 | Complete | 2026-02-27 |
| 8. Web Dashboard | v1.0 | 5/5 | Complete | 2026-02-27 |
| 9. Fix broken Jupiter API | v1.0 | 2/2 | Complete | 2026-03-02 |
| 10. Fix mint issues | v1.0 | 2/2 | Complete | 2026-03-04 |
| 11. Fix bonding curve issue | v1.0 | 1/1 | Complete | 2026-03-04 |
| 12. Dry run functionality | v1.0 | 2/2 | Complete | 2026-03-08 |
| 13. UI rework | v1.0 | 5/5 | Complete | 2026-03-08 |
| 14. Sell price bug fixes | v1.0 | 3/3 | Complete | 2026-03-22 |
| 15. Live Config Hot-Reload Fix | v1.0 | 3/3 | Complete | 2026-03-23 |
| 16. SELL_PARTIAL + Traceability | v1.0 | 1/1 | Complete | 2026-03-23 |
| 17. Security Fixes | v1.1 | 3/3 | In Progress | - |
| 18. Safety Pipeline Audit & Enhancement | v1.1 | 0/? | Not started | - |
| 19. Execution Performance | v1.1 | 0/? | Not started | - |
| 20. Reliability & Monitoring | v1.1 | 0/? | Not started | - |
| 21. Dashboard Overhaul | v1.1 | 0/? | Not started | - |
