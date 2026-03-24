# Phase 6: Crash Recovery - Context

**Gathered:** 2026-02-27
**Status:** Ready for planning

<domain>
## Phase Boundary

On restart, the bot loads all non-terminal trades from SQLite and reconciles BUYING trades against on-chain wallet state to determine whether buys landed. After recovery, the bot resumes monitoring/selling open positions and starts accepting new detections. This phase covers the startup recovery sequence only — ongoing position management (stop-loss, take-profit) is Phase 7.

</domain>

<decisions>
## Implementation Decisions

### PENDING reconciliation
- Use wallet token account balance (on-chain) to determine if a BUYING trade landed — not stored transaction signatures
- Query actual current on-chain balance, not SQLite-recorded quantity (handles partial fills and fee deductions)
- If balance > 0: transition trade to MONITORING state
- If RPC unavailable or times out during reconciliation: fail-safe closed — mark trade FAILED and continue

### Failed buy handling
- Balance = 0 after reconciliation: mark FAILED, log a structured WARN with mint + trade ID, move on (no retry)
- SELLING trades at crash time: re-check wallet balance; if tokens still held resume sell ladder, if wallet empty mark COMPLETED (sell may have landed)
- MONITORING trades at crash time: load into memory as-is, no wallet re-check — Phase 7 will handle exits
- Logging: individual WARN per unrecovered BUYING trade + aggregate summary count at end of recovery

### Startup sequencing
- Block new token detections until recovery is fully complete — no async recovery racing with live detection
- Per-trade timeout on RPC calls (not a total recovery timeout); if a single call times out, mark that trade FAILED and continue
- Recovery runs before WebSocket listener connections are established
- After recovery: emit a structured startup summary log line (e.g., "Recovery complete: 3 MONITORING, 1 SELLING resumed, 2 BUYING unrecovered")

### Non-terminal state scope
- Recover: BUYING, MONITORING, SELLING only
- DETECTED trades (mid-safety-check, no capital at risk): discard/mark FAILED — bot will rediscover naturally
- In-memory duplicate guard (Set of active mints) populated after recovery, from recovered MONITORING + SELLING trades only
- Edge case — multiple SELLING records for same mint: log ERROR, keep most recent, mark others FAILED

### Code organization
- Standalone RecoveryManager class, not a method on TradeStore
- Dependencies injected: TradeStore + RPC client
- Called from index.ts during startup sequence, before listener connections

### Claude's Discretion
- Exact per-trade RPC timeout value
- Internal RecoveryManager method structure
- How COMPLETED determination is logged for SELLING trades that had empty wallet

</decisions>

<specifics>
## Specific Ideas

- No specific references — standard recovery patterns apply
- The operator should be able to read the startup logs and clearly see what was recovered and what wasn't

</specifics>

<deferred>
## Deferred Ideas

- None — discussion stayed within phase scope

</deferred>

---

*Phase: 06-crash-recovery*
*Context gathered: 2026-02-27*
