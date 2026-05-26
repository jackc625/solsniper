# Codebase Concerns

**Analysis Date:** 2026-02-20

## Project Status

This is a research-phase project with no implemented codebase yet. The following concerns are forward-looking — identified risks and technical debt to avoid during implementation.

---

## Architectural Concerns

### 1. Single-Process Bottleneck for Concurrent Trades
**Files:** Not yet implemented; affects: position monitoring, sell execution
**Risk:** Using `setInterval` or polling-based position monitoring with `Map<string, Position>` will not scale beyond ~20-50 concurrent positions before event loop blocking occurs.
**Impact:** Missed take-profit opportunities, delayed stop-loss execution, especially during high-volatility windows.
**Safe modification:** Implement event-driven architecture from the start. Use account change subscriptions via `connection.onAccountChange()` instead of polling. If polling is necessary, offload to worker threads or split monitoring across multiple bot instances.

### 2. Sell Execution Complexity Not Isolated
**Files:** Not yet implemented; affects: transaction retry logic, fee escalation
**Risk:** The sell reliability ladder (6+ escalation levels) will grow complex quickly. Mixing retry logic, fee/slippage escalation, and Jito bundle fallbacks in a single function will make it fragile.
**Impact:** When one escalation level fails, the entire sell sequence becomes unclear. Testing individual escalation tiers becomes difficult.
**Safe modification:** Extract sell escalation into a dedicated module with clearly separated steps. Each level should be independently testable. Use a state machine or queue-based approach rather than nested try-catch blocks.

### 3. WebSocket Resilience Not Designed In
**Files:** Not yet implemented; affects: detection, price monitoring
**Risk:** PumpPortal and Solana RPC WebSockets drop frequently. The research document notes they "drop silently without error events." Implementing reconnection logic as an afterthought will cause many trades to be missed.
**Impact:** Bots will stop detecting new tokens or monitoring positions after 5-30 minutes without alerting the operator.
**Safe modification:** Build resilient WebSocket connection wrapper from the beginning. Use exponential backoff, heartbeat/ping checks, and automatic reconnection. Never rely on a single WebSocket connection.

### 4. RPC Multi-Provider Strategy Not Clear
**Files:** Not yet implemented; affects: transaction submission, quote fetching
**Risk:** The research suggests sending to "ALL providers simultaneously" but doesn't address consistency issues when providers disagree on state (e.g., one RPC shows a position balance, another doesn't).
**Impact:** Race conditions in transaction submission, inconsistent account state reads leading to failed transactions.
**Safe modification:** Define clear rules for provider selection per operation type: reads use round-robin with fallback, transaction submissions use all-simultaneous with signature deduplication, critical reads use majority-vote approach.

---

## Execution & Reliability Concerns

### 5. Slippage Management Is Manual & Error-Prone
**Files:** Not yet implemented; affects: swap transaction building
**Risk:** The research recommends `dynamicSlippage: true` for Jupiter but notes developers often hardcode values. Without careful implementation, slippage will either be too conservative (failed sells) or too aggressive (heavy losses).
**Impact:** Frequent failed sell transactions during volatility, or significant slippage losses when dynamic slippage isn't properly integrated.
**Safe modification:** Always use dynamic slippage by default. Only allow manual override in exceptional cases with explicit logging. Never hardcode slippage values in the codebase — make them configurable per token tier (pump.fun pre-migration: 10-20%, established: 1-5%, etc.).

### 6. Blockhash Staleness Not Addressed
**Files:** Not yet implemented; affects: transaction building, retry logic
**Risk:** The research warns that "blockhash can return stale data under load." If safety checks take >5 seconds, fetching blockhash before checks will cause transactions to fail with `BlockhashNotFound`.
**Impact:** Transactions systematically fail if safety pipeline is slow, especially during network congestion.
**Safe modification:** Always fetch blockhash immediately before signing, not before starting safety checks. Use `'processed'` commitment for speed. Build retry logic that re-fetches blockhash on each attempt.

### 7. No Idempotency Keys for Duplicate Prevention
**Files:** Not yet implemented; affects: crash recovery
**Risk:** The research notes "Without idempotency, crash-and-restart can cause double buys" but doesn't specify implementation. A bot crash during buy confirmation will likely retry the same mint multiple times on restart.
**Impact:** Multiple purchases of the same token due to duplicate transactions, inflating losses.
**Safe modification:** Implement idempotency keys from day one. Track `(tokenMint, direction, timestamp)` in an in-memory Set with SQLite persistence. Before any transaction send, check this set. On restart, query the journal for pending transactions and resolve them.

### 8. Sell Simulation as Honeypot Check
**Files:** Not yet implemented; affects: safety checks
**Risk:** The research recommends calling Jupiter quote for a simulated sell as a honeypot detector. But Jupiter quotes can be expensive (200-500ms per call) and if run sequentially with other Tier 1 checks, will slow down safety pipeline to >500ms.
**Impact:** Missed entry windows, especially for fast-moving tokens on pump.fun bonding curve.
**Safe modification:** Run sell simulation in parallel with mint/freeze authority checks. If the safety pipeline target is 200-300ms total, use `Promise.all()` for all Tier 1 checks. Never serialize them.

---

## Data & State Concerns

### 9. Trade Journal Schema Not Defined for Recovery
**Files:** Not yet implemented; affects: crash recovery, trade history
**Risk:** The research shows a SQLite schema but doesn't address how to resume trades in intermediate states (e.g., a trade stuck in `BUYING` for 5 minutes). No clear definition of "resolved" state.
**Impact:** Stuck positions that the bot doesn't retry on restart, or worse, positions it retries multiple times.
**Safe modification:** Define explicit state transition rules in the schema. Add a `resolved_at` timestamp and `resolution` enum (`SUCCESS`, `FAILED_GIVE_UP`, `MANUAL_INTERVENTION`). On startup, only resume trades with `resolved_at IS NULL`. Set a timeout (e.g., 10 minutes) — if a trade hasn't progressed, alert and mark as `MANUAL_INTERVENTION`.

### 10. No Explicit Position Closure Semantics
**Files:** Not yet implemented; affects: PnL tracking, position accounting
**Risk:** A position is closed when sell confirms, but the research doesn't clarify: what if the sell confirms but fees are taken by the exchange? How is partial fill handled (e.g., you sell 50% at take-profit)?
**Impact:** Incorrect PnL calculations, especially with tiered take-profit where multiple sells occur.
**Safe modification:** Define position closure as "sell transaction confirmed at 'confirmed' commitment level AND tokens received in wallet." Track partial exits separately. Calculate PnL only after wallet state is verified, not after transaction confirmation.

### 11. No Clear Fallback When All Escalation Levels Fail
**Files:** Not yet implemented; affects: stuck position handling
**Risk:** The sell reliability ladder goes to "Level 7: Log as stuck position." But what happens next? No clear action for the operator.
**Impact:** Positions stuck indefinitely, capital locked, operator unaware or unsure how to manual exit.
**Safe modification:** Define explicit "stuck position" rules. After all escalation levels fail, immediately log with critical severity, set position state to `STUCK`, alert the operator (Telegram/Discord), and provide a manual exit command. Auto-attempt recovery every 30 minutes but don't block other trades.

---

## Safety & Detection Concerns

### 12. Parallel Safety Checks Can Mask Timing Issues
**Files:** Not yet implemented; affects: RugCheck API integration
**Risk:** The research recommends running RugCheck in parallel with Tier 1 checks but notes "don't wait for it — treat it as Tier 2." If RugCheck API returns slowly or fails intermittently, the bot will sometimes score a token as safe when it should have rejected it.
**Impact:** Inconsistent decision-making. A token rejected on one run but accepted on another due to API availability.
**Safe modification:** Always fetch RugCheck if available, but with a strict timeout (e.g., 100ms max). Cache results for 5 minutes to avoid redundant calls. If timeout occurs, use Tier 1 results only. Log every RugCheck timeout for monitoring.

### 13. RugCheck Score Interpretation Not Standardized
**Files:** Not yet implemented; affects: Tier 2 scoring
**Risk:** RugCheck returns a numeric score (0-1000) and a `risks` array. The research shows one example (`if (rugReport.score > 500)`) but doesn't define score thresholds or how to weight different risk types.
**Impact:** Different versions of the bot may interpret the same token differently, making it hard to reproduce safety decisions.
**Safe modification:** Create a documented RugCheck scoring rubric. Define explicit thresholds (e.g., score > 600 = -30 points, "freeze_authority_active" = hard block). Version this rubric and log the version used for every trade decision.

### 14. No Guidance on Token State Transitions
**Files:** Not yet implemented; affects: detection, routing
**Risk:** Pump.fun tokens transition from bonding curve → migration → Raydium/PumpSwap. The bot must handle all three states, but the research doesn't specify how to detect state changes or what to do if a token migrates mid-trade.
**Impact:** Bots may attempt to route through PumpPortal after migration (fee wasted) or miss the migration signal entirely.
**Safe modification:** Track token state explicitly in the trade journal. Subscribe to migration events via PumpPortal WebSocket. When migration detected, update cached token state. If a buy attempt fails with "wrong route," re-detect the token state before retry.

---

## Observability & Debugging Concerns

### 15. Structured Logging Plan Is Too Vague
**Files:** Not yet implemented; affects: post-incident analysis
**Risk:** The research recommends "pino for JSON logging" but doesn't define log schema, what fields are required, or sampling strategy. Without this, logs will be inconsistent and hard to analyze.
**Impact:** When a trade fails, it's hard to reconstruct what happened. No clear correlation between events.
**Safe modification:** Define a JSON log schema with required fields: `timestamp`, `event`, `mint`, `signature` (if transaction), `error` (if failure), `latencyMs`, `rpc_provider`, `retry_count`. Add context middleware that includes `botInstance` and `deploymentEnvironment`. Use structured logging from day one.

### 16. No Metrics Collection Plan for Profiling
**Files:** Not yet implemented; affects: performance optimization
**Risk:** The research lists metrics to track (win rate, avg PnL, latency) but doesn't specify how to collect or store them. Without baseline metrics, it's impossible to optimize the bot.
**Impact:** Can't tell if the bot is improving or degrading over time. Optimization efforts are guesswork.
**Safe modification:** Implement metrics collection early. Use a simple approach: write metrics to SQLite as events (e.g., `execution_latency_ms: 340`, `safety_check_duration_ms: 280`). Add a post-processing script to calculate aggregates hourly. Store baseline metrics before making any optimization changes.

---

## Testing & Verification Concerns

### 17. Simulation Mode Verification Not Specified
**Files:** Not yet implemented; affects: validation before live trading
**Risk:** The research recommends simulation mode for weeks 1-2, but doesn't define what success looks like. "Run simulation mode for 3+ days, analyze results" is too vague.
**Impact:** Bot moves to real trading without clear success criteria, potentially with latent bugs.
**Safe modification:** Define explicit simulation success criteria before coding: e.g., "10+ safety check pass/fail decisions match RugCheck API consensus," "sell simulation accuracy > 95% (simulated exit price within 5% of actual quote)," "no duplicate buy signals in 1M+ events." Generate a simulation report before moving to Phase 2.

### 18. No Deterministic Testing Plan for Flaky Components
**Files:** Not yet implemented; affects: WebSocket, RPC, external API reliability
**Risk:** Testing WebSocket reconnection, RPC failover, and API timeouts requires simulating failures. Without deterministic test cases, these code paths won't be exercised.
**Impact:** First failure in production reveals bugs that should have been caught in testing.
**Safe modification:** Build test harness that mocks RPC failures, WebSocket drops, and slow API responses. Define test cases: "RPC times out on 3 consecutive calls, then recovers on 4th," "WebSocket closes after 5 seconds of idle messages," "RugCheck API returns 500 error." Verify bot handles each scenario without crashing.

### 19. No Load Testing Plan for Concurrent Positions
**Files:** Not yet implemented; affects: scalability limits
**Risk:** The research mentions "Watching 50+ positions" but doesn't test how many positions the bot can actually monitor before event loop blocking or memory issues.
**Impact:** Bot works fine with 5 positions, starts missing exits at 50 positions, but this isn't discovered until production.
**Safe modification:** Build a load test that spins up 50 mock positions with simulated price updates. Measure latency of exit checks and memory usage. Document the maximum concurrent positions the bot can safely handle and set a hard limit in config.

---

## Operational & Deployment Concerns

### 20. No Clear Secrets Management Strategy
**Files:** Not yet implemented; affects: security, recovery
**Risk:** The research mentions "wallet private key is the most sensitive secret" but doesn't specify how to store it securely on VPS or how to rotate it.
**Impact:** Private key leak exposes all bot capital. No strategy for emergency wallet rotation.
**Safe modification:** Define explicit secret storage rules: local dev uses `.env` (in `.gitignore`), VPS uses environment variables set via systemd or PM2 config. Never commit any `.env` file. Implement a key rotation strategy: test it quarterly, document the process, and have a manual recovery procedure if the key is compromised.

### 21. No Monitoring/Alerting for Bot Health
**Files:** Not yet implemented; affects: operational awareness
**Risk:** The research suggests "alerts: bot crashed / not running" but doesn't specify how. If the bot dies silently (e.g., segfault in native module), the operator won't know.
**Impact:** Bot down for hours, missing trades, no visibility.
**Safe modification:** Use PM2 with log file monitoring or a separate health check script. Set up a Telegram bot that sends heartbeat messages every 5 minutes (or alerts if heartbeat is missed). Log every state transition and critical decision. If the bot doesn't log a state change for >10 minutes, escalate to alert.

### 22. Wallet Risk Concentration Not Addressed
**Files:** Not yet implemented; affects: operational security
**Risk:** The research notes "consider using a hardware wallet for large balances" but doesn't define the threshold or separation strategy.
**Impact:** A single compromised VPS exposes all bot capital. No clear recovery if the operational wallet is drained.
**Safe modification:** Define a tiered wallet strategy: hot wallet (VPS) holds 1-5 SOL max (day's trading), warm wallet holds 10-50 SOL (1-2 weeks), cold wallet holds reserves (hardware wallet). Implement auto-sweep from hot to warm wallet when balance exceeds threshold.

### 23. VPS Configuration & Hardening Not Specified
**Files:** Not yet implemented; affects: security, uptime
**Risk:** The research recommends Hetzner VPS but doesn't specify firewall, SSH key management, or update strategy.
**Impact:** VPS compromised due to open ports, bot wallet stolen, unplanned downtime due to missing security patches.
**Safe modification:** Document VPS setup checklist: disable password SSH login, use key-based auth only, close all ports except SSH and required APIs, enable UFW firewall, set up unattended-upgrades for security patches. Include this in deployment documentation.

---

## Dependencies & Integration Concerns

### 24. Jupiter API Version Pinning Not Explicit
**Files:** Not yet implemented; affects: API stability
**Risk:** The research recommends using the Jupiter REST API directly rather than the `@jup-ag/api` SDK to avoid version lag. But direct REST API endpoints can change. No version management strategy specified.
**Impact:** A Jupiter API change breaks swap building, bot stops executing trades.
**Safe modification:** If using REST API directly, explicitly version each endpoint URL. Monitor Jupiter's status page and changelog. If using the SDK, pin the version in `package.json` and document when/why to update. Test API changes in simulation mode before deploying.

### 25. PumpPortal Dependency Risk
**Files:** Not yet implemented; affects: detection, execution
**Risk:** The bot depends heavily on PumpPortal WebSocket for detection and trade-local API for execution. If PumpPortal goes down or rate-limits, the bot is blocked.
**Impact:** No fallback detection method, bot sits idle during PumpPortal outages.
**Safe modification:** Implement logsSubscribe as a backup detection method from the start (Phase 1, not Phase 3). Test failover: simulate PumpPortal WebSocket drop and verify bot switches to logsSubscribe. Document SLA expectations for each detection source.

### 26. RugCheck API Hard Dependency for Tier 2 Scoring
**Files:** Not yet implemented; affects: safety decisions
**Risk:** If RugCheck API is unavailable, the research suggests skipping it, but the bot may accept riskier tokens due to missing Tier 2 data.
**Impact:** Higher rug rate during RugCheck outages.
**Safe modification:** Cache RugCheck results aggressively (24+ hours). If API is unavailable and no cache, fall back to Tier 1 checks only (which are already strict). Log cache hits/misses for monitoring.

---

## Performance & Scaling Concerns

### 27. Memory Leaks in Long-Running WebSocket Listeners
**Files:** Not yet implemented; affects: uptime, stability
**Risk:** PumpPortal and Solana WebSocket connections, if not properly cleaned up, can leak memory over days/weeks. Event listeners added without removal grow unbounded.
**Impact:** Bot consumes more memory over time, eventually crashes due to OOM.
**Safe modification:** Use explicit event listener cleanup. Store references to all `onAccountChange`, `onLogs`, WebSocket listeners. Implement a periodic cleanup routine that removes dead listeners. Monitor memory usage and log if it exceeds baseline + 50MB.

### 28. No Batching or Rate Limit Strategy for RPC Calls
**Files:** Not yet implemented; affects: quota, cost
**Risk:** Each safety check, each position monitor poll, and each sell attempt makes RPC calls. Without batching, a bot with 50 positions calling `getLatestBlockhash` 10 times per second will quickly exceed RPC rate limits.
**Impact:** RPC provider throttles or rate-limits the bot, transactions fail with rate limit errors.
**Safe modification:** Batch RPC calls aggressively. Use `getProgramAccounts` and `getMultipleAccounts` instead of individual calls. Implement local caching with TTL (e.g., cache blockhash for 2 seconds, mint authority for 1 hour). Monitor RPC rate usage and alert when approaching limits.

### 29. No Configuration for Network Congestion Adaptation
**Files:** Not yet implemented; affects: profitability
**Risk:** The research notes "time-of-day matters" for network congestion but the bot has no adaptive strategy.
**Impact:** Bot uses the same priority fees and slippage during Asia market open (high congestion) as during quiet periods (low congestion), leading to wasted fees or failed transactions.
**Safe modification:** Implement congestion-aware fee strategy. Fetch recent block height and track transaction success rate by fee tier. Dynamically adjust priority fees based on empirical success rate. Log congestion level for analysis.

---

## Known Gotchas (From Research)

### 30. Associated Token Account (ATA) Creation Cost
**Files:** Not yet implemented; affects: first buy profitability
**Risk:** First buy of any new token costs extra ~0.002 SOL for ATA creation. This can be significant for 0.01 SOL test trades.
**Impact:** First trade of a token has automatic -20% slippage from account creation cost.
**Safe modification:** Always account for ATA creation cost in position sizing. For tokens under 0.005 SOL, consider skipping them. Use Jupiter's `wrapAndUnwrapSol: true` to handle ATAs automatically.

### 31. Token-2022 Extensions Handling
**Files:** Not yet implemented; affects: exotic token support
**Risk:** Most pump.fun tokens use standard SPL, but some have transfer hooks or extensions. The bot may fail on these tokens without clear error messages.
**Impact:** Failed transactions on Token-2022 tokens without proper error classification.
**Safe modification:** Add a token-info cache that includes `isProgrammable` flag. If true, set compute limit higher (up to 1.4M) and add Token-2022 to the error message whitelist.

### 32. Solana Transaction Size Limits (1232 bytes)
**Files:** Not yet implemented; affects: complex routes
**Risk:** Complex Jupiter routes with many hops can exceed transaction size. The research recommends `maxAccounts: 64` to constrain complexity.
**Impact:** Arbitrarily rejected swaps with "Transaction too large" error.
**Safe modification:** Always include `maxAccounts: 64` in Jupiter quote requests. Test size before sending. If Jupiter returns a route that causes tx to exceed 1232 bytes, reject it and try with lower `maxAccounts` (32, then 16).

---

## Summary of Priority Fixes

**High Priority (Do before Phase 1):**
- Define WebSocket resilience strategy and connection wrapper
- Implement idempotency key tracking for duplicate prevention
- Create detailed trade journal schema with state definitions
- Define slippage management rules and dynamic slippage defaults

**Medium Priority (Do in Phase 1-2):**
- Implement parallel safety checks with Promise.all
- Define RugCheck score thresholds and risk weights
- Set up RPC multi-provider strategy with rules per operation type
- Create structured logging schema with required fields

**Low Priority (Do before production):**
- Load test concurrent position handling (verify scalability)
- Create VPS hardening checklist and secrets management strategy
- Implement congestion-aware fee adaptation
- Document API versioning and failover strategies for external dependencies

---

*Concerns audit: 2026-02-20*
