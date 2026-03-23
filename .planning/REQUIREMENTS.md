# Requirements: SolSniper

**Defined:** 2026-02-20
**Core Value:** Land buy transactions in the first block on new token launches while filtering out scams — speed and safety together.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Detection

- [x] **DET-01**: Bot detects new token creation on Pump.fun via PumpPortal WebSocket in real-time
- [x] **DET-02**: Bot detects new Raydium pool creation via Solana RPC logsSubscribe
- [x] **DET-03**: WebSocket connections auto-reconnect with exponential backoff on disconnect
- [x] **DET-04**: WebSocket wrapper detects silent connection death via heartbeat pings (15-30s interval)
- [x] **DET-05**: Bot logs every reconnection event with counter and alerts on excessive reconnections

### Safety

- [x] **SAF-01**: Bot checks mint authority is null (revoked) before buying — hard block if present
- [x] **SAF-02**: Bot checks freeze authority is null before buying — hard block if present
- [x] **SAF-03**: Bot validates sell route exists via Jupiter quote simulation — hard block if no route
- [x] **SAF-04**: All Tier 1 checks (SAF-01, SAF-02, SAF-03) run in parallel via Promise.all, completing in <300ms
- [x] **SAF-05**: Bot queries RugCheck.xyz API for token safety scoring (Tier 2, non-blocking)
- [x] **SAF-06**: Bot checks top holder concentration via getTokenLargestAccounts (Tier 2, async)
- [x] **SAF-07**: Bot analyzes creator wallet history for prior rugs via Helius parsed TX API (Tier 3, async)
- [x] **SAF-08**: Bot computes aggregate safety score from all check results
- [x] **SAF-09**: Bot enforces configurable minimum safety score threshold before buying

### Execution

- [x] **EXE-01**: Bot executes buy via Jupiter Swap API with dynamic slippage
- [x] **EXE-02**: Bot executes buy via PumpPortal trade-local API for bonding curve tokens
- [x] **EXE-03**: Bot automatically selects Jupiter or PumpPortal based on token state (bonding curve vs migrated)
- [x] **EXE-04**: Bot fetches blockhash as the last step before signing (never before safety checks)
- [x] **EXE-05**: Bot sends transactions to multiple RPC providers simultaneously for better landing rate
- [x] **EXE-06**: Sell escalation ladder retries with increasing aggression: standard → high fee → Jito bundle → chunked sell → emergency
- [x] **EXE-07**: Bot constructs and submits Jito bundles for MEV-protected sell execution
- [x] **EXE-08**: Bot refreshes blockhash on every retry attempt
- [x] **EXE-09**: Emergency sell mode uses maximum slippage (49%) for capital recovery

### Position Management

- [x] **POS-01**: Bot monitors active positions by polling Jupiter quotes at configurable intervals
- [x] **POS-02**: Bot automatically sells when position drops below configurable stop-loss threshold
- [x] **POS-03**: Bot automatically sells when position reaches configurable take-profit target
- [x] **POS-04**: Bot supports tiered take-profit (e.g., sell 33% at 2x, 33% at 5x, rest at 10x)
- [x] **POS-05**: Bot supports trailing stop-loss that follows price upward and sells on reversal
- [x] **POS-06**: Bot enforces configurable maximum concurrent position limit

### Persistence

- [x] **PER-01**: All trades persist to SQLite with full state machine (DETECTED → BUYING → MONITORING → SELLING → COMPLETED)
- [x] **PER-02**: Bot writes PENDING entry to SQLite before sending any buy transaction (write-ahead)
- [x] **PER-03**: Bot resumes pending trades from SQLite on restart (crash recovery)
- [x] **PER-04**: Bot maintains in-memory Set of active buy intents to prevent duplicate concurrent buys
- [x] **PER-05**: On restart, bot reconciles PENDING entries against on-chain wallet token accounts

### Operations

- [x] **OPS-01**: Bot uses structured JSON logging via pino with trade IDs threading all related log entries
- [x] **OPS-02**: Bot logs latency for every significant operation (detection, safety checks, transaction send, confirmation)
- [x] **OPS-03**: RPC manager supports primary + backup providers with automatic failover
- [x] **OPS-04**: Bot loads wallet private key from environment variable, never logs it
- [x] **OPS-05**: Bot handles graceful shutdown on SIGTERM/SIGINT (close WebSockets, flush logs, persist state)
- [x] **OPS-06**: Configuration loaded from .env file with validation via zod at startup

### Dashboard

- [x] **DASH-01**: Web dashboard displays real-time trade feed (snipes, buys, sells) via SSE
- [x] **DASH-02**: Web dashboard shows per-trade P&L (entry price, current price, profit/loss)
- [x] **DASH-03**: Web dashboard shows overall portfolio performance (total P&L, win rate, trade count)
- [x] **DASH-04**: Web dashboard provides UI to adjust safety filter thresholds without bot restart
- [x] **DASH-05**: Web dashboard provides UI to adjust buy amount and position limits without bot restart
- [x] **DASH-06**: Dashboard runs as in-process HTTP server (Express/Fastify), not a separate service

### Dry Run

- [x] **DRY-01**: Bot supports a `dryRun` config flag that runs the full mainnet pipeline (detection, safety, transaction building) but intercepts before signing/broadcasting
- [x] **DRY-02**: Dry-run buy interception occurs at `broadcastAndConfirm()` (Gate 1), returning a synthetic BroadcastResult with placeholder signature
- [x] **DRY-03**: Dry-run sell interception occurs at `jitoSell()` (Gate 2), preventing Jito bundle submission
- [x] **DRY-04**: Dry-run trades persist to SQLite with `dry_run=1` column and follow the full state machine (BUYING -> MONITORING -> SELLING -> COMPLETED)
- [x] **DRY-05**: Dry-run trades enter PositionManager for shadow price tracking via Jupiter quote polling, showing what P&L would have been
- [x] **DRY-06**: Crash recovery skips dry-run trades on restart (shadow tracking is ephemeral within a session)
- [x] **DRY-07**: Dashboard displays dry-run trades inline in Live Feed with a DRY RUN badge and shows a prominent mode banner when dry-run is enabled
- [x] **DRY-08**: Dashboard header stats (total P&L, win rate, trade count) exclude dry-run trades; `dryRun` is toggleable from Settings

### UI

- [x] **UI-01**: Dashboard uses sidebar + content layout (replacing horizontal tabs) with fixed sidebar navigation for Feed, Performance, and Settings views
- [x] **UI-02**: Live Feed displays rich expandable cards with token mint (clickable Solscan/pump.fun links), safety score, source badge, buy amount, P&L, event type badge, and timestamp
- [x] **UI-03**: Performance view includes P&L chart over time (lightweight-charts), win rate visualization, and sortable completed trade history table
- [x] **UI-04**: Trade history table shows per-trade breakdown: entry price, exit price, duration held, P&L in SOL
- [x] **UI-05**: Dashboard uses an industrial/utilitarian trading terminal aesthetic (amber primary, Share Tech Mono + Rajdhani fonts, dark theme)
- [x] **UI-06**: Sidebar collapses responsively at 1024px breakpoint via CSS custom property override

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Dashboard

- **DASH-07**: Web dashboard shows wallet balances and token positions
- **DASH-08**: Web dashboard supports fund/withdraw operations

### Execution Optimization

- **OPT-01**: Direct Pump.fun program calls (bypass 0.5% PumpPortal fee)
- **OPT-02**: Geyser gRPC detection for sub-50ms latency
- **OPT-03**: Congestion-aware priority fee adaptation based on recent block success rates

### Safety Enhancement

- **SAF-10**: LP burn/lock verification
- **SAF-11**: Metadata mutability check (isMutable flag)

### Operations Enhancement

- **OPS-07**: Telegram/Discord alerts for critical events (stuck position, daily loss exceeded)
- **OPS-08**: PM2 process management for production deployment

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Social presence filtering (Twitter/Telegram) | Adds 2-10 seconds latency, incompatible with first-block goal |
| Multi-user support / auth system | Personal tool — transforms focused bot into SaaS platform |
| AI/ML token scoring | Unreliable for memecoin timeframes; rule-based scoring is more interpretable |
| Copy trading (follow-wallet sniping) | By the time you detect and execute, price has already moved |
| Backtesting | Survivorship-biased and misleading; use simulation mode on mainnet instead |
| Mobile app | Web dashboard is sufficient for personal use |
| Telegram bot interface | Web dashboard covers control and monitoring |
| Devnet testing | Devnet gives false confidence — no real DEXs, liquidity, or competition |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| DET-01 | Phase 2 | Complete |
| DET-02 | Phase 2 | Complete |
| DET-03 | Phase 2 | Complete |
| DET-04 | Phase 2 | Complete |
| DET-05 | Phase 2 | Complete |
| SAF-01 | Phase 3 | Complete |
| SAF-02 | Phase 3 | Complete |
| SAF-03 | Phase 3 | Complete |
| SAF-04 | Phase 3 | Complete |
| SAF-05 | Phase 3 | Complete |
| SAF-06 | Phase 3 | Complete |
| SAF-07 | Phase 3 | Complete |
| SAF-08 | Phase 3 | Complete |
| SAF-09 | Phase 3 | Complete |
| EXE-01 | Phase 5 | Complete |
| EXE-02 | Phase 5 | Complete |
| EXE-03 | Phase 5 | Complete |
| EXE-04 | Phase 5 | Complete |
| EXE-05 | Phase 5 | Complete |
| EXE-06 | Phase 5 | Complete |
| EXE-07 | Phase 5 | Complete |
| EXE-08 | Phase 5 | Complete |
| EXE-09 | Phase 5 | Complete |
| POS-01 | Phase 7 | Complete |
| POS-02 | Phase 7 | Complete |
| POS-03 | Phase 7 | Complete |
| POS-04 | Phase 7 | Complete |
| POS-05 | Phase 7 | Complete |
| POS-06 | Phase 7 | Complete |
| PER-01 | Phase 4 | Complete |
| PER-02 | Phase 4 | Complete |
| PER-03 | Phase 6 | Complete |
| PER-04 | Phase 4 | Complete |
| PER-05 | Phase 6 | Complete |
| OPS-01 | Phase 1 | Complete |
| OPS-02 | Phase 1 | Complete |
| OPS-03 | Phase 1 | Complete |
| OPS-04 | Phase 1 | Complete |
| OPS-05 | Phase 1 | Complete |
| OPS-06 | Phase 1 | Complete |
| DASH-01 | Phase 8 | Complete |
| DASH-02 | Phase 8 | Complete |
| DASH-03 | Phase 8 | Complete |
| DASH-04 | Phase 15 | Complete |
| DASH-05 | Phase 15 | Complete |
| DASH-06 | Phase 8 | Complete |
| DRY-01 | Phase 12 | Complete |
| DRY-02 | Phase 12 | Complete |
| DRY-03 | Phase 12 | Complete |
| DRY-04 | Phase 12 | Complete |
| DRY-05 | Phase 12 | Complete |
| DRY-06 | Phase 12 | Complete |
| DRY-07 | Phase 12 | Complete |
| DRY-08 | Phase 12 | Complete |
| UI-01 | Phase 13 | Complete |
| UI-02 | Phase 13 | Complete |
| UI-03 | Phase 13 | Complete |
| UI-04 | Phase 13 | Complete |
| UI-05 | Phase 13 | Complete |
| UI-06 | Phase 13 | Complete |

**Coverage:**
- v1 requirements: 60 total (46 original + 8 DRY + 6 UI)
- Mapped to phases: 60
- Unmapped: 0
- Pending: 0

---
*Requirements defined: 2026-02-20*
*Last updated: 2026-03-23 after Phase 16 (Dry Run and UI definitions backfilled)*
