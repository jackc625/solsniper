# Architecture

**Analysis Date:** 2026-02-20

## Pattern Overview

**Overall:** Reactive event-driven pipeline with parallel safety checks and state machine-based position management.

**Key Characteristics:**
- Multi-subsystem architecture (Detection → Safety → Execution → PnL → Operations)
- Parallel execution of safety checks (time-critical for entry windows)
- State machine-based position tracking to prevent duplicates and handle crashes
- Retry escalation ladder for both buy and sell transactions
- Real-time monitoring with periodic polling fallback for position exits

## Layers

**Detection Layer:**
- Purpose: Identify new tokens on Pump.fun and Raydium before other participants
- Location: Primary WebSocket listeners at detection module level (PumpPortal WebSocket + logsSubscribe)
- Contains: WebSocket connection management, event parsing, token extraction logic
- Depends on: PumpPortal Data API, Solana RPC logsSubscribe capability
- Used by: Safety checking layer

**Safety Evaluation Layer:**
- Purpose: Filter scams, honeypots, and rugs before committing capital
- Location: Core safety module with parallel check runners
- Contains: Mint/freeze authority validation, sell simulation, RugCheck integration, holder analysis
- Depends on: Solana RPC (getAccountInfo), Jupiter Quote API, RugCheck.xyz API (optional)
- Used by: Execution layer (blocks trades if Tier 1 checks fail)

**Execution Layer:**
- Purpose: Reliably land buy and sell transactions with MEV protection
- Location: Swap execution module with retry logic and Jito integration
- Contains: Jupiter Swap API integration, PumpPortal trade-local API, Jito bundle construction, transaction signing
- Depends on: Jupiter Swap API, PumpPortal Trade API, Jito Block Engine, Solana RPC (sendRawTransaction)
- Used by: Position management layer

**Position Management Layer:**
- Purpose: Track active trades, compute PnL, execute exits at profit/loss targets
- Location: Position monitor and exit executor modules
- Contains: Price tracking (polling-based or event-driven), take-profit/stop-loss logic, trailing stops
- Depends on: Jupiter Quote API, PumpPortal trade stream (optional), position state database
- Used by: Execution layer (triggers sells)

**Operations & Reliability Layer:**
- Purpose: Keep the bot running, persist state, provide observability
- Location: RPC manager, trade journal (SQLite), logging, crash recovery
- Contains: Multi-RPC failover, WebSocket reconnection, trade persistence, structured logging, state machine
- Depends on: SQLite database, RPC providers, pino/winston logging
- Used by: All other layers

## Data Flow

**Detection → Buy → Monitoring → Sell:**

1. **Detection (T+0ms):** PumpPortal WebSocket emits `subscribeNewToken` event with token mint, or logsSubscribe detects Raydium pool creation
2. **Parallel Safety Checks (T+0-300ms):**
   - Mint authority, freeze authority validation (RPC call, ~50ms)
   - Sell simulation via Jupiter quote (RPC + API call, ~100-300ms)
   - Optional RugCheck API call (~200-500ms, non-blocking)
3. **Decision (T+200-300ms):** If all Tier 1 checks pass (mint auth null, freeze auth null, sell route exists), proceed to buy
4. **Buy Execution (T+300-500ms):**
   - Get fresh Jupiter quote with dynamic slippage
   - Build versioned transaction with compute budget and priority fees
   - Fetch fresh blockhash (critical for transaction validity)
   - Sign transaction
   - Send to multiple RPC providers simultaneously
   - Confirm at "confirmed" commitment level
5. **Position Created:** Store in trade journal with entry price, amount, timestamp
6. **Monitoring (Continuous):** Poll Jupiter quote every 3-5 seconds or subscribe to pool account changes
7. **Exit Trigger (When condition met):** Stop-loss or take-profit threshold exceeded
8. **Sell Execution (Retry escalation):**
   - Level 1: Standard Jupiter swap, dynamic slippage, veryHigh priority
   - Level 2: 2x priority fee, 20% manual slippage
   - Level 3: Jito bundle (50k lamports tip), 30% slippage
   - Level 4: Chunked sell (split position)
   - Levels 5-6: Emergency modes with max slippage and extreme fees
9. **Position Closed:** Update trade journal with exit price, PnL, signature

**State Management:**

Positions track independent state machines:
```
DETECTED → SAFETY_CHECK → BUYING → BUY_CONFIRMED → MONITORING
                                                          ↓
                                        SELLING ← (exit triggered)
                                          ↓
                                  SELL_CONFIRMED → COMPLETED
                                          ↓
                                      (on fail)
                                    RETRY_SELL → STUCK
```

Each trade persists its state to SQLite. On bot restart, resume pending trades from database.

## Key Abstractions

**RpcManager:**
- Purpose: Abstract away RPC provider selection and failover logic
- Examples: `src/core/rpc-manager.ts`
- Pattern: Multi-provider with simultaneous sends for writes (maxes landing chance), round-robin with failover for reads

**TransactionBuilder:**
- Purpose: Encapsulate transaction construction details (versioning, ALTs, compute budgets, priority fees)
- Examples: `src/core/transaction-builder.ts`
- Pattern: Fluent builder with Jupiter quote integration, automatic compute limit/priority fee calculation

**SafetyChecker:**
- Purpose: Run parallel Tier 1/2/3 safety checks and return scoring
- Examples: `src/safety/checker.ts`
- Pattern: Async parallel execution with timeout handling for optional checks

**SwapExecutor:**
- Purpose: Execute buys and sells with automatic retry escalation
- Examples: `src/execution/swap-executor.ts`
- Pattern: Retry ladder with exponential backoff, blockhash refresh on each attempt

**PositionMonitor:**
- Purpose: Track active positions and evaluate exit conditions
- Examples: `src/position/position-monitor.ts`
- Pattern: Polling-based with configurable intervals; can be extended with event-driven mode

**TradeJournal:**
- Purpose: Persist all trade data for crash recovery and analytics
- Examples: `src/db/trade-journal.ts`
- Pattern: SQLite schema with state tracking, supports resume-on-restart

**Logger:**
- Purpose: Structured logging for debugging and alerting
- Examples: `src/core/logger.ts`
- Pattern: JSON-based (pino) with event types, trade IDs, latency tracking

## Entry Points

**Main Bot Process:**
- Location: `src/index.ts` or `src/main.ts`
- Triggers: Run via `npm start` or PM2
- Responsibilities: Initialize all subsystems (RPC, detection listeners, position monitor), handle signals (graceful shutdown), manage bot lifecycle

**Detection Listener:**
- Location: `src/detection/pump-portal-listener.ts`
- Triggers: Runs continuously on WebSocket connection
- Responsibilities: Connect to PumpPortal, emit new token events, handle reconnection

**Safety Evaluation:**
- Location: `src/safety/run-checks.ts`
- Triggers: Called when new token detected
- Responsibilities: Run Tier 1-3 checks in parallel, return safety score and block decision

**Buy Flow:**
- Location: `src/execution/buy-flow.ts`
- Triggers: Called when safety checks pass
- Responsibilities: Get Jupiter quote, build transaction, sign, send, confirm, record in journal

**Sell Flow:**
- Location: `src/execution/sell-flow.ts`
- Triggers: Called when exit condition met (stop-loss, take-profit, etc.)
- Responsibilities: Execute sell with retry ladder, confirm, update journal, handle stuck positions

**Position Monitor:**
- Location: `src/position/monitor.ts`
- Triggers: Runs continuously in background
- Responsibilities: Poll position prices, evaluate exit triggers, call sell-flow when triggered

## Error Handling

**Strategy:** Graceful degradation with escalation. Separate handling for critical (entry/exit) vs observability (logging/alerts).

**Patterns:**

1. **Transaction Failures:**
   - Retry with escalation ladder (fees increase, slippage increases)
   - For buys: max 5 attempts before aborting entry
   - For sells: max 6-7 attempts, escalate to chunked sells
   - Track in journal with error logs

2. **RPC Provider Failures:**
   - For sends: Try all providers in parallel, use first success
   - For reads: Round-robin with failover to next provider
   - If all fail: Log error, alert operator, retry in 5s

3. **WebSocket Drops:**
   - Exponential backoff reconnection (1s → 30s max)
   - Heartbeat (ping every 30s) to detect dead connections
   - No data loss on reconnect (state in journal)

4. **Safety Check Failures:**
   - Tier 1 hard blocks (mint auth, freeze auth, no sell route) → reject immediately
   - Tier 2 soft blocks (high slippage, high price impact) → score penalty, may still buy if score > threshold
   - Tier 3 optional → score modifier only

5. **Stuck Positions:**
   - If sell fails after max retries (5+ minutes): Move to STUCK state
   - Alert operator via logging/Telegram
   - Operator must manually resolve or wait for recovery attempt in next bot restart

## Cross-Cutting Concerns

**Logging:** Structured JSON logs (pino) with event types. Every significant action logged with latency, mint, transaction signature. Searchable for debugging.

**Validation:**
- Blockhash freshness check before every sign (fetch immediately before signing)
- Jupiter quote sanity checks (price impact < 10%, route complexity < 3 hops, output amount reasonable)
- Account existence validation before operations (ATA exists for sells, wallet has balance for buys)

**Authentication:**
- Solana wallet signing via `@solana/web3.js` keypair
- Wallet loaded from `.env` or environment variable at startup
- Private key never logged; only public key logged for debugging

**Idempotency:**
- Track `(mint, direction)` in in-memory Set to prevent duplicate concurrent buys/sells
- Use SQLite trade journal to detect duplicate trades after restart
- Transaction signature used as unique ID for de-duplication

**Time Synchronization:**
- Critical for blockhash validity (expires ~150 slots = 60 seconds)
- Fetch blockhash as close to signing as possible
- Use `processed` commitment for speed in blockhash fetching (vs `confirmed`)

---

*Architecture analysis: 2026-02-20*
