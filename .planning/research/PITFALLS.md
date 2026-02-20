# Domain Pitfalls

**Domain:** Solana token sniper bot (Pump.fun / Raydium, first-block execution)
**Researched:** 2026-02-20
**Confidence:** HIGH (based on project research document, codebase concerns analysis, Solana transaction model knowledge, and known failure patterns from open-source sniper bots)

---

## Critical Pitfalls

Mistakes that cause capital loss, forced rewrites, or make the bot fundamentally unprofitable.

### Pitfall 1: Sells Fail Far More Than Buys -- And You Lose Money While They Fail

**What goes wrong:** Developers spend 80% of effort on the buy side (detection, safety, entry speed) and treat sells as "just the reverse." In reality, sells on low-liquidity meme tokens fail at 3-5x the rate of buys. The token you bought 30 seconds ago may now have liquidity pulled, price collapsed 90%, or the pool been drained. Every second a sell fails, the position bleeds value.

**Why it happens:** Buys happen on fresh tokens with initial liquidity. Sells happen later when conditions have degraded -- liquidity is thinner, more sellers are competing, the token may be in a death spiral. Developers test buys first, get them working, and assume sells will "just work" with the same code path. They don't account for the fundamentally different conditions sells operate under.

**Consequences:**
- Bot buys reliably but can't exit positions, turning profits into losses
- Stuck positions lock up trading capital
- Emergency manual selling at massive slippage
- Compounding losses: every failed sell attempt costs priority fees (burned, not refunded)

**Prevention:**
- Build the sell reliability ladder from day one, not as a Phase 2 add-on. The 7-level escalation (standard swap -> higher fees -> Jito bundle -> chunked sell -> emergency slippage) is not optional -- it is the core of the exit system.
- Test sells with the same rigor as buys. Use known low-liquidity tokens in simulation mode to verify each escalation level actually fires.
- Track sell success rate as a first-class metric. If sell success drops below 80%, the bot should reduce position sizing automatically.
- Set a hard time-based exit: if a position cannot be exited within 10 minutes of first sell attempt, alert the operator immediately.

**Detection (warning signs):**
- Sell transactions timing out or returning `SlippageToleranceExceeded` repeatedly
- Growing number of positions in `SELLING` or `STUCK` state
- Rising average hold time (tokens held longer than intended)
- Priority fee spend increasing without corresponding sell confirmations

**Phase:** Must be addressed in Phase 1 (Core Execution). Do not defer sell reliability to Phase 2.

---

### Pitfall 2: WebSocket Connections Die Silently -- Bot Goes Blind Without Knowing

**What goes wrong:** PumpPortal WebSocket and Solana RPC WebSocket connections drop frequently (every 5-30 minutes in practice). The connections often die without emitting an `error` or `close` event. The bot continues running, consuming resources, but receiving zero new token events. It sits idle losing opportunity cost for hours until someone notices.

**Why it happens:** WebSocket connections on Solana infrastructure are inherently unstable. Load balancers rotate, servers restart, network blips occur. Many WebSocket libraries don't detect TCP-level disconnections without explicit keep-alive mechanisms. The developer tests with a working connection and assumes the `on('close')` handler is sufficient.

**Consequences:**
- Bot stops detecting new tokens entirely, missing all trading opportunities
- No error logged because no error event fires
- Operator doesn't know the bot is deaf until they check manually
- If detection is also used for price monitoring, active positions lose exit signal coverage

**Prevention:**
- Build a `ResilientWebSocket` wrapper that implements heartbeat pings every 15-30 seconds. If no pong response within 5 seconds, force-close and reconnect.
- Track `lastMessageReceivedAt` timestamp. If no message received for 60 seconds on PumpPortal (which streams constantly during active markets), assume dead and reconnect.
- Log every reconnection event with a counter. If reconnections exceed 10 in 5 minutes, escalate to operator alert -- something systemic is wrong.
- Never rely on a single WebSocket. Use PumpPortal as primary AND logsSubscribe as secondary detection from Phase 1 (not Phase 3 as some approaches suggest).

**Detection (warning signs):**
- Gap in detection events in the log (e.g., no `NEW_TOKEN` events for 2+ minutes during market hours)
- `lastMessageReceivedAt` growing stale
- Reconnection count spiking
- Trade volume drops to zero while market is active

**Phase:** Must be addressed in Phase 1 (Detection). The resilient WebSocket wrapper is a foundation-level component, not an optimization.

---

### Pitfall 3: Stale Blockhash Causes Systematic Transaction Failures

**What goes wrong:** Solana blockhashes expire after approximately 60 seconds (~150 slots). If the bot fetches a blockhash at the start of the safety pipeline, then spends 300-500ms on checks plus time building and signing the transaction, the blockhash may already be stale -- especially under network congestion where RPCs return cached blockhashes. The result: `BlockhashNotFound` errors on every transaction attempt.

**Why it happens:** The natural code flow is: fetch blockhash -> run safety checks -> build transaction -> sign -> send. This works in testing when safety checks are fast and network is calm. In production during congestion (when you most need reliable execution), safety checks slow down, RPCs lag, and the gap between fetch and send grows past the expiry window.

**Consequences:**
- Transactions systematically fail during high-congestion periods (exactly when new tokens launch most frequently)
- Retry logic fetches the same stale blockhash if it doesn't explicitly refresh
- Bot appears to be buying but no transactions land on-chain
- False sense of execution ("I sent the transaction" but it was dead on arrival)

**Prevention:**
- Fetch blockhash as the absolute last step before signing -- after all safety checks, after transaction construction, immediately before `tx.sign()`.
- Use `'processed'` commitment for blockhash fetching (faster than `'confirmed'`).
- On every retry attempt, fetch a fresh blockhash. Never reuse a blockhash across retries.
- Cache blockhashes locally with a 2-second TTL maximum. After TTL, force a fresh fetch.
- Log the age of each blockhash at send time. If age consistently exceeds 10 seconds, the pipeline is too slow.

**Detection (warning signs):**
- `BlockhashNotFound` errors in transaction logs
- Transaction success rate dropping during peak hours
- High latency between "safety check complete" and "transaction sent" events
- Retry counts increasing without successful lands

**Phase:** Must be addressed in Phase 1 (Core Execution). This is a transaction building fundamental, not an optimization.

---

### Pitfall 4: No Idempotency Causes Double Buys After Crash-Restart

**What goes wrong:** The bot crashes (unhandled exception, OOM, VPS restart) in the middle of a buy flow -- after sending the transaction but before recording confirmation. On restart, the bot sees the token is still "unowned" (no trade journal entry) and buys it again. Now you hold 2x the intended position in the same token.

**Why it happens:** The window between "transaction sent" and "transaction recorded in journal" is a critical section. Without idempotency tracking, any crash in this window creates a duplicate. This isn't a rare edge case -- Solana bots crash frequently due to unhandled RPC errors, WebSocket failures, or memory issues from long-running processes.

**Consequences:**
- Double or triple positions in the same token, multiplying losses on rugs
- Budget exceeded unexpectedly, reducing capital available for other trades
- Incorrect P&L tracking (journal shows one position, wallet shows two)
- Cascading issues: double position means double sell attempts, double monitoring overhead

**Prevention:**
- Implement idempotency from day one using a two-phase approach:
  1. **Pre-send:** Before sending any buy transaction, write a `PENDING` entry to SQLite with `(mint, direction, timestamp)`. This is the intent record.
  2. **Post-confirm:** Update the entry to `CONFIRMED` with the transaction signature.
  3. **On restart:** Query all `PENDING` entries. For each, check on-chain if the transaction landed (by querying wallet token accounts). Resolve as `CONFIRMED` or `FAILED`.
- Maintain an in-memory `Set<string>` of `mint` addresses with active buy intents. Check this set before any new buy attempt.
- Never allow two concurrent buy operations for the same mint address, even across restart boundaries.

**Detection (warning signs):**
- Multiple trade journal entries for the same mint with overlapping timestamps
- Wallet token balance higher than expected for a single position
- Two sell attempts for the same token firing simultaneously
- P&L calculations showing impossible numbers

**Phase:** Must be addressed in Phase 1 (Trade Journal & State Management). This is a data integrity fundamental.

---

### Pitfall 5: Safety Checks Run Sequentially Instead of in Parallel -- Missing Entry Windows

**What goes wrong:** Developers implement safety checks one at a time during development (mint authority check, then freeze authority, then sell simulation, then RugCheck). Each check works individually. But because they're called sequentially with `await`, the total safety pipeline takes 500-1200ms instead of 200-300ms. By the time the bot decides to buy, other bots have already filled.

**Why it happens:** Sequential `await` is the natural way to write async code. It works perfectly in testing. The developer doesn't realize the cumulative latency until they compare their entry timing against competitors. Each individual check seems fast enough (50-300ms), but serially they're catastrophically slow for first-block targeting.

**Consequences:**
- Bot consistently enters 1-3 blocks late instead of first block
- Price has already moved 10-50% by the time buy lands
- Lower fill rate (transactions fail because price moved past slippage tolerance)
- Bot appears to work correctly but is structurally unprofitable

**Prevention:**
- Use `Promise.all()` for all Tier 1 checks from the very first implementation. Never serialize independent checks.
- Pipeline timing target: detection to buy-sent in under 500ms total. Safety checks must complete in under 300ms.
- For Tier 2 checks (RugCheck, holder analysis), use `Promise.race()` with a 100-150ms timeout. If Tier 2 doesn't return in time, proceed with Tier 1 results only.
- Instrument every check with latency measurement and log it. Review P95 latency weekly. If any single check exceeds 200ms at P95, investigate or remove it from the hot path.

**Detection (warning signs):**
- Safety check total duration consistently above 300ms
- Buy transactions landing 2+ blocks after detection event
- High slippage losses (price moved before entry)
- Metrics showing latency variance between checks (one check dominating pipeline time)

**Phase:** Must be addressed in Phase 1 (Safety Evaluation). Parallel execution is not an optimization -- it is the architecture.

---

### Pitfall 6: Hardcoded Slippage Causes Either Failed Trades or Massive Losses

**What goes wrong:** Developer sets slippage to a fixed value (e.g., 10% for buys, 5% for sells) and moves on. For pump.fun bonding curve tokens, 10% is often too low during volatile launches (transactions fail). For established tokens, 10% is way too high (giving away value). For panic sells during dumps, 5% is laughably insufficient (sell never lands).

**Why it happens:** Slippage is one of those parameters that seems like a simple configuration value. In reality, optimal slippage varies by: token state (bonding curve vs. migrated), market conditions (launch frenzy vs. calm), position size relative to liquidity, and whether you're buying or selling. A single value cannot cover all cases.

**Consequences:**
- Too-low slippage: Transactions fail repeatedly, burning priority fees and missing windows
- Too-high slippage: Transactions succeed but at terrible prices, directly reducing profitability
- Sell failures during dumps: Position value goes to zero while the bot retries with insufficient slippage
- Inconsistent behavior that's hard to diagnose ("why did this trade fail but that one worked?")

**Prevention:**
- Use Jupiter's `dynamicSlippage: true` as the default for all transactions. Jupiter simulates the trade and estimates optimal slippage -- trust it over any hardcoded value.
- Define slippage tiers as escalation levels, not fixed values:
  - Buy (bonding curve): start dynamic, escalate to 15%, then 20% on retry
  - Buy (migrated): start dynamic, escalate to 5%, then 10% on retry
  - Sell (normal): start dynamic, escalate to 15%, 25%, 40%
  - Sell (emergency): 49% (get anything back rather than nothing)
- Never allow a single hardcoded slippage constant in the codebase. Make it a function of token state, attempt number, and urgency level.
- Track actual slippage experienced vs. configured slippage. If actual consistently hits the cap, the cap is too low.

**Detection (warning signs):**
- `SlippageToleranceExceeded` as the most common transaction error
- Large gap between expected output amount and actual received amount
- Sell retry count averaging above 2 (first attempt should succeed most of the time)
- Inconsistent profitability across different token states

**Phase:** Must be addressed in Phase 1 (Execution). Dynamic slippage is not a Phase 2 refinement -- it is table stakes for trading volatile tokens.

---

## Moderate Pitfalls

Mistakes that degrade performance, reliability, or operator experience without causing immediate catastrophe.

### Pitfall 7: Polling-Based Position Monitoring Blocks the Event Loop at Scale

**What goes wrong:** Using `setInterval` to poll Jupiter quotes for every active position works with 5 positions but degrades rapidly. At 20-50 positions, each poll cycle takes 4-10 seconds (200-500ms per Jupiter quote call). The event loop blocks during this period, delaying new token detection and buy execution. The bot becomes simultaneously slow at entering new positions AND slow at exiting existing ones.

**Prevention:**
- Start with polling but architect for scale:
  - Use `Promise.all()` within each poll cycle to check positions concurrently, not serially
  - Set position limit in config (`MAX_CONCURRENT_POSITIONS = 10` to start)
  - Batch RPC calls using `getMultipleAccounts` where possible
- Plan for event-driven monitoring (Phase 2): subscribe to pool account changes via `connection.onAccountChange()` to eliminate polling entirely
- Track event loop lag using `perf_hooks`. If lag exceeds 100ms, reduce polling frequency or concurrent positions.
- Consider a tiered polling strategy: check positions nearing TP/SL thresholds every 2 seconds, others every 10 seconds.

**Detection (warning signs):**
- Event loop lag increasing over time
- New token detection latency degrading as position count grows
- Memory usage climbing steadily (listener accumulation)
- Position exit latency increasing (price has moved further past trigger by the time sell fires)

**Phase:** Phase 1 (design with scale in mind), Phase 2 (implement event-driven monitoring).

---

### Pitfall 8: RPC Rate Limits Hit During Peak Activity -- Exactly When You Need Reliability Most

**What goes wrong:** During peak activity (multiple tokens launching simultaneously, volatile markets), the bot's RPC usage spikes. Safety checks, Jupiter quotes, position monitoring, and transaction sending all increase in parallel. The RPC provider rate-limits the bot. Suddenly, safety checks timeout, quotes fail, and transactions don't send. The bot is effectively paralyzed during the highest-opportunity periods.

**Prevention:**
- Track RPC calls per second as a metric. Know your plan's limits (Helius Developer: 50 RPS, Business: 200 RPS).
- Cache aggressively with short TTLs:
  - Blockhash: 2-second cache (shared across all transactions in the window)
  - Mint authority/freeze authority: 1-hour cache (these don't change after creation)
  - Token accounts: 30-second cache
- Use `getMultipleAccounts` instead of multiple `getAccountInfo` calls to batch reads.
- Implement a local rate limiter that queues RPC calls and prioritizes critical operations (sells > buys > safety checks > monitoring).
- Have a backup RPC configured from Phase 1 (even the free tier of a second provider). Failover automatically when primary is rate-limited.

**Detection (warning signs):**
- HTTP 429 (Too Many Requests) responses from RPC
- RPC latency spiking (sign of approaching rate limits)
- Safety check timeouts clustering during busy periods
- Transaction failures correlating with high event frequency

**Phase:** Phase 1 (caching, single RPC awareness), Phase 2 (multi-RPC failover, rate limiter).

---

### Pitfall 9: Priority Fees Burned on Failed Transactions Eat Into Profitability

**What goes wrong:** On Solana, priority fees are charged even when a transaction fails on-chain (not dropped -- the transaction lands but the program instruction fails). Developer sets aggressive priority fees for reliability. Many transactions fail due to slippage, stale quotes, or changed pool state. Each failure costs the priority fee. Over hundreds of trades, burned fees become a significant expense that's invisible in P&L tracking.

**Prevention:**
- Track priority fees as a separate expense line in the trade journal, not buried in transaction cost.
- Use `simulateTransaction` before sending with high priority fees. If simulation fails, don't waste the fee on a real send. The simulation is free.
- Start with moderate priority fees and escalate only on retry. First attempt: `priorityLevel: "high"` (not "veryHigh"). Escalate only after first failure.
- Set a daily priority fee budget. If cumulative fees exceed 0.05 SOL/day, alert and review.
- For buy transactions that are speculative (might be rug), keep priority fees lower. Reserve aggressive fees for sells where you're protecting capital.

**Detection (warning signs):**
- SOL balance decreasing faster than expected (fees draining before trades)
- High ratio of failed-on-chain transactions to successful ones
- Priority fee expense exceeding 5% of trading volume
- `simulateTransaction` showing failures but real transactions still being sent

**Phase:** Phase 1 (simulation before send), Phase 2 (fee budget tracking, adaptive fees).

---

### Pitfall 10: Token State Transitions Mid-Trade (Bonding Curve to Raydium Migration)

**What goes wrong:** The bot detects a pump.fun token on the bonding curve and routes the buy through PumpPortal. Between detection and execution, the token migrates to Raydium (this happens when bonding curve fills). The PumpPortal buy fails because the token is no longer on the bonding curve. The bot retries via PumpPortal again (same route). Multiple failed attempts, token price has moved.

**Prevention:**
- Subscribe to PumpPortal migration events (`subscribeMigration`) from the start.
- Track token state in memory: `BONDING_CURVE | MIGRATING | RAYDIUM`. Update on migration event.
- When a PumpPortal buy fails, check if the failure reason indicates migration. If so, immediately retry via Jupiter (Raydium route), not PumpPortal.
- Design the routing layer to be state-aware: `getSwapRoute(mint)` checks current token state and returns the appropriate API endpoint.
- Set a 10-second maximum time from detection to first buy attempt. If exceeded, re-check token state before attempting.

**Detection (warning signs):**
- PumpPortal buy failures with pool-related errors
- Successful retries only after switching to Jupiter
- Migration events in the log occurring frequently during trading windows
- Growing count of "wrong route" errors in the error log

**Phase:** Phase 1 (state tracking and dual routing). The routing layer must support both paths from the start.

---

### Pitfall 11: Memory Leaks in Long-Running WebSocket Listeners Cause OOM Crashes

**What goes wrong:** Every `connection.onAccountChange()` and `connection.onLogs()` subscription adds an event listener. When a position is closed, if the subscription isn't explicitly removed, it leaks. Over days of running, the bot accumulates thousands of dead listeners. Memory grows monotonically. Eventually the process OOMs and crashes, losing any in-flight state that wasn't persisted.

**Prevention:**
- Store subscription IDs returned by `onAccountChange` and `onLogs`. When a position is closed, call `connection.removeAccountChangeListener(subscriptionId)`.
- Implement a subscription registry that maps `mint -> subscriptionId`. On position close, clean up the registry entry and remove the listener.
- Monitor process memory via `process.memoryUsage()` every 60 seconds. Log and alert if RSS exceeds baseline + 100MB.
- Schedule a periodic cleanup sweep (every 30 minutes) that reconciles active subscriptions against active positions and removes orphans.
- Use WeakRef or explicit cleanup in any event emitter patterns to prevent listener accumulation.

**Detection (warning signs):**
- Memory usage graph trending upward over hours/days (sawtooth pattern = healthy GC; monotonic rise = leak)
- Process RSS exceeding 500MB (a simple Node.js bot should stay under 200MB)
- OOM crash events in PM2 logs
- Increasing count of active WebSocket subscriptions vs. active positions

**Phase:** Phase 1 (subscription cleanup on position close), Phase 2 (monitoring, periodic sweep).

---

### Pitfall 12: PnL Calculations Based on Jupiter Quotes, Not Actual Execution Prices

**What goes wrong:** The bot calculates paper P&L using Jupiter quote output amounts ("I would get X SOL back"). But actual execution price differs due to slippage, priority fees, ATA creation costs, and PumpPortal fees. The dashboard shows +15% profit, but the wallet shows -5% after all costs. The developer optimizes strategy based on inflated P&L numbers.

**Prevention:**
- Calculate P&L only from confirmed on-chain data: actual SOL spent (including all fees) vs. actual SOL received.
- Track all costs per trade explicitly:
  - Transaction fee (base: 5000 lamports)
  - Priority fee (variable)
  - PumpPortal fee (0.5% of trade)
  - ATA creation cost (~0.002 SOL for first buy of new token)
  - Slippage cost (difference between quoted output and actual output)
- Display both "gross P&L" (before fees) and "net P&L" (after all costs) on the dashboard.
- Fetch actual received amounts from on-chain transaction data using `getTransaction(sig)` after confirmation, not from the quote prediction.

**Detection (warning signs):**
- SOL wallet balance declining despite "profitable" trades in the dashboard
- Consistent gap between estimated P&L and actual wallet change
- ATA creation costs not appearing anywhere in cost tracking
- Priority fee spend not reflected in per-trade P&L

**Phase:** Phase 1 (track actual execution data), Phase 2 (dashboard with accurate net P&L).

---

### Pitfall 13: Insufficient Logging Makes Production Debugging Impossible

**What goes wrong:** Developer uses `console.log("buying token", mint)` during development. In production, when a trade fails at 3 AM, the logs show "buying token Abc123..." and then nothing. No latency data, no RPC provider used, no error details, no retry count, no safety score. Debugging requires reproducing the exact market conditions, which is impossible.

**Prevention:**
- Define a structured log schema from day one with required fields for every event:
  ```
  { timestamp, event, mint, signature?, rpcProvider?, latencyMs, retryCount?, error?, safetyScore?, slippageBps?, priorityFeeLamports? }
  ```
- Use `pino` with child loggers per subsystem: `logger.child({ subsystem: 'safety' })`, `logger.child({ subsystem: 'execution' })`.
- Log at every state transition: `DETECTED -> SAFETY_CHECK -> BUYING -> BUY_CONFIRMED -> MONITORING -> SELLING -> COMPLETED`.
- Include timing: measure and log duration of every external call (RPC, Jupiter API, PumpPortal API, RugCheck API).
- Implement a trade ID that follows a trade through all log entries from detection to completion. Use `pino`'s `reqId` pattern.

**Detection (warning signs):**
- Post-incident review reveals insufficient information to determine root cause
- "I don't know why that trade failed" becomes a common statement
- Unable to answer basic questions like "what was the average safety check latency yesterday?"
- Log files filled with unstructured text that's hard to parse or aggregate

**Phase:** Phase 1 (structured logging from the start). This is not optional. Unstructured logging in a trading bot is a debugging death sentence.

---

## Minor Pitfalls

Issues that cause friction, confusion, or minor inefficiencies.

### Pitfall 14: ATA Creation Cost Makes Tiny Trades Unprofitable

**What goes wrong:** First buy of any new SPL token requires creating an Associated Token Account (ATA), costing ~0.002 SOL in rent. For a 0.01 SOL trade, this is a 20% immediate loss before any price movement. The developer tests with 0.005 SOL trades and wonders why everything is unprofitable.

**Prevention:**
- Set minimum position size to 0.02 SOL to ensure ATA creation cost stays below 10% of position.
- Account for ATA cost in the P&L calculation for every trade.
- Jupiter's `wrapAndUnwrapSol: true` handles ATA creation automatically, but the cost is still real.
- Consider pre-creating ATAs for frequently-traded tokens (not practical for new launches, but useful for known high-volume pairs).

**Phase:** Phase 1 (minimum position sizing), Phase 2 (accurate cost accounting).

---

### Pitfall 15: Devnet Testing Gives False Confidence

**What goes wrong:** Developer builds the full pipeline on devnet, everything works perfectly. Moves to mainnet and discovers: devnet has different DEXs (no Jupiter, no Raydium), different fee structures, no real liquidity, no competition, and no network congestion. Every assumption from devnet testing is invalid.

**Prevention:**
- Use mainnet simulation mode (build, sign, simulate via `connection.simulateTransaction`, but don't send) instead of devnet.
- Use tiny-wallet sacrificial trades on mainnet (0.005 SOL) to validate the real pipeline.
- Devnet is only useful for testing Solana SDK basics (keypair generation, transaction construction). Never trust devnet for anything execution-related.
- Define explicit "graduation criteria" from simulation to tiny-real to full-size (see Testing doc).

**Phase:** Phase 1 (simulation mode on mainnet, not devnet).

---

### Pitfall 16: Ignoring Transaction Size Limits Causes Mysterious Failures

**What goes wrong:** Jupiter sometimes returns complex routes with many intermediate hops and account lookups. The serialized transaction exceeds Solana's 1232-byte limit. The transaction fails with a cryptic error. Developer spends hours debugging what looks like a serialization issue.

**Prevention:**
- Always include `maxAccounts: 64` in Jupiter quote requests to constrain route complexity.
- Before sending, check `tx.serialize().length`. If it exceeds 1200 bytes, reject and re-request with `maxAccounts: 32`, then 16.
- Log transaction size as a metric. Track and alert if average size is growing (indicates changing route patterns).

**Phase:** Phase 1 (include `maxAccounts` in all Jupiter calls).

---

### Pitfall 17: Not Handling Token-2022 Extensions Gracefully

**What goes wrong:** Most pump.fun tokens use standard SPL Token program. Occasionally, tokens use Token-2022 with extensions (transfer hooks, confidential transfers). The bot's safety checks and swap execution assume standard SPL and fail with opaque errors.

**Prevention:**
- Check the token's owning program ID. If it's `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb` (Token-2022), flag it for special handling.
- Set higher compute units (up to 1.4M) for Token-2022 tokens.
- Consider blocking Token-2022 tokens entirely in Phase 1 as a simplification. They're a small minority of pump.fun tokens and add disproportionate complexity.
- If allowing them, add `isProgrammable` to the token info cache and the safety score output.

**Phase:** Phase 1 (detect and block), Phase 3 (support with higher compute).

---

### Pitfall 18: Wallet Key Compromise From Sloppy Secret Management

**What goes wrong:** Developer commits `.env` to git (even once -- git history is permanent). Or logs the private key during debugging. Or stores it in a config file without proper permissions on VPS. An attacker drains the wallet.

**Prevention:**
- Add `.env` to `.gitignore` before the first commit. Verify with `git status` before every push.
- Never, under any circumstances, log the private key. Search the codebase for any log statement that includes `WALLET_PRIVATE_KEY` or the keypair object.
- On VPS: store key in environment variable set by systemd service file (mode 600), not in a file the web server can read.
- Hot wallet should hold only 1-5 SOL maximum. Sweep excess to a hardware wallet periodically.
- Implement a `canary` check: on startup, verify wallet balance is within expected range. If it's zero unexpectedly, alert immediately and halt.

**Phase:** Phase 1 (gitignore, no-log policy, minimum balance), Phase 2 (VPS hardening, auto-sweep).

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| Phase 1: Detection | WebSocket dies silently (Pitfall 2) | Build resilient WebSocket wrapper with heartbeat as the first component |
| Phase 1: Safety Checks | Sequential execution kills entry timing (Pitfall 5) | Use `Promise.all()` from first implementation; never serialize independent checks |
| Phase 1: Buy Execution | Stale blockhash (Pitfall 3), no idempotency (Pitfall 4) | Fetch blockhash last; write PENDING to journal before send |
| Phase 1: Sell Execution | Sells treated as afterthought (Pitfall 1) | Build sell reliability ladder alongside buy flow, not after |
| Phase 1: State Management | Double buys on restart (Pitfall 4) | Idempotency keys in SQLite checked before every buy |
| Phase 1: Configuration | Hardcoded slippage (Pitfall 6) | Use dynamic slippage by default; slippage as function, not constant |
| Phase 2: Position Monitoring | Event loop blocking at scale (Pitfall 7) | Cap concurrent positions; use Promise.all in poll cycle; plan for event-driven |
| Phase 2: Multi-RPC | Rate limits during peak (Pitfall 8) | Cache aggressively, batch reads, implement rate-aware request queue |
| Phase 2: Dashboard | P&L based on quotes not execution (Pitfall 12) | Track all costs explicitly; compute P&L from on-chain confirmed data |
| Phase 2: Jito Bundles | Priority fees burned on failures (Pitfall 9) | Simulate before sending; escalate fees gradually; track fee spend |
| Phase 3: Optimization | Memory leaks from listeners (Pitfall 11) | Subscription registry with cleanup; memory monitoring |
| Phase 3: Scaling | Concurrent position ceiling (Pitfall 7) | Event-driven monitoring; load test to find actual limits |
| All Phases: Operations | Insufficient logging (Pitfall 13) | Structured JSON logging with defined schema from day one |
| All Phases: Security | Wallet compromise (Pitfall 18) | Gitignore, no-log policy, hot wallet limits, VPS hardening |

---

## Anti-Patterns Summary

These are patterns that seem reasonable but lead to problems in this specific domain:

| Anti-Pattern | Why It Seems Right | Why It's Wrong | Do This Instead |
|-------------|-------------------|----------------|-----------------|
| Test on devnet first | Standard blockchain dev practice | Devnet has no real DEXs, no liquidity, no competition | Simulation mode on mainnet |
| Build buys first, sells later | Natural development order | Sells are harder and more critical; deferring creates false confidence | Build buy + sell together |
| Cache Jupiter quotes | Reduce API calls | Quotes expire in seconds; cached quotes produce failed transactions | Fetch fresh quote immediately before each transaction |
| Use a single high slippage value | Simpler code | Too high wastes money; too low fails transactions | Dynamic slippage with escalation tiers |
| Run safety checks then build transaction | Clean sequential flow | Cumulative latency misses entry window | Parallel checks, build transaction only after pass |
| Start with one RPC provider | Simpler setup | Single point of failure; no fallback during outages | Configure backup RPC from day one (even free tier) |
| Optimize for buy speed only | Speed is the core value prop | Profitable bots need reliable exits more than fast entries | Balance entry speed with exit reliability |

---

## Sources

- Project research document (`solana-sniper-bot-research.md`, 2026-02-19) -- primary source for Solana execution patterns, failure modes, and architecture decisions
- Project codebase concerns analysis (`.planning/codebase/CONCERNS.md`, 2026-02-20) -- 32 identified forward-looking risks
- Known failure patterns from open-source sniper bot repositories: `fdundjer/solana-sniper-bot`, `tjazerzen/sol-sniper-bot`
- Solana transaction model knowledge: blockhash expiry, priority fee mechanics, transaction size limits, commitment levels
- Confidence note: Web search was unavailable during research. All findings are based on project-internal research documents and training data knowledge. Recommend validating Jito bundle mechanics and PumpPortal API behavior against current official docs during implementation.

---

*Pitfalls audit: 2026-02-20*
