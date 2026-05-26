# Domain Pitfalls: v1.1 Hardening & Polish

**Domain:** Security hardening, safety improvements, trading optimization, and reliability for an existing Solana token sniper bot
**Researched:** 2026-03-27
**Scope:** Common mistakes when ADDING these features to a shipped v1.0 codebase

---

## Critical Pitfalls

Mistakes that cause regressions, security gaps, or financial loss.

---

### Pitfall 1: Security Fix Introduces Latency on the Hot Path

**What goes wrong:** The SQL injection fix, request validation, or API key refactor adds measurable latency to the detection-to-execution pipeline. Even 50ms added to the hot path can mean missing first-block inclusion. The bot's core value proposition is speed -- security changes that touch the pipeline are high-risk for performance regression.

**Why it happens:** Security and speed are fundamentally in tension. Developers add validation layers, replace synchronous operations with async ones, or introduce additional network hops (e.g., moving API key from URL param to a header that requires a new auth handshake) without profiling the impact.

**Consequences:** Buy transactions land in block 2-3 instead of block 1. Over hundreds of trades, this compounds into significantly worse entry prices and lower win rates. The bot still "works" but profitability degrades silently.

**Prevention:**
- The SQL template literal issue in `trade-store.ts` line 100 is actually already using `?` placeholders generated from `NON_TERMINAL_STATES.map(() => '?').join(',')` -- verify whether this is a real injection risk or a false positive before refactoring. The comment `// ship-safe-ignore` suggests it was already reviewed. All other SQL in TradeStore uses prepared statements with named parameters. The actual risk here is LOW.
- The Helius API key change in `tier3-creator.ts` (URL query param to header) is safe because this runs in Tier 3 (parallel, behind Tier 1 short-circuit). It cannot slow the buy path. Fix freely.
- Profile before/after for any change touching `index.ts` event handler, `SafetyPipeline.evaluate()`, or `ExecutionEngine.buy()`.
- Zod validation on the `/api/config` endpoint is already implemented (lines 11-41 of `config.ts`). The BUGS.md finding appears to be already fixed. Verify before doing duplicate work.

**Detection:** Track pipeline duration via the existing `durationMs` field in safety logs. Regression = median duration increase >10ms.

**Confidence:** HIGH -- based on direct codebase analysis.

---

### Pitfall 2: Dependency Update Breaks Native Module or ESM Interop

**What goes wrong:** Running `npm audit fix --force` or bumping a transitive dependency breaks `better-sqlite3` (CJS native module in ESM project), `@solana/spl-token` (depends on `bigint-buffer`), or the `ws` WebSocket library.

**Why it happens:** The project uses ESM with `createRequire()` for CJS interop (trade-store.ts lines 22-23). This is fragile. The `bigint-buffer` vulnerability (GHSA-3gc7-fjrx-p6mg) has **no patched version** (`<0.0.0`), meaning the only fix is replacing the dependency chain or accepting the risk. `picomatch` vulnerabilities are in devDependencies via `@preact/preset-vite` (build-only, not runtime). The `fastify` header-spoofing issue (<=5.8.2) is a direct dependency with a simple version bump to 5.8.3+.

**Consequences:**
- `better-sqlite3` build failure = bot cannot start, trades database inaccessible
- `@solana/spl-token` breakage = authority checks, token balance queries, and ATA lookups all fail
- Silent type errors from `@types/better-sqlite3` mismatch that only surface at runtime

**Prevention:**
- **Never run `npm audit fix --force`**. Manually update one dependency at a time, test, then move to next.
- The `bigint-buffer` vulnerability is in `@solana/buffer-layout-utils` (transitive via `@solana/spl-token`). This package is deprecated and replaced in `@solana/spl-token` v0.5.x. Check if upgrading to spl-token 0.5.x resolves it, but be prepared for API changes.
- `picomatch` vulns are dev-only (Vite/Preact build tooling). They cannot be exploited at runtime. Document as "accepted risk" or update `@preact/preset-vite` to a version with fixed transitive deps.
- `fastify` 5.8.3 is a patch bump -- safe to apply. The X-Forwarded-Proto/Host spoofing is low-risk for this project (dashboard listens on 127.0.0.1 only, no reverse proxy), but fix anyway.
- The `brace-expansion` vuln is via `@fastify/static > glob > minimatch`. Check if `@fastify/static` has a newer version with fixed transitives.
- After any dependency change, run the full test suite AND manually verify: `createRequire()` still resolves `better-sqlite3`, `unpackMint()` still works for both TOKEN_PROGRAM_ID and TOKEN_2022_PROGRAM_ID, WebSocket connections still establish.

**Detection:** CI build failure, or worse: silent runtime errors when a CJS module loads incorrectly under ESM.

**Confidence:** HIGH -- dependency tree verified via `pnpm audit` output.

---

### Pitfall 3: Safety Scoring Calibration Change Causes Cascade of Missed Trades or Rug Losses

**What goes wrong:** Adjusting safety weights, thresholds, or adding new checks shifts the aggregate score distribution. Tokens that previously passed now fail (missed alpha), or tokens that previously failed now pass (rug exposure). Small threshold changes have outsized effects because the score distribution is clustered near the threshold.

**Why it happens:** The weighted scoring system (rugCheck 40%, holder 30%, creator 30%) produces an aggregate 0-100 score compared against `minSafetyScore`. A 5-point weight shift can flip the pass/fail decision for 20-30% of tokens near the threshold. There is no backtesting or historical analysis tooling to preview the impact.

**Consequences:**
- Threshold too aggressive: bot stops buying anything, appears "broken"
- Threshold too permissive: bot buys rug pulls, direct financial loss
- New check with incorrect scoring: systematic bias (e.g., all pumpportal tokens score 0 on new check because the check only works for migrated tokens)

**Prevention:**
- Run any scoring changes in **dry-run mode first** for at least 24-48 hours. The dry-run system (DRY-01 through DRY-08) is already built -- use it.
- Log the full score breakdown (already present in safety pipeline logs: tier1, tier2, tier3, aggregateScore). Analyze score distributions BEFORE changing thresholds.
- When adding a new safety check: start with weight=0 (logging only), observe scores for 24h, then gradually increase weight.
- Never change more than one scoring parameter at a time. Change weight OR threshold OR add check -- not multiple simultaneously.
- Guard against the "new check returns 0 for API timeout" problem: the existing pessimistic pattern (pass=true, score=0 on error) means API failures drag down the aggregate. A new check that frequently times out will systematically lower scores and reject more tokens.

**Detection:** Compare daily pass rate before/after. If pass rate changes by >20%, something is wrong.

**Confidence:** HIGH -- directly derived from codebase scoring mechanics in `safety-pipeline.ts`.

---

### Pitfall 4: RPC Failover Hardening Creates Split-Brain During Sell Execution

**What goes wrong:** The RPC manager currently creates `Connection` objects at startup and passes them to components. If failover hardening changes which connection object is active during a multi-step sell ladder, different ladder steps may use different RPC endpoints, causing transaction confirmation to fail (confirming on endpoint A while the transaction was submitted to endpoint B).

**Why it happens:** `SellLadder` and `ExecutionEngine` receive `connections: Connection[]` at construction time (from `rpcManager.getAllConnections()`). The sell ladder uses `this.connections[0]` for balance checks (line 76) and passes the array to individual sellers for broadcast. If failover swaps the "active" connection mid-ladder, the balance check and transaction submission may target different endpoints with different slot views.

**Consequences:**
- Balance check shows tokens, but transaction submitted to a lagging endpoint sees stale state
- Transaction confirmation timeout because the confirming connection doesn't see the submitted transaction
- Sell ladder exhausts all 6 steps unnecessarily, ending in FAILED state despite the transaction having landed
- Worst case: double-sell if retry steps fire after the first transaction actually landed but wasn't confirmed

**Prevention:**
- Failover changes should NOT swap `Connection` objects mid-flight. Instead, implement failover as a routing layer that existing connections delegate to, so in-flight operations complete on the same endpoint they started on.
- The sell ladder already re-queries fresh balance at the start (`getParsedTokenAccountsByOwner` line 76). This is the right pattern -- ensure any failover enhancement preserves this.
- Consider making failover decision points explicit: only switch at the START of a new sell ladder attempt, never mid-ladder.
- The recovery polling in `RpcManager.startRecoveryPolling()` already swaps `this.state` atomically (line 108). Ensure any enhancement preserves this atomicity.

**Detection:** Monitor for "all ladder steps exhausted" events that coincide with RPC failover events (both already logged).

**Confidence:** MEDIUM -- based on architectural analysis; the current failover is simple enough that this hasn't manifested yet, but hardening creates the risk.

---

### Pitfall 5: Dashboard Enhancements Create Accidental Write Paths

**What goes wrong:** Adding analytics, operational controls, or live visibility features to the dashboard inadvertently creates write paths that conflict with the bot's state machine. The dashboard is designed as a read-only observer with one exception: the `/api/config` POST endpoint for runtime config. Adding "kill position" buttons, "pause detection" controls, or "force sell" actions creates race conditions with the autonomous pipeline.

**Why it happens:** The trades route already casts `(tradeStore as any).db` to access raw SQLite for read-only queries (trades.ts lines 41, 65). If new dashboard features write through this backdoor instead of going through TradeStore's state machine, the `activeMints` Set falls out of sync with the database, breaking the duplicate guard.

**Consequences:**
- activeMints Set and database disagree: duplicate buy attempts bypass the guard, or valid buys are incorrectly blocked
- State machine violation: dashboard transitions a trade from MONITORING to COMPLETED, but PositionManager still has it in `sellsInFlight` -- the `.finally()` cleanup runs on a stale state
- Emergency sell button fires while SellLadder is already running for the same mint -- double sell, double SOL loss

**Prevention:**
- All dashboard write operations MUST go through TradeStore methods, never raw SQL. The existing `(tradeStore as any).db` pattern for reads is acceptable but must NEVER be used for writes.
- New operational controls (pause, force-sell, kill position) must check `sellsInFlight` state. Expose a read-only method on PositionManager for this.
- Use the existing `botEventBus` for dashboard commands (emit an event, let the pipeline handle it) rather than direct state mutation.
- Any "force sell" feature must use `SellLadder.sell()` -- not a direct RPC transaction -- to get the full escalation ladder, balance verification, and state transitions.

**Detection:** Add an assertion in TradeStore that periodically validates `activeMints.size` matches `SELECT COUNT(DISTINCT mint) FROM trades WHERE state IN (non-terminal states)`.

**Confidence:** HIGH -- the `(tradeStore as any).db` backdoor already exists and is the obvious extension point for new dashboard queries.

---

## Moderate Pitfalls

Mistakes that cause bugs, degraded performance, or wasted effort.

---

### Pitfall 6: API Key Migration Breaks Error Masking Pattern

**What goes wrong:** Moving the Helius API key from URL query param to HTTP header is the right fix, but the current error logging already masks the key in URLs (tier3-creator.ts line 146: `url.replace(/api-key=[^&]*/gi, 'api-key=***')`). If the migration is incomplete (e.g., key still in URL for some code paths, now also in headers), the masking regex stops catching it while the key leaks through a different vector (e.g., raw `fetch` error that includes request headers).

**Prevention:**
- When moving to header-based auth, also update the error handler to strip `Authorization` or custom headers from logged errors.
- pino's serializers can be configured to redact specific header fields globally. Use `pino.redact` paths to strip `['req.headers.x-api-key', 'req.headers.authorization']`.
- Test the error path explicitly: trigger a network error and verify the API key doesn't appear in any log output.

**Confidence:** HIGH -- the masking code is directly visible in the source.

---

### Pitfall 7: New Rug Detection Check Has False Positive Bias Against Legitimate PumpPortal Tokens

**What goes wrong:** Adding new safety checks (e.g., liquidity lock detection, contract similarity scoring, social signal analysis) that are calibrated against Raydium-migrated tokens produces false positives when applied to bonding-curve-phase PumpPortal tokens. PumpPortal tokens have fundamentally different on-chain characteristics: no LP, no freeze/mint authority by default (Pump.fun handles this), concentrated holdings (bonding curve is the largest holder), and no transaction history.

**Why it happens:** The safety pipeline runs the same checks for all token sources. The existing checks handle this with source-aware logic (e.g., `checkSellRoute` skips Jupiter indexing check for pumpportal tokens, holder check accounts for bonding curve wallet). But new checks may not have this source-awareness built in.

**Prevention:**
- Every new safety check must be tested against BOTH pumpportal-source and raydium-source tokens.
- New checks should accept `event.source` and adjust behavior accordingly.
- The existing pattern is correct: `tier1-authority.ts` doesn't care about source (both programs have the same authority semantics), but `tier1-sell-route.ts` does care (pumpportal tokens aren't on Jupiter yet). Follow the same principle.
- Use dry-run mode with pumpportal-only detection to validate new checks don't systematically reject all pump.fun tokens.

**Confidence:** HIGH -- source-specific behavior is already a pattern in the codebase and must be maintained.

---

### Pitfall 8: Sell Timing Optimization Introduces Sandwich Attack Vulnerability

**What goes wrong:** Improving sell execution timing (faster triggers, tighter slippage) makes the bot more predictable to MEV bots. If the sell pattern becomes: "always sell at exactly 2x within 100ms of price crossing the threshold," sandwich bots can front-run the sell by detecting the price trigger and placing orders around it.

**Why it happens:** The position manager polls at `pollIntervalMs` intervals (default 5s). More frequent polling = more predictable sell timing. Tighter slippage on sells = narrower window for sandwich bots to extract value, but more frequent failures. The current 6-step escalation ladder already handles this well by varying slippage across steps.

**Prevention:**
- Do NOT reduce `pollIntervalMs` below 3s -- faster polling burns Jupiter rate budget and creates predictable timing.
- Add jitter to sell execution timing (random 0-2s delay before firing sell) to make behavior less predictable.
- Jito bundles (sell ladder step 3) already provide MEV protection. Consider making Jito the first step for large positions.
- Keep the escalation ladder as-is -- the increasing slippage/fee pattern is the right approach. Do not "optimize" it into a single high-slippage attempt.

**Confidence:** MEDIUM -- MEV dynamics are well-documented but the specific impact on this bot's patterns is theoretical.

---

### Pitfall 9: Monitoring/Alerting Adds Noise That Masks Real Failures

**What goes wrong:** Adding monitoring for "everything" produces alert fatigue. The bot already logs extensively with pino (structured logging at debug/info/warn/error levels). Adding a monitoring layer that surfaces every `warn` log as an alert means operators ignore the alerts, and real failures (RPC down, wallet drained, sell ladder stuck) get buried.

**Why it happens:** It's easier to add monitoring than to define what actually matters. Developers add alerts for: every safety rejection (normal behavior), every sell ladder step advancement (normal behavior), every WebSocket reconnect (normal behavior). These are all expected operational events, not failures.

**Prevention:**
- Define exactly 5-7 critical alerts, no more:
  1. Process crash / unhandled rejection
  2. RPC failover to backup (and failure to recover within 5 min)
  3. Sell ladder exhausting all 6 steps (SELL_FAILED)
  4. Wallet SOL balance below threshold
  5. WebSocket excessive reconnect threshold hit (already tracked by `ResilientWebSocket`)
  6. Zero trades detected in 30+ minutes during active market hours
  7. Position stuck in MONITORING for >2x maxHoldTimeMs
- Everything else is a metric/log, not an alert.
- Use the existing `botEventBus` events as the monitoring data source -- they already categorize events by type.

**Confidence:** HIGH -- the event taxonomy is well-defined in the codebase.

---

### Pitfall 10: Config Hot-Reload Validation Gap Allows Invalid State

**What goes wrong:** The dashboard's `/api/config` endpoint has Zod validation (ConfigPatchSchema), but `patchRuntimeConfig()` in trading.ts does a shallow/2-level merge without re-validating the merged result against the full TradingConfigSchema. A sequence of partial patches could produce a config state that passes individual patch validation but is collectively invalid (e.g., tieredTp percentages that sum to >100, or safety weights that don't sum to 100).

**Why it happens:** The ConfigPatchSchema validates individual fields but not cross-field constraints. `patchRuntimeConfig()` (trading.ts line 134) merges without full schema re-validation. The weights currently sum to 100 (40+30+30) by convention, not by constraint.

**Prevention:**
- After merging the patch, validate the full merged config against `TradingConfigSchema`.
- Add cross-field validations: `safety.weights.rugCheck + holder + creator` should sum to exactly 100, `tieredTp[].pct` values should sum to <=100.
- Add a `.refine()` on the Zod schema for cross-field constraints rather than runtime checks.
- Consider making the config PATCH endpoint accept the full config object (not partial) so the full schema validates naturally.

**Confidence:** HIGH -- directly visible in trading.ts merge logic.

---

### Pitfall 11: Execution Speed Optimization Breaks the Write-Ahead Pattern

**What goes wrong:** Optimizing buy execution speed (e.g., submitting the transaction before the safety pipeline completes, or parallelizing the write-ahead record with the RPC call) breaks the crash recovery guarantee. The write-ahead pattern (PER-02) ensures that if the process dies mid-buy, the BUYING record exists in SQLite and recovery can handle it. Removing or weakening this guarantee means a crash during buy leaves the bot in an inconsistent state.

**Why it happens:** The current flow in `index.ts` lines 186-188 is: `createBuyingRecord()` (synchronous, write-ahead) then `void executionEngine.buy(event)` (fire-and-forget async). This ordering is intentional and critical. Speed optimization might try to make `createBuyingRecord()` async or move it after the buy to reduce "overhead."

**Prevention:**
- **Never** move `createBuyingRecord()` after or parallel to `executionEngine.buy()`. The synchronous ordering is the duplicate guard AND the crash recovery guarantee.
- Speed optimizations should focus on the execution path AFTER the write-ahead record: faster transaction construction, parallel broadcast to multiple RPCs, optimized serialization. Not on the pipeline orchestration order.
- If adding new pre-buy steps (e.g., pre-fetching ATA or pre-building the transaction), they must complete BEFORE `createBuyingRecord()` or be fire-and-forget AFTER it. Never between the record write and the buy execution.

**Confidence:** HIGH -- the write-ahead pattern and its importance is documented in code comments and the architectural decision log.

---

## Minor Pitfalls

Mistakes that cause minor issues or wasted development time.

---

### Pitfall 12: Fixing the "SQL Injection" That Isn't One

**What goes wrong:** The `trade-store.ts` line 100 finding from the security audit is almost certainly a false positive. The code generates `?` placeholders from a static `NON_TERMINAL_STATES` array: `NON_TERMINAL_STATES.map(() => '?').join(',')`. This produces `?,?,?,?` which is then used as parameter placeholders -- the actual values are bound at runtime via `.all(...NON_TERMINAL_STATES)`. No user input ever touches the SQL string. Refactoring this "fix" is wasted effort.

**Prevention:**
- Read the code carefully before fixing audit findings. The `// ship-safe-ignore` comment exists for a reason.
- If you want to be extra cautious: verify that `NON_TERMINAL_STATES` is `const` and never modified. It is (line 33: `const NON_TERMINAL_STATES = [...]`). However, it's not `as const` or `readonly`, so a defensive refactor to `Object.freeze(NON_TERMINAL_STATES)` would be low-risk.
- Time spent "fixing" this is time not spent on actual improvements.

**Confidence:** HIGH -- verified by reading the exact code.

---

### Pitfall 13: Dashboard Analytics Queries Block the Event Loop

**What goes wrong:** The trades route already accesses raw SQLite via `(tradeStore as any).db` for analytics queries. Adding more complex analytics (e.g., P&L by time period, performance by source, win rate over time) with unindexed queries on a growing trades table blocks the event loop. better-sqlite3 is synchronous -- a slow query blocks ALL bot operations including buy execution.

**Why it happens:** better-sqlite3's synchronous API is an intentional design choice for the write-ahead pattern (no async gap = no race conditions). But it means any slow read query also blocks. The current queries are fast (indexed lookups, small result sets), but analytics queries on larger datasets (1000+ trades) without proper indexes will degrade.

**Prevention:**
- Add indexes for any new query patterns BEFORE adding the queries. Current indexes: `idx_trades_mint_state` only.
- Consider adding: `CREATE INDEX idx_trades_state_updated ON trades (state, updated_at)` for history/analytics queries.
- Keep analytics queries simple: pre-aggregate in the INSERT/UPDATE path if possible, rather than computing from raw data on every request.
- Set a hard query timeout or use a separate read-only SQLite connection for analytics (better-sqlite3 supports this with `readonly: true`).
- The `LIMIT 500` on the history query (trades.ts line 52) is good practice. Maintain limits on all analytics queries.

**Confidence:** HIGH -- better-sqlite3 synchronous behavior is well-documented.

---

### Pitfall 14: Over-Engineering Error Recovery Creates Infinite Retry Loops

**What goes wrong:** Adding "better error recovery" (retry logic, automatic reconnection, state repair) to fix silent failures introduces infinite retry loops that consume resources without making progress. For example: a sell that fails because the token has zero liquidity will never succeed no matter how many times it's retried.

**Prevention:**
- Every retry must have a maximum attempt count AND a backoff strategy. The existing WebSocket reconnection (ResilientWebSocket) gets this right with exponential backoff and excessive-reconnect alerting.
- The sell ladder already has the right approach: bounded escalation (6 steps, each with a timeout), then terminal FAILED state. Do not add "retry the entire ladder" on top of this.
- Distinguish between retryable errors (network timeout, RPC overloaded) and permanent errors (token not tradable, zero liquidity, wallet empty). Only retry the former.
- The current buy execution pattern (single attempt, no retry, FAILED terminal state) is intentional for speed. Do not add buy retries.

**Confidence:** HIGH -- recovery patterns are explicitly documented in code comments.

---

### Pitfall 15: Hardening Changes Break Dry-Run Mode Fidelity

**What goes wrong:** Security hardening or execution optimization changes the code path in a way that dry-run mode no longer exercises. Dry-run mode intercepts at specific gates (DRY-01 through DRY-08), and changes to the code around those gates can cause dry-run to silently skip the new logic, giving false confidence that changes work correctly.

**Prevention:**
- After any change to the pipeline, verify dry-run mode still works end-to-end: detection -> safety -> execution -> position monitoring -> exit trigger.
- The dry-run checks are scattered across multiple files (`execution-engine.ts`, `position-manager.ts`, `sell-ladder.ts`). Any refactoring of these files must preserve the `cfg.dryRun` / `trade.dryRun` checks.
- Add a "dry-run smoke test" to the test suite that verifies the complete pipeline path under dryRun=true.

**Confidence:** HIGH -- dry-run intercept points are visible throughout the codebase.

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| Security fixes (SQL, API key, validation) | Pitfall 1 (latency), Pitfall 12 (false positive) | Verify the SQL finding is actually exploitable before refactoring. Move Helius key to header. Config validation is already done. |
| Dependency updates | Pitfall 2 (breaking changes) | Update fastify to 5.8.3+ (easy). Accept bigint-buffer risk or try spl-token 0.5.x upgrade. picomatch is dev-only. Never use --force. |
| Safety scoring changes | Pitfall 3 (cascade), Pitfall 7 (source bias) | Dry-run first. One change at a time. Weight=0 for new checks initially. |
| Sell timing optimization | Pitfall 8 (sandwich), Pitfall 11 (write-ahead) | Add jitter. Don't restructure pipeline orchestration order. |
| Dashboard controls | Pitfall 5 (write paths), Pitfall 13 (query blocking) | All writes through TradeStore. Add indexes. Limit query complexity. |
| RPC failover hardening | Pitfall 4 (split-brain) | Don't swap connections mid-sell-ladder. Failover at operation boundaries. |
| Monitoring/alerting | Pitfall 9 (noise), Pitfall 14 (retry loops) | 5-7 critical alerts max. Bounded retries with backoff. |
| Execution speed | Pitfall 1 (latency regression), Pitfall 11 (write-ahead) | Profile before/after. Optimize AFTER write-ahead, not the orchestration. |

---

## Dependency Vulnerability Summary

Current `pnpm audit` results (2026-03-27):

| Package | Severity | Location | Fix Available | Risk Assessment |
|---------|----------|----------|---------------|-----------------|
| `bigint-buffer` | HIGH | @solana/spl-token (transitive) | NO (deprecated) | Low runtime risk: buffer overflow requires crafted input to toBigIntLE(). Not user-facing in this bot. Accept or upgrade spl-token to 0.5.x. |
| `picomatch` (2x) | HIGH | @preact/preset-vite (dev only) | YES (>=2.3.2, >=4.0.4) | **Zero runtime risk**: dev dependency, only used during Vite build. Update @preact/preset-vite when convenient. |
| `fastify` | MODERATE | Direct dependency | YES (>=5.8.3) | Low risk: X-Forwarded header spoofing, but dashboard listens on 127.0.0.1 only. Bump to 5.8.3 anyway. |
| `picomatch` (2x) | MODERATE | @preact/preset-vite (dev only) | YES | Same as above HIGH entries -- dev only. |
| `brace-expansion` | MODERATE | @fastify/static (transitive) | YES (>=5.0.5) | Low risk: memory exhaustion via crafted glob, but only triggered by file serving paths. Update @fastify/static. |

**Recommended fix order:** fastify bump (1 min) -> @fastify/static update (5 min) -> @preact/preset-vite update (5 min) -> spl-token 0.5.x investigation (30-60 min, may have API changes).

---

## Sources

- Direct codebase analysis: `trade-store.ts`, `tier3-creator.ts`, `config.ts`, `safety-pipeline.ts`, `execution-engine.ts`, `position-manager.ts`, `sell-ladder.ts`, `rpc-manager.ts`, `index.ts`, `trading.ts`, `env.ts`, `auth.ts`, `resilient-ws.ts`, `trades.ts`, `schema.ts`, `jupiter-client.ts` -- HIGH confidence
- `pnpm audit` output (2026-03-27) -- HIGH confidence
- [SolRugDetector: Investigating Rug Pulls on Solana](https://arxiv.org/html/2603.24625) -- MEDIUM confidence (academic, recent)
- [Tips to Improve Jupiter Swap Landing Rates](https://www.quicknode.com/docs/solana/jupiter-transactions) -- MEDIUM confidence
- [CVE-2025-32442: Fastify Content-Type Validation Bypass](https://github.com/fastify/fastify/security/advisories/GHSA-mg2h-6x62-wpwc) -- HIGH confidence (already patched in project's Fastify version)
- [Why npm audit fix --force is a Terrible Idea](https://medium.com/@instatunnel/why-npm-audit-fix-force-is-a-terrible-idea-052ac56a3ae2) -- MEDIUM confidence
- [Low-latency Solana playbook for HFT traders](https://rpcfast.com/blog/low-latency-solana-playbook-hft-traders) -- MEDIUM confidence
- [Building Production-Grade Solana Sniper Bots](https://dysnix.com/blog/complete-stack-competitive-solana-sniper-bots) -- MEDIUM confidence
- [Solana WebSocket: Real-Time Blockchain Data Streaming](https://www.helius.dev/docs/rpc/websocket) -- MEDIUM confidence
- [10 Common Mistakes with Solana Trading Bots](https://coincodecap.com/common-mistakes-to-avoid-with-solana-telegram-trading-bots) -- LOW confidence (general, not specific to self-hosted bots)
