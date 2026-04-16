# SolSniper — README Research Document

**Gathered:** 2026-04-16 via full codebase inspection. Every fact below is backed by a specific file and line range read during this session. No claims are sourced from the existing README.md.

---

## 1. Product Summary

SolSniper is an autonomous Solana token-sniping bot. It subscribes to pump.fun new-token creation events (via PumpPortal WebSocket) and Raydium V4 / PumpSwap pool creation events (via Solana `onLogs`), runs a three-tier safety analysis pipeline to filter rugs and scams in real-time, executes buy transactions within the first block of detection, and manages open positions through configurable exit triggers (tiered take-profit, trailing stop, stop-loss, max hold time). When exiting a position, it escalates through a 6-step sell ladder ending at 49% slippage + Jito MEV bundles to guarantee capital recovery. The entire system is observable and controllable through an in-process Fastify HTTP server serving a Preact single-page dashboard.

Target audience: solo or small-team algorithmic traders running the bot on a personal server.

---

## 2. Stack & Versions

Source: `package.json` and `tsconfig.json`.

| Layer | Technology | Version |
|---|---|---|
| Language | TypeScript | 5.9.3 |
| Module system | ESM (Node16 resolution) | — |
| Package manager | pnpm | 10.14.0 |
| Dev runner | tsx | 4.21.0 |
| Test framework | Vitest | 4.0.18 |
| Database | better-sqlite3 | 12.6.2 |
| HTTP server | Fastify | 5.8.4 |
| SSE | @fastify/sse | 0.4.0 |
| Static files | @fastify/static | 9.0.0 |
| CORS | @fastify/cors | 11.2.0 |
| Solana SDK | @solana/web3.js | 1.98.4 |
| SPL Token | @solana/spl-token | 0.4.14 |
| Schema validation | Zod | 4.3.6 |
| Structured logging | pino | 10.3.1 |
| Log rotation | pino-roll | 4.0.0 |
| Dashboard framework | Preact | 10.28.4 |
| Reactive state | @preact/signals | 2.8.1 |
| Dashboard build | Vite + @preact/preset-vite | 7.3.1 / 2.10.5 |
| WebSocket client | ws | 8.19.0 |
| Event bus | eventemitter3 | 5.0.4 |
| Charts | lightweight-charts | 5.1.0 |
| Base58 | bs58 | 6.0.0 |
| JSONC parsing | strip-json-comments | 5.0.3 |

TypeScript target: ES2022. Strict mode enabled. `resolveJsonModule: true`.

External APIs: PumpPortal WebSocket (`wss://pumpportal.fun/api/data`), Jupiter Swap API v1 (`https://api.jup.ag/swap/v1`, API key required), Helius RPC (`getPriorityFeeEstimate` JSON-RPC), Helius Enhanced Transactions API (creator history, optional), RugCheck API (`https://api.rugcheck.xyz/v1/tokens`, optional), Jito block engine (`https://mainnet.block-engine.jito.wtf/api/v1/bundles`).

---

## 3. Top-Level Architecture

Eight major subsystems, initialized in strict dependency order in `src/index.ts`.

- **Config** (`src/config/`): `env.ts` validates all env vars at module load via Zod and calls `process.exit(1)` on failure. `trading.ts` reads `config.jsonc` (comments stripped), validates via Zod, and exposes a runtime-mutable shadow config via `patchRuntimeConfig()`.

- **Detection** (`src/detection/`): `DetectionManager` orchestrates `PumpPortalListener` (ResilientWebSocket subclass) and `RaydiumListener` (onLogs). Mint-level deduplication (Map with hourly eviction). Pre-filter drops obvious junk tokens. Emits `TokenEvent` on the event loop.

- **Safety pipeline** (`src/safety/`): `SafetyPipeline.evaluate()` runs three tiers in order — Tier 1 (hard blocks, parallel `Promise.all`), Tier 2+3 (scoring, concurrent `Promise.allSettled` with `AbortSignal` timeout). Results cached per mint. Emits `SAFETY_EVALUATION` SSE event for every non-cached evaluation.

- **Execution** (`src/execution/`): `ExecutionEngine` routes buys by source. `SellLadder` orchestrates the 6-step escalation. `JupiterClient` singleton handles all Jupiter API calls with global rate-limit cooldown. `broadcastAndConfirm` handles blockhash-last signing and parallel multi-RPC broadcast.

- **Position management** (`src/position/`): `PositionManager` polls Jupiter quotes for all MONITORING positions, evaluates exit triggers, and fires `SellLadder.sell()` as fire-and-forget. Uses recursive `setTimeout`.

- **Persistence** (`src/persistence/`): `TradeStore` is SQLite in WAL mode. All SQL statements pre-compiled at construction. In-memory `Set<string>` for O(1) duplicate-guard, rebuilt from DB on startup. `AlertStore` shares the same DB connection.

- **Crash recovery** (`src/recovery/`): `RecoveryManager.run()` reconciles in-flight trades against on-chain state. Blocks startup until complete; DetectionManager does not start until recovery finishes.

- **Dashboard** (`src/dashboard/`, `dashboard/`): Fastify 5 HTTP server serving a pre-built Preact SPA and 7 REST route files. Real-time events via SSE endpoint (`/events`). `botEventBus` (eventemitter3 singleton) connects internal state to SSE clients.

- **Monitoring** (`src/monitoring/`): `HealthService` aggregates 5 component health providers, detects status transitions, emits cooldown-debounced alerts. `MetricsTracker` tracks p50/p99 latency and error rates per API endpoint in a 5-minute sliding window.

---

## 4. Feature Inventory

### Token Detection

What it does: Subscribes to new token events from PumpPortal (WebSocket, pump.fun bonding curve launches) and Raydium V4 / PumpSwap (Solana `onLogs` for `initialize2` / `CreatePool` log strings). Deduplicates by mint address. Pre-filters name/symbol against spam keywords, impersonation targets, and length bounds.

Key files:
- `src/detection/detection-manager.ts:36` — orchestrator; dedup Map eviction at stats interval (15 min default); stats logging
- `src/detection/pump-portal-listener.ts:24` — extends `ResilientWebSocket`; subscribes `{ method: 'subscribeNewToken' }` on each connect; stamps `detectedAt = Date.now()` before parsing
- `src/detection/raydium-listener.ts:38` — single `onLogs` subscription covering Raydium V4 program `675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8` and PumpSwap program `pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA`; health-check recreates subscription after 2 min silence
- `src/detection/pre-filter.ts:24` — rejects: name < 2 or > 30 chars; symbol < 1 or > 12 chars; spam keywords (`FREE`, `AIRDROP`, etc.); impersonation of 11 known tokens (SOL, USDC, USDT, BONK, WIF, etc.)
- `src/core/resilient-ws.ts:15` — abstract base: exponential backoff (3s→60s, 15% jitter), 30s heartbeat with 2x silence termination, excessive-reconnect sliding-window alerting (5 reconnects in 10 min)

Notable: PumpPortal WebSocket carries rich metadata (creator wallet, bonding curve key, initial buy, reserves) embedded directly in the `TokenEvent`, enabling downstream checks without additional RPC calls.

### Three-Tier Safety Pipeline

What it does: Evaluates every `TokenEvent` through 8 distinct checks organized in priority tiers. Returns a `SafetyResult` with aggregate score 0–100 and pass/fail decision.

Key files:
- `src/safety/safety-pipeline.ts:43` — orchestrator; handles all 4 exit paths (Tier 1 reject, soft block, score reject, pass); emits `SAFETY_EVALUATION` event on every path
- `src/safety/checks/tier1-authority.ts:48` — `getAccountInfo` + `unpackMint`; detects TOKEN vs TOKEN_2022 by `info.owner`; returns detected `programId` for downstream use; 2 retries for account-not-found race on new mints
- `src/safety/checks/tier1-sell-route.ts:21` — Jupiter quote check; skipped for pumpportal source (new mints not yet indexed); pessimistic on any error
- `src/safety/checks/tier1-liquidity.ts:36` — bonding curve PDA derivation (pump.fun program `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P`); validates IDL discriminator at offset 0 before reading `realSolReserves` at offset `0x20`; pool quote vault SOL for Raydium; neutral pass for PumpSwap (layout unknown)
- `src/safety/checks/tier2-rugcheck.ts:58` — RugCheck API `score_normalised` inverted to safety score; returns tuple `[CheckResult, RugCheckResultData | null]` so `lpLockedPct` can override LP lock result
- `src/safety/checks/tier2-holder.ts:46` — `getTokenLargestAccounts` (top 20) + owner resolution; excludes system/program accounts and pump.fun bonding curve PDA; top-1 > 25% or top-10 > 50% = soft block
- `src/safety/checks/tier2-lp-lock.ts` — UNCX locker (`GsSCS3vPWrtJ5Y9aEVVT65fmrex5P5RGHXdZvsdbWgfo`) and incinerator (`1nc1nerator11111111111111111111111111111111`) recognition; overridden by RugCheck `lpLockedPct` in pipeline orchestrator
- `src/safety/checks/tier2-metadata.ts:22` — Metaplex PDA derivation; reads `isMutable` flag; penalty applied by orchestrator
- `src/safety/checks/tier3-creator.ts:98` — Helius DAS API `TOKEN_MINT` transaction count; serial deployer heuristic: 0-1 mints=80, 2-3=50, 4-9=20, 10+=hard reject; auto-adds serial deployers to blocklist
- `src/safety/blocklist.ts:9` — JSON file-backed persistent blocklist (`data/creator-blocklist.json`); fast-path check before any Helius API call

Scoring formula: `aggregateScore = round((rugScore/100)*wRug + (holderScore/100)*wHolder + (creatorScore/100)*wCreator)`. Then flat penalties: `-lpLockPenalty` if `lpLockScore=0`, `-metadataPenalty` if `metadataScore=0`. Default weights (from `config.jsonc`): rug=50, holder=25, creator=25. Default penalties: lpLock=30, metadata=15.

### Dynamic Fee Estimation

What it does: Fetches Helius `getPriorityFeeEstimate` (VeryHigh priority level) with 5-second TTL cache. Converts `microlamportsPerCU * 200_000 CU / 1_000_000` to total lamports, capped at `maxPriorityFeeCapLamports`. Falls back to `priorityFeeBaseLamports * priorityFeeMultiplier` from config on failure.

Key file: `src/core/fee-estimator.ts:19`

Notable: Circuit breaker activates after `apiFailureThreshold` consecutive failures (default 5); enters 30s cooldown during which all calls get the static fallback. Single retry on 429/5xx (respects `retry-after` header). Emits `ApiAlertCallback` for both 429 rate-limit detection and consecutive-failure circuit-breaker events.

### Buy Execution

What it does: Two buy paths depending on `event.source`. Write-ahead record created in SQLite before any on-chain action. No retry on single buy — speed over resilience is the explicit design choice.

Key files:
- `src/execution/execution-engine.ts:60` — routing, dry-run token estimation from constant-product AMM formula
- `src/execution/buy/pump-portal-buyer.ts:33` — PumpPortal trade-local API; raw bytes response (`arrayBuffer()`); slippage in percent not bps
- `src/execution/buy/jupiter-buyer.ts` — Jupiter quote + swap; `broadcastWithRetry`
- `src/execution/broadcaster.ts:49` — `broadcastAndConfirm`: blockhash fetched immediately before `tx.sign([wallet])`; `sendRawTransaction` to all connections via `Promise.allSettled`; `broadcastWithRetry` checks prior-attempt signatures via `getSignatureStatuses` between retries to detect late landings

### Sell Escalation Ladder

What it does: 6-step time-based escalation. Each step is wrapped in `Promise.race` against a per-step timeout. Advancement happens on timeout regardless of failure type.

Step sequence (`src/execution/sell/sell-ladder.ts:118–176`):

| Step | File | Key params (defaults from config.jsonc) |
|---|---|---|
| STANDARD | `standard-seller.ts` | slippage=1000bps, fee=1x, timeout=30s |
| HIGH_FEE | `standard-seller.ts` | slippage=1000bps, fee=3x, timeout=20s |
| JITO_BUNDLE | `jito-seller.ts` | tip=100000 lamports, timeout=30s |
| CHUNKED | `chunked-seller.ts` | 3 tranches, timeout=60s |
| PUMPPORTAL | `pump-portal-seller.ts` | only if pumpportal source + JupiterRouteError |
| EMERGENCY | `standard-seller.ts` | slippage=4900bps (49%), fee=10x, timeout=30s |

Before each run, SellLadder re-queries the on-chain token balance via `getParsedTokenAccountsByOwner(wallet, { mint })` to use a fresh balance rather than the (potentially stale) DB value. If on-chain balance is 0, immediately transitions to COMPLETED.

Partial sells (tiered TP): `sell(mint, tokens, partial=true)` transitions `SELLING → MONITORING` and decrements `amount_tokens` in the DB via `decrementTokenAmount()`. `sell_price_sol` is accumulated via `addSellPrice()` (SQL `COALESCE + delta`) making it crash-safe.

### Position Management

What it does: Polls Jupiter quotes for all MONITORING positions on a recursive `setTimeout` loop. Exit triggers evaluated in priority order: tiered TP → trailing stop → stop-loss → max hold time.

Key file: `src/position/position-manager.ts:41`

Default config (from `config.jsonc`): poll every 4s; stop-loss at -50%; tiered TP at 2x (33%), 5x (33%), 10x (34%); trailing stop at 20%; max hold time 120s.

Notable: `calcTieredTpTokens` uses `bigint` arithmetic throughout to avoid `Number.MAX_SAFE_INTEGER` overflow. When `JupiterClient.cooldownRemainingMs() > 0`, poll interval is stretched by that amount to yield rate budget. Per-mint high-watermark, tier-index, and last-known-quote are cleaned up in `fireSell().finally()` on full (non-partial) sells to prevent memory leak.

### Dashboard & Controls

What it does: In-process Fastify 5 HTTP server on `127.0.0.1:DASHBOARD_PORT`. Serves a pre-built Preact SPA from `dashboard/dist/`. Pushes real-time events via SSE (`/events`). Provides REST API for read access and write controls.

Key files:
- `src/dashboard/dashboard-server.ts:29` — Fastify setup, SSE plugin, CORS (Vite dev server in dev only), SPA static serving, SPA fallback
- `src/dashboard/bot-event-bus.ts:1` — eventemitter3 singleton with 14 typed event types
- `src/dashboard/routes/controls.ts:15` — pause/resume detection, force-sell by trade ID, emergency stop (pauses detection + force-sells all MONITORING)
- `src/dashboard/routes/config.ts:70` — GET/POST config; 3-layer validation: Zod shape check → full TradingConfigSchema → semantic cross-field checks (tiered TP sum ≤ 100, weight sum = 100)
- `dashboard/src/app.tsx:54` — emergency stop requires typing "STOP" in dialog

Dashboard views: LiveFeed (SSE event stream), Performance (trade history, P&L), Pipeline (safety evaluation detail), Controls (force-sell, detection toggle, emergency stop), SystemStatus (health + metrics + alerts), Settings (runtime config edit).

### Crash Recovery

What it does: Reconciles in-flight trades against Solana wallet state at startup. Blocks `DetectionManager.start()` until complete.

Decision table (`src/recovery/recovery-manager.ts:9–18`):
- DETECTED → FAILED (no capital at risk)
- BUYING, balance > 0 → MONITORING (buy landed)
- BUYING, balance = 0 → FAILED (buy did not land)
- SELLING, balance > 0 → step back to MONITORING, fire SellLadder
- SELLING, balance = 0 → COMPLETED (sell assumed landed)
- Multiple SELLING rows per mint → keep most recent by `updated_at DESC`, FAILED for stale
- Dry-run any state → ABANDONED
- MONITORING → loaded as-is (no wallet check needed)

---

## 5. Data Model / Schema

Source: `src/persistence/schema.ts`

### `trades` table

```sql
CREATE TABLE trades (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  mint              TEXT    NOT NULL,
  state             TEXT    NOT NULL,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,
  buy_signature     TEXT,
  sell_signature    TEXT,
  amount_sol        REAL,
  amount_tokens     REAL,
  buy_price_sol     REAL,
  sell_price_sol    REAL,        -- accumulated via addSellPrice() for tiered TP
  error_message     TEXT,
  source            TEXT,        -- 'pumpportal' | 'raydium' | 'pumpswap'
  token_program_id  TEXT,        -- base58 pubkey: TOKEN or TOKEN_2022
  -- migration columns:
  dry_run           INTEGER,     -- 0 or 1
  safety_score      INTEGER,     -- 0–100 aggregate score at buy time
  safety_rejection_reasons TEXT, -- JSON array
  safety_checks_detail TEXT      -- JSON {tier1: [...], tier2: [...], tier3: [...]}
);
CREATE INDEX idx_trades_mint_state ON trades (mint, state);
```

TradeState lifecycle: `DETECTED → BUYING → MONITORING → SELLING → COMPLETED | FAILED | ABANDONED`

### `alerts` table

```sql
CREATE TABLE alerts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp  INTEGER NOT NULL,
  type       TEXT    NOT NULL,
  severity   TEXT    NOT NULL,
  source     TEXT    NOT NULL,
  message    TEXT    NOT NULL
);
CREATE INDEX idx_alerts_timestamp ON alerts (timestamp DESC);
CREATE INDEX idx_alerts_source ON alerts (source);
```

### Migration strategy

`MIGRATION_SQL` (`schema.ts:27`) is an array of `ALTER TABLE` statements. Each executes in a try/catch; `column already exists` errors are silently swallowed. Fresh databases have all columns from `SCHEMA_SQL`. This is additive-only; no destructive migrations exist.

### WAL mode

Enabled via `db.pragma('journal_mode = WAL')` for file-backed databases. Skipped for `:memory:` (used in tests) because SQLite silently reverts WAL on in-memory databases.

---

## 6. Data Flow / Pipeline (End-to-End Snipe)

Concrete function/file references for the happy path (pumpportal token, passes all checks, hits 2x tier):

1. **`PumpPortalListener.onMessage()`** (`src/detection/pump-portal-listener.ts`) — captures `detectedAt`, parses JSON, emits `TokenEvent { mint, source: 'pumpportal', creator, vSolInBondingCurve, ... }`

2. **`DetectionManager.handleTokenEvent()`** (`src/detection/detection-manager.ts:142`) — checks `seenMints`, runs `preFilter()`, logs one-liner with `latencyMs`, emits `'token'` event

3. **`index.ts` token handler** (`src/index.ts:332`) — checks: detection paused? active positions >= max? balance guard (SOL check with 5s TTL cache)? If any fail, returns early

4. **`SafetyPipeline.evaluate()`** (`src/safety/safety-pipeline.ts:64`) — cache miss; Tier 1 `Promise.all`; if all pass: Tier 2+3 `Promise.allSettled`; lpLock override; soft block check; aggregate score; threshold check; cache result; emit `SAFETY_EVALUATION`

5. **`tradeStore.createBuyingRecord()`** (`src/persistence/trade-store.ts:196`) — synchronous: Set check + DB insert + Set add atomically; BUYING row with safety metadata written

6. **`executionEngine.buy(event)`** (`src/execution/execution-engine.ts:60`) — emit `BUY_SENT`; `pumpPortalBuy()` → POST to `https://pumpportal.fun/api/trade-local`; raw bytes → `VersionedTransaction.deserialize()` → `broadcastWithRetry()` (blockhash-last sign, parallel RPC broadcast, 3 retries); on success: `tradeStore.transition(mint, 'BUYING', 'MONITORING', { buySignature, amountSol, amountTokens })`; emit `BUY_CONFIRMED`

7. **`PositionManager.tick()`** (`src/position/position-manager.ts:149`) — every 4s: `getMonitoringTrades()` → for this mint: `getPositionValueSol()` → Jupiter quote `outAmount/1e9`; `ratio = currentValueSol / amountSol` reaches 2.0 (2x tier at config `at: 2, pct: 33`)

8. **`PositionManager.fireSell(mint, tokensToSell, partial=true)`** (`src/position/position-manager.ts:403`) — adds to `sellsInFlight`; calls `sellLadder.sell(mint, tokensToSell, lastKnownQuoteSol, partial=true)` fire-and-forget; increments `tierIndices.get(mint)` to 1

9. **`SellLadder.sell()`** (`src/execution/sell/sell-ladder.ts:68`) — `tradeStore.transition(mint, 'MONITORING', 'SELLING')`; re-queries on-chain balance; STANDARD step: `standardSell()` → Jupiter quote + swap via `jupiterClient.quote()`/`jupiterClient.swap()` → `broadcastAndConfirm()`; success: `tradeStore.addSellPrice(mint, solReceived)` (SQL increment); `partial=true`: `tradeStore.transition(mint, 'SELLING', 'MONITORING')`; `tradeStore.decrementTokenAmount(mint, verifiedAmount)`; emit `SELL_PARTIAL`

10. **SSE broadcast** — every `botEventBus.emit('event', ...)` call is forwarded to all connected SSE clients via `eventsRoute` (`src/dashboard/routes/events.ts`)

---

## 7. Safety & Reliability Features

**Tiered check failure semantics:** Tier 1 failures are hard blocks (any failure = immediate reject). Tier 2/3 errors (API timeout, network failure) degrade to `score=0, pass=true` — a pessimistic score that reduces the aggregate without blocking the trade entirely. Only `holder` and `creator` soft-block on `pass=false`, preventing API outages from stopping all trades.

**Duplicate-buy guard:** `TradeStore.activeMints` (in-memory Set) checked and written synchronously in `createBuyingRecord()`. No async gap. Rebuilt from non-terminal DB rows on startup.

**Crash recovery:** `RecoveryManager` runs blocking before detection starts. Per-trade RPC timeout of 5s prevents one slow RPC call from blocking others.

**Sell escalation:** 6 steps provide progressively higher guarantee of exit. EMERGENCY at 49% slippage + 10x priority fee. CHUNKED seller splits into 3 tranches so partial confirms count as capital recovered. PUMPPORTAL step catches tokens that Jupiter cannot route.

**Write-ahead persistence:** BUYING state written to DB before any on-chain action. Recovery can detect if the buy landed by checking wallet balance.

**Optimistic locking:** All `UPDATE trades` statements include `WHERE state = @expectedState`. Zero rows changed = concurrent update won; caller handles this case.

**Force-sell guard:** `PositionManager.sellsInFlight` Set prevents double-sells. Controls API checks `isSellInFlight()` and returns HTTP 409 if already selling.

**RPC failover:** Primary/backup with 3-failure threshold, 10s recovery polling. Buys and sells broadcast to all connections simultaneously.

**Jupiter rate-limit cooldown:** Single 429 from any endpoint triggers global cooldown (respects `retry-after` header, defaults 10s). `PositionManager` stretches poll interval by remaining cooldown duration.

**Per-API circuit breakers:** `FeeEstimator`, `checkRugCheck`, `checkCreatorHistory` each independently track consecutive failures and enter 30s cooldown after `apiFailureThreshold` (default 5). Each emits `ApiAlertCallback` for dashboard visibility.

**Balance guard:** Pre-buy SOL check with 5s TTL cache. `LOW_BALANCE` event emitted for dashboard. Sells are never blocked by balance guard.

**Token-2022 compatibility:** `checkAuthorities` detects program by `info.owner`. Balance queries use `{ mint }` filter (searches all programs, no double-counting). ATA derivation uses stored `tokenProgramId`.

**Secret redaction:** Pino serializers strip `PRIVATE_KEY` and `SECRET` keys from any logged object. RPC URLs have API keys masked before logging.

**Graceful shutdown:** 5s timeout. Order: PositionManager → health interval → dashboard server → RpcManager → DetectionManager → TradeStore → pino flush → `process.exit(0)`.

---

## 8. Operations / Observability

**Logging:** Structured JSON (pino). Development: pino-pretty colorized. Production: pino-roll with daily rotation, configurable size and retention. Every log line includes `{ module }` child binding. Per-trade logs include `{ tradeId }`. Key operations logged at info with `latencyMs`.

**Dashboard SSE event feed:** 14 event types. `SAFETY_EVALUATION` includes full per-check breakdown (source, pass, score, detail, tier label) for every evaluated token. `SYSTEM_ALERT` includes `severity` and `alertSource` for triage.

**Health endpoint** (`GET /api/health`): Returns `{ status: 'healthy'|'degraded'|'down', components: { detection, rpc, safety, execution, apis }, uptime, version, timestamp }`. HTTP 503 when status is `down`.

- `detection`: silent for > 10 min → degraded
- `rpc`: using backup endpoint → degraded
- `safety`: silent for > 10 min → degraded
- `execution`: no activity for > 30 min → degraded
- `apis`: error rate >= 50% → degraded; >= 90% → down (per-endpoint from MetricsTracker)

**Metrics endpoint** (`GET /api/metrics`): p50/p99 latency and error rate per tracked endpoint over the last 5 minutes. Endpoints tracked: `helius:fee-estimate`, `jupiter:quote`, `jupiter:swap`, `pumpportal:buy`, `pumpportal:sell`, `jito:bundle`, `jito:statuses`, `helius:das-api`.

**Alerts endpoint** (`GET /api/alerts`): Paginated alert history from SQLite. Max 100 per page.

**Config endpoint** (`GET/POST /api/config`): Read current runtime config. Patch with 3-layer validation (shape → full schema → semantic). Changes in-memory only.

**Trades endpoint** (`GET /api/trades`): Full trade history from SQLite.

**Detection stats:** Logged at info level every 15 minutes: total detected, pre-filtered, dedup-dropped, breakdown by source, `seenMints` map size.

---

## 9. Testing Approach

**Framework:** Vitest 4.0.18. Config: `vitest.config.ts` (loads `.env` via dotenv, overrides `NODE_ENV=development`).

**Test count:** 39 `.test.ts` files in `src/`. No test files outside `src/`.

**Coverage by area:**
- Safety checks: `tier1-authority`, `tier1-sell-route`, `tier1-liquidity`, `tier2-holder`, `tier2-lp-lock`, `tier2-metadata`, `tier2-rugcheck`, `tier3-creator`, `safety-pipeline`, `blocklist` (10 files)
- Execution: `execution-engine`, `broadcaster`, `jupiter-client`, `jupiter-buyer`, `pump-portal-buyer`, `standard-seller`, `chunked-seller`, `jito-seller`, `pump-portal-seller` (9 files)
- Sell: `sell-ladder` (1 file)
- Dashboard routes: `trades`, `config`, `health`, `alerts`, `metrics`, `controls` (6 files)
- Monitoring: `health-service`, `metrics-tracker`, `alert-store` (3 files)
- Persistence: `trade-store` (1 file)
- Position: `position-manager` (1 file)
- Recovery: `recovery-manager` (1 file)
- Detection: `detection-manager` (1 file)
- Core: `rpc-manager`, `resilient-ws`, `balance-guard`, `fee-estimator` (4 files)
- Config: `trading` (1 file)
- Utils: `wallet` (1 file)

**Mocking patterns:**
- `vi.mock('../../config/env.js', ...)` — prevents `process.exit(1)` on missing env vars
- `vi.stubGlobal('fetch', mockFetch)` — all network calls
- `vi.useFakeTimers()` — circuit breaker cooldown, TTL caches
- SQLite `:memory:` databases — full integration tests without file I/O
- `as unknown as ClassName` cast — mocking class instances with private fields

**Circuit breaker isolation:** `_resetCircuitBreaker()` is exported from `tier2-rugcheck.ts` and `tier3-creator.ts` (test-only) and called in `beforeEach` to prevent state leakage.

**"Nyquist validation" pattern** (commit `4c32608 test(phase-21): add Nyquist validation tests for controls idempotency and partial failure`): A testing pattern that verifies idempotency of control operations — calling the same action multiple times produces the same result with no side effects. Concretely: pausing detection when already paused should not increment the pause counter; force-selling when a sell is already in flight should return 409 on both first and subsequent calls. Named informally after the principle of testing at critical boundaries.

---

## 10. Notable Engineering Decisions

**Synchronous duplicate-buy guard:** `better-sqlite3` is synchronous by design. `createBuyingRecord()` exploits this: the in-memory Set check and the DB insert execute in a single call-stack frame with no `await` — no concurrent token event can slip through the gap. Documented explicitly in the class docstring as the architectural guarantee.

**Write-ahead before on-chain action:** BUYING state is written before `executionEngine.buy()` is called. If the process crashes mid-buy, recovery finds the BUYING row and checks the on-chain balance to determine whether the buy landed. This pattern eliminates the "unknown trade state" class of recovery failure.

**RugCheck result tuple:** `checkRugCheck` returns `[CheckResult, RugCheckResultData | null]` so the orchestrator can use `lpLockedPct` to override the on-chain LP lock result. This eliminates a redundant LP lock API call and provides more accurate lock data in a single request.

**JupiterRouteError typed error class:** A dedicated error class carrying `.code` (the Jupiter API error code) lets `PositionManager` and `SellLadder` use `instanceof` checks to make routing decisions. `PositionManager` fires a sell (to escalate to the PumpPortal step) when it receives `TOKEN_NOT_TRADABLE`. `SellLadder` gates the PUMPPORTAL step on the same condition. This avoids string-matching error messages.

**Rate-limit-aware poll interval:** `PositionManager.scheduleTick()` calls `jupiterClient.cooldownRemainingMs()` and stretches the interval by that amount. This is a cooperative rate-budget-sharing mechanism: monitoring yields to trade execution during rate-limit cooldowns.

**Module-level monitoring injection:** 7 fetch-calling modules (`tier2-rugcheck`, `tier3-creator`, `pump-portal-buyer`, `pump-portal-seller`, `jito-seller`, `jupiter-client`, `fee-estimator`) expose a `setXxxMonitoring(mt, cb, threshold)` setter called once from `index.ts`. This avoids threading monitoring references through deep constructor chains while still enabling full observability. The pattern trades constructor purity for call-site simplicity.

**Token-2022 single-query balance:** The RPC `getParsedTokenAccountsByOwner(wallet, { mint })` filter (without specifying a `programId`) searches all token programs in a single call. A previous dual-query approach (one for TOKEN_PROGRAM_ID, one for TOKEN_2022_PROGRAM_ID) double-counted Token-2022 tokens, causing Jupiter error 6024 (InsufficientFunds). The fix is documented with a reference to the Solana Labs issue tracker.

**Jito tip as separate transaction:** The Jito bundle is `[swap_tx, tip_tx]` — tip is a SOL transfer to a randomly selected Jito tip account, not embedded in the swap. Embedding the tip would change the transaction structure Jupiter built and invalidate its simulation.

**EMERGENCY sell uses on-chain parse:** At 49% slippage, the Jupiter quote `outAmount` may be unreliable. The EMERGENCY step calls `parseSolReceived()` after confirmation, which computes the actual SOL received from the transaction's pre/post wallet balance delta.

**3-layer config validation:** The config PATCH endpoint runs: (1) `ConfigPatchSchema.safeParse` on the request body, (2) `TradingConfigSchema.safeParse` on the merged result (catches range violations), (3) `validateSemantics()` for cross-field constraints (tiered TP sum ≤ 100, safety weights sum = 100). `structuredClone(snapshot)` taken before patching enables rollback without reference aliasing.

---

## 11. Project Structure (Annotated, Top 2 Levels)

```
src/
  config/
    env.ts             Zod schema for env vars; process.exit(1) on failure; loaded first
    trading.ts         JSONC config loader; TradingConfigSchema; patchRuntimeConfig() 2-level deep merge
  core/
    balance-guard.ts   SOL balance check with 5s TTL cache; never blocks sells
    fee-estimator.ts   Helius priority fee; 5s cache; circuit breaker; static fallback
    logger.ts          pino instance; module/trade child loggers; PRIVATE_KEY redaction; pino-roll in prod
    resilient-ws.ts    Abstract WebSocket base: exponential backoff, heartbeat, reconnect alerting
    rpc-manager.ts     Primary/backup RPC; 3-failure failover; 10s recovery polling
  detection/
    detection-manager.ts   Dedup (Map+eviction); pre-filter; stats logging; source toggle
    pre-filter.ts          Name/symbol rules: length, spam keywords, impersonation list
    pump-portal-listener.ts WebSocket to pumpportal.fun; subscribeNewToken; extends ResilientWebSocket
    raydium-listener.ts    onLogs for Raydium V4 + PumpSwap; silence-based health-check
  execution/
    broadcaster.ts         Blockhash-last signing; parallel multi-RPC broadcast; retry with late-landing check
    execution-engine.ts    Buy routing pumpportal/Jupiter; dry-run AMM estimation; deferred sell-route verify
    jupiter-client.ts      Singleton Jupiter API client; global rate-limit cooldown; JupiterRouteError
    buy/
      jupiter-buyer.ts       Jupiter quote+swap path
      pump-portal-buyer.ts   PumpPortal trade-local API (raw bytes response)
    sell/
      sell-ladder.ts         6-step escalation orchestrator; partial sells; sol-received accumulation
      standard-seller.ts     STANDARD + HIGH_FEE + EMERGENCY steps
      jito-seller.ts         Jito bundle: swap_tx + tip_tx; getBundleStatuses polling
      chunked-seller.ts      3-tranche sequential sell; Token-2022 ATA derivation
      pump-portal-seller.ts  PumpPortal bonding curve sell
  monitoring/
    alert-store.ts     SQLite alert persistence; shares DB with TradeStore
    health-service.ts  Component health aggregation; transition detection; cooldown-debounced alerts
    metrics-tracker.ts 5-min sliding window; exact p50/p99; 60s prune timer
  persistence/
    schema.ts          SCHEMA_SQL; MIGRATION_SQL (try/catch ALTER TABLE); ALERTS_SCHEMA_SQL
    trade-store.ts     WAL SQLite; all statements pre-compiled; activeMints Set; optimistic locking
  position/
    position-manager.ts Recursive setTimeout polling; tiered TP; trailing stop; stop-loss; max hold
  recovery/
    recovery-manager.ts Crash reconciliation; blocks DetectionManager start; 5s per-trade RPC timeout
  safety/
    blocklist.ts          JSON file-backed creator blocklist; auto-populated on serial deployer detection
    safety-cache.ts       TTL cache for SafetyResult keyed by mint
    safety-pipeline.ts    Three-tier orchestration; 4 exit paths; SAFETY_EVALUATION event emission
    checks/               8 check functions (see Feature Inventory)
  types/
    index.ts           All shared TypeScript types: TokenEvent, Trade, SafetyResult, SellStep, etc.
  utils/
    parse-sol-received.ts  On-chain pre/post wallet SOL balance delta parser
    wallet.ts              Keypair loading from SOLSNIPER_PRIVATE_KEY
  dashboard/
    auth.ts             API key auth Fastify hook
    bot-event-bus.ts    eventemitter3 singleton; 14 BotEventType values
    dashboard-server.ts Fastify setup; SSE plugin; SPA static serving; SPA 404 fallback
    routes/             7 files: alerts, config, controls, events, health, metrics, trades
  index.ts             Startup sequence (15 labeled steps); graceful shutdown

dashboard/             Preact SPA (separate Vite build)
  src/
    app.tsx            Root; emergency stop dialog (requires typing "STOP")
    components/        LiveFeed, Performance, Pipeline, Controls, SystemStatus, Settings, Sidebar, PnlChart
    store/             Preact signals: config, feed, controls
  dist/               Pre-built output served by Fastify static plugin

config.jsonc           Trading parameters with inline comments (strip-json-comments)
vitest.config.ts       Test config; loads .env; NODE_ENV=development override
tsconfig.json          ES2022 target; Node16 module; strict; resolveJsonModule
```

---

## 12. Configuration Surface

### Environment variables (`src/config/env.ts`)

All validated at startup via Zod; `process.exit(1)` on any failure.

| Variable | Required | Description |
|---|---|---|
| `SOLSNIPER_RPC_URL` | Yes | Primary Solana RPC endpoint (URL) |
| `SOLSNIPER_RPC_BACKUP_URL` | Yes | Backup RPC endpoint (URL) |
| `SOLSNIPER_PRIVATE_KEY` | Yes | Base58 wallet private key (min 32 chars) |
| `SOLSNIPER_JUPITER_API_KEY` | Yes | Jupiter API key (`x-api-key` header); required since Jan 31 2026 |
| `NODE_ENV` | No | `development` or `production` (default: `development`) |
| `LOG_LEVEL` | No | `trace\|debug\|info\|warn\|error` (default: `debug`) |
| `PUMPPORTAL_ENABLED` | No | Enable PumpPortal WebSocket (default: `true`) |
| `RAYDIUM_ENABLED` | No | Enable Raydium/PumpSwap onLogs (default: `true`) |
| `RUGCHECK_API_KEY` | No | If present, enables RugCheck API in Tier 2 |
| `HELIUS_API_KEY` | No | If present, enables creator history check in Tier 3 |
| `DASHBOARD_PORT` | No | Dashboard HTTP port; 1024–65535 (default: `3001`) |
| `DASHBOARD_API_KEY` | No | If present, enables API key auth on all dashboard routes |

### Trading configuration (`config.jsonc`)

Runtime-patchable fields shown with their `POST /api/config` names in parentheses.

Top level: `buyAmountSol`, `maxSlippageBps`, `maxConcurrentPositions`, `stopLossPct`, `takeProfitPct`*, `minSafetyScore`, `dryRun`, `minBalanceBufferSol`

`detection`: `wsHeartbeatIntervalMs`, `wsBaseBackoffMs`, `wsMaxBackoffMs`, `wsExcessiveReconnectThreshold`, `wsExcessiveReconnectWindowMs`, `statsIntervalMs`, `dedupWindowMs`

`safety`: `tier2TimeoutMs`, `tier3TimeoutMs`, `cacheTtlMs`, `weights.{rugCheck,holder,creator}` (patchable), `holder.{top1SoftBlockThreshold,top10SoftBlockThreshold,minUserHolders}`, `rugCheckScoreInverted`, `blocklistPath`, `minLiquiditySol`, `lpLockScorePenalty`, `metadataMutablePenalty`

`execution.buy`: `slippageBps` (patchable), `priorityFeeBaseLamports`, `priorityFeeMultiplier`, `maxPriorityFeeCapLamports`

`execution.sell`: `standardSlippageBps`, `emergencySlippageBps`, `standardTimeoutMs`, `highFeeTimeoutMs`, `highFeeMultiplier`, `jitoTimeoutMs`, `jitoTipLamports`, `chunkedTimeoutMs`, `emergencyTimeoutMs`, `emergencyPriorityMultiplier`

`positionManagement` (all patchable): `pollIntervalMs`, `stopLossPct`, `tieredTp[]`, `trailingStopPct`, `maxHoldTimeMs`

`monitoring`: `alertCooldownMs`, `apiFailureThreshold`, `apiErrorRateDegraded`, `apiErrorRateDown`, `logRotation.{sizeMb,retentionDays}`

*`takeProfitPct` is present in schema and patchable but not used in position exit logic (superseded by `tieredTp`).

### npm scripts

```bash
pnpm start          # Build dashboard, then run bot (tsx src/index.ts)
pnpm dev            # Build dashboard, then tsx watch (hot-reload)
pnpm test           # vitest run
pnpm test:watch     # vitest (watch mode)
pnpm typecheck      # tsc --noEmit
pnpm build:dashboard # vite build --config dashboard/vite.config.ts
pnpm dev:dashboard  # vite --config dashboard/vite.config.ts (Vite dev server)
pnpm lint:security  # eslint src/
```

---

## 13. Ambiguities / Gaps

**PumpSwap liquidity check is a neutral pass:** `checkLiquidityDepth` unconditionally returns `pass=true, score=100` for `source='pumpswap'`. The pool vault layout was not documented at implementation time. PumpSwap tokens pass the liquidity hard check without validation.

**`takeProfitPct` top-level field is unused:** Present in `TradingConfigSchema` and patchable via `POST /api/config`. The actual position exit logic uses `positionManagement.tieredTp[]`. The top-level field is never read by any position evaluation code.

**`maxSlippageBps` top-level field is also unused:** Same pattern. Execution uses `execution.buy.slippageBps` and the per-step sell slippage values. The top-level field appears to be a legacy holdover.

**BalanceGuard cache never invalidated after buys:** `BalanceGuard.invalidateCache()` exists but is never called. After a successful buy that drains SOL, the next balance check within 5s will use the stale (pre-buy) cached value. With a 5s TTL this is low-risk but not tight.

**Dashboard SPA requires separate build step:** The bot serves `dashboard/dist/` which must be built with `pnpm build:dashboard` before starting. There is no automatic build or fallback beyond a `404` error message. In development, `pnpm dev` runs both, but the build must complete before the bot starts.

**No CI/CD:** No `.github/workflows/` directory exists. Testing is manual.

**No containerization:** No Dockerfile or docker-compose. Raw Node.js execution assumed.

**Safety threshold calibration:** The default `minSafetyScore: 80` in `config.jsonc` was set by the developer without real trade data. The planning docs note this requires empirical calibration.

---

## 14. Direct Quotes / Code Excerpts

### Aggregate safety scoring with LP/metadata penalties
**`src/safety/safety-pipeline.ts:186–206`**

```typescript
const weights = cfg.safety.weights;
const rugScore = rugCheckResult.score ?? 0;
const holderScore = holderResult.score ?? 0;
const creatorScore = creatorResult.score ?? 0;

let aggregateScore = Math.round(
  (rugScore / 100) * weights.rugCheck +
  (holderScore / 100) * weights.holder +
  (creatorScore / 100) * weights.creator,
);

// Apply flat penalties for LP lock and metadata mutability (SAF-11)
const lpLockScore = lpLockResult.score ?? 0;
const metadataScore = metadataResult.score ?? 0;

if (lpLockScore === 0) {
  aggregateScore = Math.max(0, aggregateScore - cfg.safety.lpLockScorePenalty);
}
if (metadataScore === 0) {
  aggregateScore = Math.max(0, aggregateScore - cfg.safety.metadataMutablePenalty);
}
```

### Synchronous duplicate-buy guard
**`src/persistence/trade-store.ts:205–222`**

```typescript
createBuyingRecord(mint: string, source?: string, tokenProgramId?: string, dryRun = false, ...): void {
  if (this.activeMints.has(mint)) {
    throw new Error(`Duplicate buy attempt blocked for mint: ${mint}`);
  }
  const now = Date.now();
  this.stmtInsert.run({
    mint,
    state: 'BUYING',
    now,
    source: source ?? null,
    token_program_id: tokenProgramId ?? null,
    dry_run: dryRun ? 1 : 0,
    // ...
  });
  this.activeMints.add(mint);
}
```

The synchronous `better-sqlite3` API guarantees no async gap between Set check and DB write.

### FeeEstimator circuit breaker
**`src/core/fee-estimator.ts:56–59` and `130–141`**

```typescript
// In getEstimate():
if (Date.now() < this.cooldownUntil) {
  const fallbackLamports = Math.floor(buy.priorityFeeBaseLamports * buy.priorityFeeMultiplier);
  const capped = Math.min(fallbackLamports, cap);
  return { maxLamports: capped, priorityFeeSol: capped / 1e9, source: 'fallback' };
}
// ...
// In finally block:
if (!success) {
  this.consecutiveFailures++;
  if (this.consecutiveFailures >= this.apiFailureThreshold) {
    this.cooldownUntil = Date.now() + DEFAULT_COOLDOWN_MS;
    this.onApiAlert?.('helius:fee-estimate', 'consecutive_failure', `...circuit breaker open for 30s`);
  }
} else {
  this.consecutiveFailures = 0;
  this.cooldownUntil = 0;
}
```

### Sell ladder time-based escalation
**`src/execution/sell/sell-ladder.ts:186–231`**

```typescript
for (const step of steps) {
  let stepSucceeded = false;
  try {
    const result = await Promise.race([
      step.fn(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Step ${step.name} timed out after ${step.timeoutMs}ms`)), step.timeoutMs)
      ),
    ]);
    // discriminate ChunkedSellOutcome vs SellOutcome
    stepSucceeded = 'confirmedTranches' in result
      ? (result as ChunkedSellOutcome).confirmedTranches > 0
      : true;
  } catch (err) {
    lastError = err;  // captured for PUMPPORTAL gate condition
    log.warn({ mint, step: step.name }, 'Sell step failed or timed out -- advancing');
  }
  if (stepSucceeded) { /* transition and return */ return; }
}
this.tradeStore.transition(mint, 'SELLING', 'FAILED', { errorMessage: 'SELL_FAILED: all ladder steps exhausted' });
```

### BotEvent type catalog
**`src/dashboard/bot-event-bus.ts:3–16`**

```typescript
export type BotEventType =
  | 'TOKEN_DETECTED' | 'BUY_SENT' | 'BUY_CONFIRMED' | 'BUY_FAILED'
  | 'SELL_TRIGGERED' | 'SELL_PARTIAL' | 'SELL_CONFIRMED' | 'SELL_FAILED'
  | 'ERROR' | 'CONFIG_CHANGED' | 'LOW_BALANCE'
  | 'SYSTEM_ALERT'       // component health transitions, API failures, rate limits
  | 'SAFETY_EVALUATION'; // full per-check safety result for every evaluated token
```

---

*End of research document.*
