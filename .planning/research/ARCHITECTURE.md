# Architecture Patterns

**Domain:** Solana token sniper bot (detection, safety, execution, position management, dashboard)
**Researched:** 2026-02-20

## Recommended Architecture

**Pattern:** Reactive event-driven pipeline with state-machine-governed positions and a thin HTTP dashboard layer.

The system is a single Node.js process organized as a pipeline of five subsystems connected by in-process EventEmitter channels. Each subsystem owns its own data and exposes a narrow interface. SQLite serves as the single source of truth for trade state, enabling crash recovery without distributed coordination.

```
+------------------+     +------------------+     +------------------+
|    DETECTION     | --> |     SAFETY       | --> |    EXECUTION     |
|  (WebSocket      |     |  (Parallel       |     |  (Jupiter/       |
|   listeners)     |     |   check runner)  |     |   PumpPortal/    |
+------------------+     +------------------+     |   Jito)          |
                                                  +------------------+
                                                          |
                                                          v
+------------------+     +------------------+     +------------------+
|    DASHBOARD     | <-- |   OPERATIONS     | <-- |    POSITION      |
|  (HTTP + SSE     |     |  (SQLite, RPC    |     |   MANAGEMENT     |
|   web UI)        |     |   mgr, logging)  |     |  (monitor, exit) |
+------------------+     +------------------+     +------------------+
```

**Why this pattern:**
- **Single process** matches the single-wallet, personal-tool constraint. No inter-process communication overhead.
- **EventEmitter coupling** between subsystems provides loose coupling without the complexity of message queues. Detection emits `token:detected`, Safety emits `token:approved` or `token:rejected`, Execution emits `position:opened`, Position Management emits `position:exit-triggered`.
- **State machine per position** prevents duplicate actions and enables deterministic crash recovery.
- **SQLite as event log** means every state transition is persisted before the next step executes, giving crash recovery at any point in the pipeline.

### Component Boundaries

| Component | Responsibility | Communicates With | Owns |
|-----------|---------------|-------------------|------|
| **Detection** | Listen for new tokens on Pump.fun and Raydium. Emit raw token events. | Safety (downstream), Operations/RPC Manager (reads) | WebSocket connections, reconnection state |
| **Safety** | Run parallel safety checks, score tokens, make buy/reject decision. | Detection (upstream), Execution (downstream), Operations/RPC Manager (reads) | Safety scoring rubric, check results cache |
| **Execution** | Build, sign, send transactions. Handle retry escalation for both buys and sells. | Safety (upstream for buys), Position Management (upstream for sells), Operations/RPC Manager (sends), Trade Journal (writes) | Transaction building, retry state, Jito bundle construction |
| **Position Management** | Track open positions, poll prices, evaluate exit conditions (SL/TP/trailing), trigger sells. | Execution (downstream for sells, upstream for buy confirmations), Trade Journal (reads/writes), Operations/RPC Manager (reads) | Position map (in-memory + SQLite), exit strategy config |
| **Operations** | RPC failover, SQLite persistence, structured logging, crash recovery, config management. | All other components (cross-cutting) | RPC connections, database handle, logger instance, config object |
| **Dashboard** | Serve web UI, expose REST API for config, stream live events via SSE. | Trade Journal (reads), Position Management (reads), Config (reads/writes) | HTTP server, SSE connections, static assets |

### Data Flow

**Happy path: Detection through Exit**

```
1. PumpPortal WebSocket receives "create" event
   |
   v
2. Detection module extracts mint, creator, symbol
   | emits: token:detected { mint, source, timestamp }
   v
3. Safety module receives event, starts parallel checks:
   | - getMintInfo(mint)        [RPC, ~50ms]
   | - getFreezeAuthority(mint) [RPC, ~50ms]  (same call as mint)
   | - getJupiterSellQuote(mint)[HTTP, ~200ms]
   | - fetchRugCheck(mint)      [HTTP, ~300ms, non-blocking]
   | All via Promise.all with 500ms timeout
   |
   v
4. Safety scoring complete (T+200-300ms from detection)
   | IF score >= MIN_SAFETY_SCORE: emits token:approved { mint, score, flags }
   | ELSE: emits token:rejected { mint, score, flags }
   v
5. Execution module receives approved token
   | a. Check idempotency set (mint already in-flight?)
   | b. Insert trade record: state=BUYING
   | c. Fetch fresh Jupiter quote
   | d. Build VersionedTransaction
   | e. Fetch blockhash (AFTER building, as close to sign as possible)
   | f. Sign transaction
   | g. Send to ALL RPC providers simultaneously
   | h. Poll for confirmation at "confirmed" level
   | i. Update trade record: state=BUY_CONFIRMED, entry_price, entry_sig
   | emits: position:opened { mint, entryPrice, amount }
   v
6. Position Management module adds to active watch list
   | Polls Jupiter quote every 3-5 seconds (or uses PumpPortal trade stream)
   | Evaluates: stopLoss, takeProfit, trailingStop, maxHoldTime
   |
   v
7. Exit condition met (e.g., PnL >= takeProfit1)
   | emits: position:exit-triggered { mint, reason, targetSellPct }
   v
8. Execution module receives sell trigger
   | a. Update trade: state=SELLING
   | b. Execute sell via retry escalation ladder (Levels 1-7)
   | c. On success: state=SELL_CONFIRMED, then COMPLETED
   | d. On all-fail: state=STUCK, alert operator
   | emits: position:closed { mint, pnl, exitReason }
   v
9. Trade Journal updated with final PnL
   Dashboard receives SSE event for live feed
```

**Crash recovery flow:**

```
Bot restarts
  |
  v
Query SQLite for trades WHERE state NOT IN ('COMPLETED', 'FAILED')
  |
  v
For each unresolved trade:
  - BUYING:     Check if tx confirmed on-chain. If yes -> BUY_CONFIRMED. If no -> mark FAILED.
  - BUY_CONFIRMED / MONITORING: Resume position monitoring.
  - SELLING:    Check if sell tx confirmed. If yes -> COMPLETED. If no -> retry sell.
  - STUCK:      Log warning, leave for operator. Attempt recovery every 30 min.
```

### Internal Event Bus

Use Node.js `EventEmitter` (or a typed wrapper) as the in-process event bus. This avoids direct function call coupling between subsystems.

```typescript
// Event types (typed for safety)
interface BotEvents {
  "token:detected":      { mint: string; source: "pumpfun" | "raydium"; creator: string; timestamp: number };
  "token:approved":      { mint: string; score: number; flags: string[] };
  "token:rejected":      { mint: string; score: number; flags: string[]; reason: string };
  "position:opened":     { tradeId: string; mint: string; entryPrice: number; amount: number; sig: string };
  "position:exit-triggered": { tradeId: string; mint: string; reason: ExitReason; sellPct: number };
  "position:closed":     { tradeId: string; mint: string; pnlSol: number; pnlPct: number; sig: string };
  "position:stuck":      { tradeId: string; mint: string; retryCount: number; lastError: string };
  "system:error":        { component: string; error: Error; context: Record<string, unknown> };
}
```

**Why EventEmitter over direct calls:**
- Subsystems can be tested independently by mocking event emissions.
- Dashboard can subscribe to all events for live streaming without coupling to business logic.
- Future: Easy to replace with a proper message queue if multi-process architecture is needed.

**Why NOT a full message queue (Redis, RabbitMQ):**
- Single process, single machine. EventEmitter has zero overhead.
- No durability needed from the bus itself -- SQLite provides durability.
- Adds operational complexity that conflicts with the personal-tool constraint.

## Patterns to Follow

### Pattern 1: State Machine Per Trade

**What:** Each trade progresses through a finite set of states. Transitions are explicit, logged, and persisted to SQLite before the next action executes.

**When:** Every trade, from detection through completion.

**Why:** Prevents duplicate actions (can't buy a token already in BUYING state), enables deterministic crash recovery, and makes the system's behavior auditable.

```typescript
enum TradeState {
  DETECTED = "DETECTED",
  SAFETY_CHECK = "SAFETY_CHECK",
  BUYING = "BUYING",
  BUY_CONFIRMED = "BUY_CONFIRMED",
  MONITORING = "MONITORING",
  SELLING = "SELLING",
  SELL_CONFIRMED = "SELL_CONFIRMED",
  COMPLETED = "COMPLETED",
  FAILED = "FAILED",
  STUCK = "STUCK"
}

// Valid transitions (enforce in code)
const VALID_TRANSITIONS: Record<TradeState, TradeState[]> = {
  DETECTED:       [TradeState.SAFETY_CHECK, TradeState.FAILED],
  SAFETY_CHECK:   [TradeState.BUYING, TradeState.FAILED],
  BUYING:         [TradeState.BUY_CONFIRMED, TradeState.FAILED],
  BUY_CONFIRMED:  [TradeState.MONITORING],
  MONITORING:     [TradeState.SELLING],
  SELLING:        [TradeState.SELL_CONFIRMED, TradeState.STUCK],
  SELL_CONFIRMED: [TradeState.COMPLETED],
  COMPLETED:      [],
  FAILED:         [],
  STUCK:          [TradeState.SELLING, TradeState.FAILED]  // manual retry or give up
};

function transitionTrade(trade: Trade, newState: TradeState): void {
  if (!VALID_TRANSITIONS[trade.state].includes(newState)) {
    throw new Error(`Invalid transition: ${trade.state} -> ${newState}`);
  }
  trade.state = newState;
  trade.updatedAt = new Date().toISOString();
  tradeJournal.update(trade);  // persist BEFORE proceeding
  logger.info({ tradeId: trade.id, from: trade.state, to: newState }, "Trade state transition");
}
```

### Pattern 2: Parallel Safety with Timeout

**What:** Run all safety checks concurrently via `Promise.allSettled` with a hard timeout. Tier 1 checks are blocking (trade rejected if any fail). Tier 2 checks are score modifiers.

**When:** Every detected token, before buy decision.

```typescript
async function runSafetyChecks(mint: string, timeoutMs: number = 500): Promise<SafetyResult> {
  const tier1 = Promise.all([
    checkMintAuthority(mint),
    checkFreezeAuthority(mint),
    simulateSell(mint)
  ]);

  const tier2 = Promise.allSettled([
    fetchRugCheck(mint),
    checkHolderConcentration(mint),
    checkMetadataMutability(mint)
  ]);

  // Tier 1 must complete. Tier 2 has a timeout.
  const [tier1Results, tier2Results] = await Promise.all([
    tier1,
    Promise.race([tier2, sleep(timeoutMs).then(() => "TIMEOUT")])
  ]);

  // Score and decide
  return calculateSafetyScore(tier1Results, tier2Results);
}
```

### Pattern 3: Write-Ahead State Persistence

**What:** Persist trade state to SQLite BEFORE executing the action, not after. This means if the process crashes mid-action, the trade is in a known state that can be resolved on restart.

**When:** Every state transition.

```
// WRONG: Execute, then persist
sendTransaction(tx);     // <- crash here = unknown state
journal.update(BUYING);

// RIGHT: Persist intent, then execute
journal.update(BUYING);  // <- crash here = known state, can resolve
sendTransaction(tx);
```

### Pattern 4: Sell Reliability Ladder as Strategy Pattern

**What:** Each escalation level is an independent strategy object. The executor iterates through strategies until one succeeds or all are exhausted.

**When:** Every sell attempt.

```typescript
interface SellStrategy {
  name: string;
  level: number;
  execute(mint: string, amount: number): Promise<SellResult>;
}

const SELL_STRATEGIES: SellStrategy[] = [
  { name: "jupiter-standard",    level: 1, execute: jupiterStandardSell },
  { name: "jupiter-aggressive",  level: 2, execute: jupiterAggressiveSell },
  { name: "jito-bundle-low",     level: 3, execute: jitoBundleLowTip },
  { name: "chunked-sell",        level: 4, execute: chunkedSell },
  { name: "pumpportal-fallback", level: 5, execute: pumpPortalSell },
  { name: "jito-emergency",      level: 6, execute: jitoEmergencyBundle },
];

async function executeSellWithEscalation(mint: string, amount: number): Promise<SellResult> {
  for (const strategy of SELL_STRATEGIES) {
    try {
      const result = await strategy.execute(mint, amount);
      if (result.success) return result;
    } catch (error) {
      logger.warn({ strategy: strategy.name, level: strategy.level, error }, "Sell strategy failed");
    }
  }
  return { success: false, state: "STUCK" };
}
```

### Pattern 5: Resilient WebSocket Wrapper

**What:** A reusable WebSocket wrapper that handles reconnection, heartbeat, and backoff. Used for both PumpPortal and Solana RPC subscriptions.

**When:** All WebSocket connections.

```typescript
class ResilientWebSocket {
  private ws: WebSocket | null = null;
  private reconnectDelay = 1000;
  private maxDelay = 30000;
  private heartbeatInterval: NodeJS.Timer | null = null;

  constructor(
    private url: string,
    private onMessage: (data: unknown) => void,
    private onReconnect?: () => void  // re-subscribe after reconnect
  ) {}

  connect(): void { /* connect, set up listeners, start heartbeat */ }
  private scheduleReconnect(): void { /* exponential backoff */ }
  private startHeartbeat(): void { /* ping every 30s, close if no pong */ }
  close(): void { /* clean shutdown */ }
}
```

### Pattern 6: Dashboard as Read-Only Observer

**What:** The web dashboard subscribes to the event bus for live updates and queries SQLite for historical data. It NEVER participates in trading logic. Config changes go through the config module, not directly to subsystems.

**When:** Dashboard implementation phase.

```
Dashboard HTTP Server
  |
  +-- GET /api/trades          -> Read from SQLite
  +-- GET /api/positions       -> Read from PositionManager in-memory map
  +-- GET /api/config          -> Read from Config module
  +-- PUT /api/config          -> Write to Config module (validates, persists, notifies subsystems)
  +-- GET /api/wallet          -> Read SOL balance from RPC
  +-- GET /events (SSE stream) -> Subscribe to EventBus, forward all events to browser
```

**Stack for dashboard:**
- **Backend:** Express.js or Fastify as a thin HTTP server within the same Node.js process. No separate service.
- **Frontend:** Vanilla HTML/JS with minimal framework (Preact or no framework). The dashboard is a monitoring tool, not a product UI. Keep it simple.
- **Live updates:** Server-Sent Events (SSE) over a single HTTP connection. SSE is simpler than WebSocket for unidirectional server-to-client streaming.
- **No auth needed:** Single-user, localhost-only (or VPN-protected on VPS). Adding auth is out of scope per PROJECT.md.

## Anti-Patterns to Avoid

### Anti-Pattern 1: Synchronous Safety Pipeline

**What:** Running safety checks one after another instead of in parallel.

**Why bad:** Each RPC call takes 50-300ms. Running 4 checks sequentially = 200-1200ms total. Parallel execution: 200-300ms total. At 300ms vs 1200ms, you miss the entry window entirely.

**Instead:** `Promise.all` for Tier 1, `Promise.allSettled` for Tier 2, hard timeout for the overall pipeline.

### Anti-Pattern 2: Polling for Everything

**What:** Using `setInterval` to poll every external data source (positions, prices, WebSocket health, wallet balance).

**Why bad:** With 20+ positions, polling Jupiter quotes every 3 seconds = 7+ RPC/HTTP calls per second just for monitoring. This quickly exhausts rate limits and adds unnecessary latency.

**Instead:** Use event-driven updates where possible (PumpPortal trade subscriptions, `onAccountChange` for pool reserves). Reserve polling for Jupiter exit-price verification (poll only when event-driven price crosses a threshold near SL/TP).

### Anti-Pattern 3: God Module for Transaction Building

**What:** A single function that handles Jupiter quotes, PumpPortal transactions, Jito bundles, retry logic, blockhash management, and confirmation -- all in one place.

**Why bad:** This grows to 500+ lines, becomes untestable, and makes it impossible to add new execution strategies (e.g., Raydium SDK direct swaps) without modifying existing code.

**Instead:** Separate concerns: `JupiterClient` (quotes + swap building), `PumpPortalClient` (trade-local API), `JitoBundleBuilder` (bundle construction + submission), `SwapExecutor` (orchestrates the above with retry logic), `TransactionConfirmer` (polls confirmation status).

### Anti-Pattern 4: Caching Blockhashes

**What:** Fetching a blockhash once and reusing it for multiple transactions or across retry attempts.

**Why bad:** Blockhashes expire after ~60 seconds (~150 slots). During congestion, they can expire even faster. A stale blockhash guarantees transaction failure.

**Instead:** Fetch blockhash IMMEDIATELY before signing. On every retry attempt, fetch a fresh blockhash. Use `'processed'` commitment for speed.

### Anti-Pattern 5: Dashboard Coupling to Trading Logic

**What:** Having the dashboard directly call buy/sell functions, or having trading logic check dashboard state before proceeding.

**Why bad:** Creates bidirectional coupling. Dashboard bugs can cause trading failures. Trading logic must work identically whether or not the dashboard is running.

**Instead:** Dashboard is read-only for trade data. Config changes go through a dedicated config module with validation. The event bus is the only connection point -- dashboard subscribes, never publishes trading events.

### Anti-Pattern 6: In-Memory-Only Position Tracking

**What:** Storing active positions only in a JavaScript `Map` without persisting to SQLite until trade completion.

**Why bad:** Process crash = all position data lost. Bot restarts with no knowledge of open positions. Tokens sit in the wallet with no monitoring, no exit triggers, and no record of entry price.

**Instead:** Write-ahead persistence. Every state transition is written to SQLite BEFORE the action executes. On restart, the in-memory map is rebuilt from SQLite. The database is always the source of truth.

## Scalability Considerations

| Concern | At 5 positions | At 20 positions | At 50 positions |
|---------|----------------|-----------------|-----------------|
| **Price polling** | 1-2 RPC calls/sec, no issue | 4-7 calls/sec, approaching free tier limits | 10-17 calls/sec, requires batching or event-driven approach |
| **Memory** | ~50MB process | ~80MB process | ~120MB process; watch for WebSocket listener leaks |
| **Event loop** | No contention | Occasional blocking if safety checks spike | Must use `Promise.allSettled` with timeouts to prevent queue buildup |
| **SQLite writes** | Negligible | ~2-5 writes/sec during active trading | ~10+ writes/sec; use WAL mode, batch updates |
| **RPC rate limits** | Well within Helius free tier | Requires Helius Developer ($49/mo) | Requires batching (`getMultipleAccounts`), may need Business tier |

**Key scaling decision:** The architecture is designed for 5-20 concurrent positions. Beyond 20, consider:
1. Switching position monitoring from polling to event-driven (`onAccountChange`).
2. Batching RPC reads with `getMultipleAccounts`.
3. Caching blockhash with a 2-second TTL to reduce calls.
4. Setting `MAX_CONCURRENT_POSITIONS` as a hard config limit.

50+ positions in a single Node.js process is the practical ceiling. Beyond that, the architecture would need multi-process with shared SQLite or PostgreSQL, which is out of scope.

## Component Dependency Graph and Build Order

Understanding which components depend on which others determines the build order. Components lower in the graph must be built first.

```
Layer 0 (Foundation - build first):
  Config, Logger, Types, Constants, Utils

Layer 1 (Core Infrastructure):
  RPC Manager, Trade Journal (SQLite), Resilient WebSocket wrapper

Layer 2 (Business Logic - Independent):
  Detection (depends on: Layer 1)
  Safety Checker (depends on: Layer 1)
  Jupiter Client (depends on: Layer 1)
  PumpPortal Client (depends on: Layer 1)

Layer 3 (Orchestration):
  Execution / Swap Executor (depends on: Jupiter Client, PumpPortal Client, Trade Journal)
  Position Monitor (depends on: Jupiter Client, Trade Journal)

Layer 4 (Integration):
  Main Pipeline (wires Detection -> Safety -> Execution -> Position Mgmt)
  Jito Bundle Builder (extends Execution, Phase 2)

Layer 5 (Presentation - build last):
  Dashboard HTTP Server (depends on: Trade Journal, Position Monitor, Config)
  Dashboard Frontend (depends on: Dashboard HTTP Server SSE stream)
```

### Suggested Build Order (Maps to Development Phases)

**Phase 1: Foundation + Detection + Safety + Basic Execution**
1. Config loader, logger, types, constants (Layer 0)
2. RPC Manager with single provider (Layer 1)
3. SQLite schema + Trade Journal (Layer 1)
4. PumpPortal WebSocket listener (Layer 2)
5. Safety checks: mint auth, freeze auth, sell simulation (Layer 2)
6. Jupiter Client: quote + swap (Layer 2)
7. Buy flow: Detection -> Safety -> Buy (Layer 3)
8. Basic sell flow with single retry (Layer 3)
9. Simulation mode (shadow portfolio, no real trades)

**Phase 2: Position Management + Sell Reliability + Robustness**
1. Position Monitor with polling (Layer 3)
2. Exit evaluator: stop-loss, take-profit (Layer 3)
3. Sell reliability ladder (Layer 3)
4. Jito bundle support (Layer 4)
5. Multi-RPC failover (Layer 1 enhancement)
6. WebSocket reconnection resilience (Layer 1 enhancement)
7. Crash recovery on restart (Layer 1 enhancement)
8. Structured logging with pino (Layer 0 enhancement)
9. Main pipeline integration (Layer 4)

**Phase 3: Dashboard + Advanced Features**
1. Dashboard HTTP server with REST API (Layer 5)
2. SSE live event stream (Layer 5)
3. Dashboard frontend: trade feed, P&L, config (Layer 5)
4. Tiered take-profit + trailing stop (Layer 3 enhancement)
5. RugCheck API integration (Layer 2 enhancement)
6. Holder concentration check (Layer 2 enhancement)
7. Telegram/Discord alerts (Layer 5 addition)

**Phase 4: Optimization**
1. Direct Pump.fun program calls (bypass PumpPortal fee)
2. Event-driven position monitoring (replace polling)
3. Congestion-aware fee adaptation
4. Geyser gRPC detection (replace WebSocket)

### Build Order Rationale

- **Foundation first** because every subsystem needs config, logging, types, and RPC access.
- **Detection before Safety** because you need token events to test safety checks against.
- **Safety before Execution** because buying without safety checks risks immediate losses.
- **Buy before Sell** because you need open positions to test sell logic.
- **Position monitoring after basic sell** because monitoring triggers sells -- you need the sell path to exist first.
- **Dashboard last** because it is purely observational. The bot must work headlessly first. Building UI before the core pipeline is a common premature-optimization trap.
- **Jito bundles in Phase 2** because standard Jupiter execution is sufficient for testing and tiny trades. Jito adds complexity that is only justified when sell reliability becomes the bottleneck.

## Process Architecture

```
+-----------------------------------------------------------------------+
|  Node.js Process (single)                                              |
|                                                                        |
|  +--EventBus (TypedEmitter)-------------------------------------+     |
|  |                                                               |     |
|  |  Detection   -->  Safety  -->  Execution  -->  Position Mgmt  |     |
|  |      |              |             |               |           |     |
|  +------|--------------|-------------|---------------|------------|     |
|         |              |             |               |                  |
|         v              v             v               v                  |
|  +-- RPC Manager --------+  +-- Trade Journal (SQLite) --+            |
|  | Helius (primary)       |  | trades table               |            |
|  | QuickNode (backup)     |  | config table (optional)    |            |
|  +------------------------+  +----------------------------+            |
|                                                                        |
|  +-- Dashboard Server (Express/Fastify) ---+                          |
|  | GET /api/trades, /api/positions          |                          |
|  | GET /events (SSE)                        |                          |
|  | PUT /api/config                          |                          |
|  | Static file serving (frontend)           |                          |
|  +------------------------------------------+                          |
+-----------------------------------------------------------------------+
```

**Key architectural decision:** Everything runs in one process. The dashboard is an HTTP server started alongside the trading pipeline, not a separate service. This eliminates IPC, shared state synchronization, and deployment complexity. The trade-off is that a dashboard bug could theoretically crash the trading process -- mitigate this with try-catch isolation around dashboard routes and PM2 auto-restart.

## SQLite Schema Design

The database serves three purposes: trade state persistence (crash recovery), trade history (P&L analysis), and configuration persistence (dashboard settings).

```sql
-- Core trade journal
CREATE TABLE trades (
  id TEXT PRIMARY KEY,                    -- UUID v4
  mint TEXT NOT NULL,
  state TEXT NOT NULL,                    -- TradeState enum value
  source TEXT NOT NULL,                   -- "pumpfun" | "raydium"
  entry_price REAL,
  entry_amount REAL,                      -- Token amount received
  entry_sol REAL,                         -- SOL spent
  entry_signature TEXT,
  exit_price REAL,
  exit_amount REAL,
  exit_sol REAL,                          -- SOL received
  exit_signature TEXT,
  exit_reason TEXT,                       -- "STOP_LOSS" | "TAKE_PROFIT" | etc.
  pnl_sol REAL,
  pnl_pct REAL,
  safety_score INTEGER,
  safety_flags TEXT,                      -- JSON array
  retry_count INTEGER DEFAULT 0,
  error_log TEXT,                         -- JSON array of error entries
  resolved_at TEXT,                       -- NULL = unresolved, needs attention on restart
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Indexes for common queries
CREATE INDEX idx_trades_state ON trades(state);
CREATE INDEX idx_trades_mint ON trades(mint);
CREATE INDEX idx_trades_created ON trades(created_at);

-- Metrics/events log (for dashboard analytics)
CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,               -- "detection", "safety_pass", "buy", "sell", etc.
  trade_id TEXT,                          -- FK to trades, nullable for system events
  data TEXT,                              -- JSON payload
  latency_ms INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_events_type ON events(event_type);
CREATE INDEX idx_events_trade ON events(trade_id);

-- Configuration (persisted dashboard settings)
CREATE TABLE config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);
```

**SQLite performance notes:**
- Enable WAL mode (`PRAGMA journal_mode=WAL`) for concurrent reads during writes.
- Use `better-sqlite3` synchronous API -- simpler than async and faster for single-process.
- Batch inserts for events table (buffer and flush every 1-2 seconds) to avoid write amplification.

## Confidence Assessment

| Aspect | Confidence | Basis |
|--------|-----------|-------|
| Event-driven pipeline pattern | HIGH | Matches all open-source Solana sniper bots, validated by existing codebase analysis and research document |
| State machine for trades | HIGH | Standard pattern for transaction workflows; explicitly recommended in research doc |
| Single-process architecture | HIGH | Matches constraints (single wallet, personal tool, SQLite) |
| EventEmitter as internal bus | MEDIUM | Works well at this scale; unverified at 50+ concurrent positions under load |
| Dashboard as in-process HTTP server | MEDIUM | Standard for Node.js tools; risk of dashboard crash affecting trading mitigated by PM2 |
| SQLite WAL mode performance | MEDIUM | Adequate for expected write volume (~10 writes/sec peak); not load-tested |
| SSE for live dashboard updates | MEDIUM | Simpler than WebSocket for unidirectional streaming; browser support is universal |
| Sell escalation ladder as strategy pattern | HIGH | Directly from research doc's 7-level escalation; strategy pattern prevents code bloat |
| Build order (detection before execution before dashboard) | HIGH | Dependency graph makes this the only viable sequence |

## Sources

- `solana-sniper-bot-research.md` (project research document, February 2026) -- primary source for all architecture patterns
- `.planning/codebase/ARCHITECTURE.md` -- existing architecture analysis informing this document
- `.planning/codebase/INTEGRATIONS.md` -- external API integration details (PumpPortal, Jupiter, Jito, RugCheck)
- `.planning/codebase/CONCERNS.md` -- forward-looking risk analysis (32 concerns catalogued)
- `.planning/codebase/STRUCTURE.md` -- planned directory layout and module organization
- Open-source reference: `fdundjer/solana-sniper-bot`, `tjazerzen/sol-sniper-bot` -- architecture patterns observed in community bots (from research doc Section 2)
- Note: WebSearch and WebFetch were unavailable during this research session. Architecture patterns are derived from the project's own research document and codebase analysis. Confidence levels reflect this limitation -- online verification of current API behaviors was not possible.

---

*Architecture research: 2026-02-20*
