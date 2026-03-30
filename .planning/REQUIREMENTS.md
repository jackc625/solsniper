# Requirements: SolSniper

**Defined:** 2026-03-27
**Core Value:** Land buy transactions in the first block on new token launches while filtering out scams — speed and safety together.

## v1.1 Requirements

Requirements for the hardening & polish milestone. Each maps to roadmap phases.

### Security Hardening

- [x] **SEC-01**: SQL injection risk in trade-store.ts audited and either fixed or documented as safe
- [x] **SEC-02**: Helius API key passed via Authorization header instead of URL query parameter
- [x] **SEC-03**: Dashboard config PATCH endpoint validates merged result against full TradingConfigSchema before applying
- [x] **SEC-04**: All high/moderate dependency vulnerabilities resolved or documented with justification

### Safety Pipeline

- [ ] **SAF-10**: Current safety pipeline pass/fail rates audited against real trade outcomes to identify false positives and false negatives
- [x] **SAF-11**: Safety scoring weights and thresholds calibrated based on audit findings
- [x] **SAF-12**: Bot checks liquidity depth before buying — rejects tokens with insufficient sell-side liquidity
- [x] **SAF-13**: Bot checks whether liquidity pool is locked or burned — unlocked LP scored as rug risk
- [x] **SAF-14**: Bot checks token metadata mutability — mutable metadata scored as soft rug signal

### Execution Performance

- [x] **EXE-10**: Bot uses dynamic priority fees via Helius getPriorityFeeEstimate instead of static fees
- [x] **EXE-11**: Bot sets precise compute unit limits via ComputeBudgetProgram to reduce per-transaction cost
- [ ] **EXE-12**: Bot checks wallet SOL balance before buying — skips buy if below configurable minimum

### Reliability & Monitoring

- [ ] **REL-01**: /api/health endpoint returns structured status of all components (detection, RPC, safety, execution)
- [ ] **REL-02**: Bot emits SYSTEM_ALERT events when detection disconnects, APIs fail, or rate limits activate
- [ ] **REL-03**: Bot tracks per-RPC-connection latency and error rates
- [ ] **REL-04**: Log files rotate automatically by size/time to prevent disk fill

### Dashboard

- [ ] **DASH-07**: Dashboard shows equity curve, win/loss ratio, and per-source P&L breakdown
- [ ] **DASH-08**: Dashboard shows live safety pipeline decisions with per-check detail for each token evaluated
- [ ] **DASH-09**: User can pause/resume detection, force-sell positions, and emergency stop from dashboard
- [ ] **DASH-10**: Dashboard shows system status panel with RPC health, rate limit indicators, and alert history

## Future Requirements

Deferred to v1.2+. Tracked but not in current roadmap.

### Advanced Safety

- **SAF-15**: Holder cluster analysis detects wallets funded from same source (sybil detection)
- **SAF-16**: Token age signal scores tokens based on time since creation

### Advanced Execution

- **EXE-13**: Adaptive sell timing with momentum awareness (hold longer in strong uptrends)
- **EXE-14**: Dynamic Jito tip amounts based on network congestion
- **EXE-15**: Transaction simulation before broadcast for late sell ladder steps

### Advanced Reliability

- **REL-05**: Adaptive position polling intervals based on price volatility and hold duration

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Social media sentiment analysis | Adds latency incompatible with first-block goal; unreliable signal |
| AI/ML token scoring | Unreliable for memecoin timeframes; rule-based scoring is more interpretable |
| Multi-wallet rotation | Adds complexity without clear benefit for personal tool |
| Copy trading | By the time you detect and execute, price has already moved |
| gRPC/Yellowstone migration | Current WebSocket approach works; migration risk outweighs marginal latency gain |
| Backtesting engine | Survivorship-biased; use dry-run mode on mainnet instead |
| Telegram bot interface | Web dashboard covers control and alerts |
| Holder cluster analysis | High complexity, needs careful latency management — deferred to v1.2 |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| SEC-01 | Phase 17 | Complete |
| SEC-02 | Phase 17 | Complete |
| SEC-03 | Phase 17 | Complete |
| SEC-04 | Phase 17 | Complete |
| SAF-10 | Phase 18 | Pending |
| SAF-11 | Phase 18 | Complete |
| SAF-12 | Phase 18 | Complete |
| SAF-13 | Phase 18 | Complete |
| SAF-14 | Phase 18 | Complete |
| EXE-10 | Phase 19 | Complete |
| EXE-11 | Phase 19 | Complete |
| EXE-12 | Phase 19 | Pending |
| REL-01 | Phase 20 | Pending |
| REL-02 | Phase 20 | Pending |
| REL-03 | Phase 20 | Pending |
| REL-04 | Phase 20 | Pending |
| DASH-07 | Phase 21 | Pending |
| DASH-08 | Phase 21 | Pending |
| DASH-09 | Phase 21 | Pending |
| DASH-10 | Phase 21 | Pending |

**Coverage:**
- v1.1 requirements: 20 total
- Mapped to phases: 20
- Unmapped: 0

---
*Requirements defined: 2026-03-27*
*Last updated: 2026-03-27 after roadmap creation*
