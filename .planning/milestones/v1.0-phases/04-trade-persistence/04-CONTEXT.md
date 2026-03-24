# Phase 4: Trade Persistence - Context

**Gathered:** 2026-02-26
**Status:** Ready for planning

<domain>
## Phase Boundary

Every trade intent and state transition is durably recorded in SQLite before any on-chain action occurs, preventing duplicate buys and enabling crash recovery. Phase 4 delivers the persistence layer only — execution happens in Phase 5, crash recovery in Phase 6.

</domain>

<decisions>
## Implementation Decisions

### State machine design
- States: DETECTED → BUYING → MONITORING → SELLING → COMPLETED (terminal success)
- Additional terminal states: FAILED (any buy/sell error) and ABANDONED (token detected but buy never attempted — safety re-check failed, duplicate guard hit, position limits, etc.)
- DETECTED = token passed safety checks, buy not yet initiated
- ABANDONED = record created but execution decided not to buy (not an error — a deliberate non-action)
- FAILED = catch-all for execution errors; a single state with an `error_message` column captures specifics
- No split BUY_FAILED / SELL_FAILED states — keep the machine simple

### Schema
- Core columns: `id`, `mint`, `state`, `created_at`, `updated_at`
- Execution columns: `buy_signature`, `sell_signature`, `amount_sol`, `amount_tokens`, `buy_price_sol`, `sell_price_sol`
- Error column: `error_message` (null unless FAILED)
- No separate `trade_events` table — current state only, with `updated_at` tracking last transition
- Database file: `data/trades.db`

### Indexing
- Primary lookup patterns: "active trade for this mint?" and "all non-terminal trades for crash recovery"
- Index on `(mint, state)` covers both use cases

### Write-ahead commit point
- Write state = BUYING to SQLite **before** sending any buy transaction
- If SQLite write fails, abort the buy — no write = no buy (hard guarantee, no untracked trades)
- On successful buy confirmation: transition to MONITORING and write `buy_signature` in the same update
- Phase 6 crash recovery reads BUYING rows with null `buy_signature` as "crashed between write and send"
- Enable SQLite WAL journal mode (`PRAGMA journal_mode=WAL`) for crash safety and concurrent reads

### Duplicate prevention scope
- In-memory Set contains mint addresses for all active (non-terminal) trades: DETECTED, BUYING, MONITORING, SELLING
- Mint is added to Set when record is created (DETECTED or BUYING), removed only when trade reaches COMPLETED, FAILED, or ABANDONED
- Re-buying is allowed after a terminal state — the mint is removed from the Set and a fresh trade lifecycle can start
- On startup: rebuild Set from SQLite by querying all non-terminal trades (ensures duplicate guard survives restarts)

### Claude's Discretion
- Exact SQL migrations approach (single schema file vs migration runner)
- TypeScript ORM vs raw better-sqlite3 calls
- Exact column types and constraints
- Whether to use a connection pool or single connection instance

</decisions>

<specifics>
## Specific Ideas

- The write-ahead guarantee is a hard invariant: if we can't write to SQLite, we cannot buy. This is a safety property, not a best-effort.
- Phase 6 crash recovery will rely on the BUYING + null buy_signature pattern to identify unresolved trades — keep this contract clean.
- The Set rebuild on startup bridges Phase 4 and Phase 6: Phase 4 builds the mechanism, Phase 6 uses it.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 04-trade-persistence*
*Context gathered: 2026-02-26*
