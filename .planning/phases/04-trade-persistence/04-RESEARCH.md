# Phase 4: Trade Persistence - Research

**Researched:** 2026-02-26
**Domain:** SQLite persistence layer, write-ahead pattern, state machine design, duplicate-buy guard
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**State machine design**
- States: DETECTED → BUYING → MONITORING → SELLING → COMPLETED (terminal success)
- Additional terminal states: FAILED (any buy/sell error) and ABANDONED (token detected but buy never attempted — safety re-check failed, duplicate guard hit, position limits, etc.)
- DETECTED = token passed safety checks, buy not yet initiated
- ABANDONED = record created but execution decided not to buy (not an error — a deliberate non-action)
- FAILED = catch-all for execution errors; a single state with an `error_message` column captures specifics
- No split BUY_FAILED / SELL_FAILED states — keep the machine simple

**Schema**
- Core columns: `id`, `mint`, `state`, `created_at`, `updated_at`
- Execution columns: `buy_signature`, `sell_signature`, `amount_sol`, `amount_tokens`, `buy_price_sol`, `sell_price_sol`
- Error column: `error_message` (null unless FAILED)
- No separate `trade_events` table — current state only, with `updated_at` tracking last transition
- Database file: `data/trades.db`

**Indexing**
- Primary lookup patterns: "active trade for this mint?" and "all non-terminal trades for crash recovery"
- Index on `(mint, state)` covers both use cases

**Write-ahead commit point**
- Write state = BUYING to SQLite **before** sending any buy transaction
- If SQLite write fails, abort the buy — no write = no buy (hard guarantee, no untracked trades)
- On successful buy confirmation: transition to MONITORING and write `buy_signature` in the same update
- Phase 6 crash recovery reads BUYING rows with null `buy_signature` as "crashed between write and send"
- Enable SQLite WAL journal mode (`PRAGMA journal_mode=WAL`) for crash safety and concurrent reads

**Duplicate prevention scope**
- In-memory Set contains mint addresses for all active (non-terminal) trades: DETECTED, BUYING, MONITORING, SELLING
- Mint is added to Set when record is created (DETECTED or BUYING), removed only when trade reaches COMPLETED, FAILED, or ABANDONED
- Re-buying is allowed after a terminal state — the mint is removed from the Set and a fresh trade lifecycle can start
- On startup: rebuild Set from SQLite by querying all non-terminal trades (ensures duplicate guard survives restarts)

### Claude's Discretion
- Exact SQL migrations approach (single schema file vs migration runner)
- TypeScript ORM vs raw better-sqlite3 calls
- Exact column types and constraints
- Whether to use a connection pool or single connection instance

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| PER-01 | All trades persist to SQLite with full state machine (DETECTED → BUYING → MONITORING → SELLING → COMPLETED) | Schema design, better-sqlite3 API, state transition patterns |
| PER-02 | Bot writes PENDING entry to SQLite before sending any buy transaction (write-ahead) | WAL journal mode, synchronous better-sqlite3 API, transaction atomicity |
| PER-04 | Bot maintains in-memory Set of active buy intents to prevent duplicate concurrent buys | Set<string> pattern, startup rebuild from SQLite, terminal state removal |
</phase_requirements>

---

## Summary

Phase 4 builds the persistence layer using better-sqlite3, the established Node.js standard for synchronous SQLite access. The project already uses ESM (`"type": "module"` in package.json, Node16 module resolution in tsconfig.json), so the import must use `import Database from 'better-sqlite3'` with `esModuleInterop: true` (already set in tsconfig.json). No ORM is needed — the schema is five columns wide with a handful of prepared statements; raw better-sqlite3 calls are simpler, faster, and eliminate the ORM abstraction layer.

The write-ahead pattern is the critical invariant: the bot writes `state = BUYING` to SQLite synchronously before any async on-chain call. Since better-sqlite3 is synchronous by design, this is straightforward — a prepared `INSERT` runs and either succeeds (proceed to send) or throws (abort, no buy). WAL journal mode (`PRAGMA journal_mode = WAL`) is set once on startup and persists; it allows concurrent readers (future dashboard) while the single writer bot runs. The `data/trades.db` directory must be created before first use.

The in-memory duplicate guard is a `Set<string>` passed into (or held by) a `TradeStore` class. On startup it rebuilds from SQLite by querying all non-terminal trades. The Set and the SQLite write happen atomically in the same synchronous code path — there is no async gap between "check Set" and "write to SQLite" because better-sqlite3 is synchronous. This eliminates the TOCTOU race that would exist with an async driver.

**Primary recommendation:** Use raw better-sqlite3 (v12.x) with a single `TradeStore` class, WAL mode, and a handful of prepared statements. No ORM. Single connection instance (SQLite has no connection pool concept for a single writer).

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| better-sqlite3 | ^12.6.2 | Synchronous SQLite driver | Fastest Node.js SQLite library; synchronous API prevents async gaps in write-ahead pattern; proven in production |
| @types/better-sqlite3 | ^7.6.13 | TypeScript type definitions | DefinitelyTyped package for full type safety |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| node:fs (built-in) | - | Create `data/` directory if absent | `fs.mkdirSync('data', { recursive: true })` before opening DB |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| better-sqlite3 | drizzle-orm + better-sqlite3 | ORM adds type-safe schema definition and migration tooling; justified only when schema is complex or evolves frequently. For 1 table with a fixed schema, the migration overhead (drizzle-kit, drizzle-orm extra dep) is unnecessary |
| better-sqlite3 | Node.js built-in `node:sqlite` | Built-in is still experimental in Node 22 (requires `--experimental-sqlite` flag); not production-ready |
| better-sqlite3 | sqlite3 (async) | Async driver would break the synchronous write-ahead invariant — async gap between "write intent" and "execute buy" creates a race window |
| Single SQL init file | Migration runner | A single `CREATE TABLE IF NOT EXISTS` script is sufficient for Phase 4. Migration runner adds complexity justified only for multi-version schema evolution |

**Installation:**
```bash
pnpm add better-sqlite3
pnpm add -D @types/better-sqlite3
```

---

## Architecture Patterns

### Recommended Project Structure
```
src/
├── persistence/
│   ├── trade-store.ts       # TradeStore class — DB init, prepared stmts, Set management
│   ├── trade-store.test.ts  # Vitest tests (in-memory :memory: DB)
│   └── schema.ts            # SQL DDL string (CREATE TABLE + CREATE INDEX)
├── types/
│   └── index.ts             # Add TradeState enum, Trade interface (extends existing)
data/
└── trades.db                # Runtime SQLite file (gitignored)
```

### Pattern 1: Single Exported TradeStore Class

**What:** One class owns the Database connection, all prepared statements, and the active-mints Set. Constructed once in `main()` and passed to components that need it (index.ts already follows this constructor-injection pattern for SafetyPipeline, RpcManager, etc.).

**When to use:** Always — SQLite is a single-writer database; one connection is correct and sufficient.

**Example:**
```typescript
// Source: better-sqlite3 official docs (https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md)
import Database from 'better-sqlite3';
import fs from 'node:fs';
import { createModuleLogger } from '../core/logger.js';
import type { Trade, TradeState } from '../types/index.js';

const log = createModuleLogger('trade-store');

export class TradeStore {
  private readonly db: Database.Database;
  private readonly activeMints = new Set<string>();

  // Prepared statements (compiled once, reused per execution)
  private readonly stmtInsert: Database.Statement;
  private readonly stmtUpdateState: Database.Statement;
  private readonly stmtGetByMint: Database.Statement;
  private readonly stmtGetNonTerminal: Database.Statement;

  constructor(dbPath: string) {
    // Ensure data/ directory exists
    fs.mkdirSync(dbPath.replace(/\/[^/]+$/, ''), { recursive: true });

    this.db = new Database(dbPath);

    // WAL mode: set once, persists across connections (stored in DB header)
    this.db.pragma('journal_mode = WAL');

    // Create table + index if not exists
    this.db.exec(SCHEMA_SQL);

    // Compile prepared statements
    this.stmtInsert = this.db.prepare(`
      INSERT INTO trades (mint, state, created_at, updated_at)
      VALUES (@mint, @state, @now, @now)
    `);

    this.stmtUpdateState = this.db.prepare(`
      UPDATE trades SET state = @state, updated_at = @now,
        buy_signature = COALESCE(@buy_signature, buy_signature),
        sell_signature = COALESCE(@sell_signature, sell_signature),
        error_message = COALESCE(@error_message, error_message),
        amount_sol = COALESCE(@amount_sol, amount_sol),
        amount_tokens = COALESCE(@amount_tokens, amount_tokens),
        buy_price_sol = COALESCE(@buy_price_sol, buy_price_sol),
        sell_price_sol = COALESCE(@sell_price_sol, sell_price_sol)
      WHERE mint = @mint AND state = @expectedState
    `);

    this.stmtGetByMint = this.db.prepare(
      'SELECT * FROM trades WHERE mint = ? ORDER BY created_at DESC LIMIT 1'
    );

    this.stmtGetNonTerminal = this.db.prepare(
      `SELECT mint FROM trades WHERE state NOT IN ('COMPLETED', 'FAILED', 'ABANDONED')`
    );

    // Rebuild active-mints Set from non-terminal trades
    this._rebuildActiveMintsSet();

    log.info({ dbPath, activeMints: this.activeMints.size }, 'TradeStore initialized');
  }

  private _rebuildActiveMintsSet(): void {
    const rows = this.stmtGetNonTerminal.all() as Array<{ mint: string }>;
    for (const row of rows) {
      this.activeMints.add(row.mint);
    }
  }

  /** Returns true if this mint has an active (non-terminal) trade. */
  isActive(mint: string): boolean {
    return this.activeMints.has(mint);
  }

  /** Write-ahead: insert BUYING record before sending buy tx. Throws if mint already active. */
  createBuyingRecord(mint: string): void {
    if (this.activeMints.has(mint)) {
      throw new Error(`Duplicate buy attempt blocked: mint=${mint} already active`);
    }
    const now = Date.now();
    this.stmtInsert.run({ mint, state: 'BUYING', now });
    this.activeMints.add(mint);
    log.info({ mint }, 'Trade record created: BUYING');
  }

  /** Transition state. Returns number of rows changed (0 = unexpected state, treat as error). */
  transition(mint: string, from: TradeState, to: TradeState, extra?: Partial<Trade>): number {
    const now = Date.now();
    const result = this.stmtUpdateState.run({
      mint,
      state: to,
      expectedState: from,
      now,
      buy_signature: extra?.buySignature ?? null,
      sell_signature: extra?.sellSignature ?? null,
      error_message: extra?.errorMessage ?? null,
      amount_sol: extra?.amountSol ?? null,
      amount_tokens: extra?.amountTokens ?? null,
      buy_price_sol: extra?.buyPriceSol ?? null,
      sell_price_sol: extra?.sellPriceSol ?? null,
    });

    // Remove from active Set when reaching terminal state
    if (to === 'COMPLETED' || to === 'FAILED' || to === 'ABANDONED') {
      this.activeMints.delete(mint);
    }

    return result.changes;
  }

  /** Close DB on graceful shutdown */
  close(): void {
    this.db.close();
    log.info('TradeStore closed');
  }
}
```

### Pattern 2: Schema as Constant String

**What:** DDL defined as a string constant in `schema.ts` — executed once via `db.exec()` at startup with `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS`. No migration runner needed for Phase 4.

**When to use:** When the schema is fixed and unlikely to change across deployments. If schema evolution is needed later, a versioned migration approach can be added incrementally.

**Example:**
```typescript
// Source: better-sqlite3 official docs
export const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS trades (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    mint            TEXT    NOT NULL,
    state           TEXT    NOT NULL,
    created_at      INTEGER NOT NULL,  -- Unix ms
    updated_at      INTEGER NOT NULL,  -- Unix ms
    buy_signature   TEXT,
    sell_signature  TEXT,
    amount_sol      REAL,
    amount_tokens   REAL,
    buy_price_sol   REAL,
    sell_price_sol  REAL,
    error_message   TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_trades_mint_state ON trades (mint, state);
`;
```

### Pattern 3: In-Memory Set with Synchronous Integrity

**What:** The `activeMints` Set and the SQLite write happen in the same synchronous call stack. Because better-sqlite3 is synchronous, there is no async gap where a second concurrent token event could slip between "check Set" and "write DB". This is the key reason to choose better-sqlite3 over an async driver.

**When to use:** Always — this is the correct pattern for write-ahead + duplicate guard in a single-process Node.js bot.

**Example:**
```typescript
// Anti-pattern (async driver): gap between check and write
if (!activeMints.has(mint)) {
  // <<< another token event COULD arrive here before the await resolves >>>
  await asyncDb.run('INSERT INTO trades ...');
  activeMints.add(mint);  // too late
}

// Correct (better-sqlite3 sync): no gap
if (!activeMints.has(mint)) {
  syncDb.prepare('INSERT INTO trades ...').run(...);  // synchronous, no event loop gap
  activeMints.add(mint);  // immediate
}
```

### Pattern 4: ESM Import with esModuleInterop

**What:** The project uses `"type": "module"` and `module: "Node16"` with `esModuleInterop: true`. better-sqlite3 is a CJS module but TypeScript's `esModuleInterop` handles the interop automatically, allowing a clean default import.

**When to use:** This is the correct import form for this project.

**Example:**
```typescript
// Source: TypeScript ESM/CJS interop docs + better-sqlite3 @types package
import Database from 'better-sqlite3';  // Works with esModuleInterop: true

const db = new Database('data/trades.db');
db.pragma('journal_mode = WAL');
```

**Note:** If TypeScript complains about the default import despite `esModuleInterop: true`, the fallback is:
```typescript
import BetterSqlite3 from 'better-sqlite3';
// or as a last resort:
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Database = require('better-sqlite3') as typeof import('better-sqlite3');
```

### Pattern 5: Integration into index.ts

**What:** `TradeStore` is constructed in `main()`, passed to the token event handler, and closed in `shutdown()`. The existing `// Phase 4+: flush SQLite writes` comment in `shutdown()` is the exact integration point.

**Example:**
```typescript
// In main():
const tradeStore = new TradeStore('data/trades.db');

// In token event handler (after safety pipeline passes):
detectionManager.on('token', async (event) => {
  const result = await safetyPipeline.evaluate(event);
  if (result.pass) {
    if (tradeStore.isActive(event.mint)) {
      log.debug({ mint: event.mint }, 'Duplicate buy blocked by active-mints guard');
      return;
    }
    tradeStore.createBuyingRecord(event.mint);
    // Phase 5+: pass to execution engine
  }
});

// In shutdown():
tradeStore.close();
```

### Anti-Patterns to Avoid

- **Opening DB connection per request:** SQLite connections are stateful (WAL mode, prepared statements). Open once at startup, reuse throughout lifetime.
- **Mixing async and sync SQLite calls:** better-sqlite3 is synchronous; wrapping its calls in `await` or `Promise` creates unnecessary overhead and risks execution order confusion.
- **Updating state without verifying the `from` state:** The `transition()` method uses `WHERE state = @expectedState` — checking `result.changes === 0` catches unexpected state transitions.
- **Not creating `data/` directory:** `new Database('data/trades.db')` fails if `data/` does not exist. Use `fs.mkdirSync` with `{ recursive: true }` before construction.
- **Setting WAL mode inside a transaction:** `PRAGMA journal_mode = WAL` must be called outside of any transaction. Call it immediately after opening the DB.
- **Storing timestamps as ISO strings:** Use Unix milliseconds (INTEGER column) for simpler range queries and consistent comparison with `Date.now()`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SQLite crash safety | Custom file locking, write buffers | `PRAGMA journal_mode = WAL` | WAL is battle-tested across millions of SQLite deployments; custom file safety has dozens of edge cases |
| SQL injection prevention | Manual string sanitization | better-sqlite3 prepared statements with `@named` or `?` params | Parameterized queries are the only correct solution; string concatenation always has bypass vectors |
| Migration versioning (Phase 4 scope) | Custom migration runner | Single `CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS` | Idempotent DDL is sufficient when schema doesn't change; add migration runner in a future phase if needed |
| Connection pool | Multiple Database instances | Single Database instance | SQLite is not a client-server database; multiple writers cause lock contention, not parallelism |

**Key insight:** better-sqlite3's synchronous API is an intentional design choice — it maps directly to SQLite's single-writer, in-process architecture. Fighting this with async wrappers creates complexity without benefit.

---

## Common Pitfalls

### Pitfall 1: ESM Import Failure for better-sqlite3

**What goes wrong:** TypeScript throws "cannot use import statement" or "does not provide an export named 'default'" when importing better-sqlite3 in an ESM (`"type": "module"`) project.

**Why it happens:** better-sqlite3 is a CommonJS native module. The `esModuleInterop` flag in tsconfig.json is required for clean default imports.

**How to avoid:** Confirm `esModuleInterop: true` in tsconfig.json (already set in this project). Use `import Database from 'better-sqlite3'`. If tsx (the dev runtime) has issues, verify tsx version is 4.x+ which handles ESM/CJS interop.

**Warning signs:** TypeScript error TS1259 "can only be default-imported using the 'esModuleInterop' flag".

### Pitfall 2: Native Module Recompile Required After Node.js Version Change

**What goes wrong:** better-sqlite3 is a native addon (`.node` binary). If Node.js version changes, you get `Error: The module was compiled against a different Node.js version`.

**Why it happens:** Native addons are compiled against a specific Node ABI version.

**How to avoid:** Run `pnpm rebuild better-sqlite3` after any Node.js version upgrade. Document the Node.js version in `.nvmrc` or `engines` field of package.json.

**Warning signs:** `NODE_MODULE_VERSION mismatch` error on startup.

### Pitfall 3: WAL Mode Not Persisting

**What goes wrong:** WAL mode appears to reset between runs.

**Why it happens:** WAL mode IS persisted in the database header — this is a non-issue for file databases. However, if tests use `:memory:` databases, WAL mode may behave slightly differently (WAL isn't available for in-memory DBs; SQLite silently falls back to journal mode).

**How to avoid:** In tests, use `:memory:` and skip the WAL pragma (or check if it's needed for tests). In production, WAL is set once and persists.

**Warning signs:** Tests that set WAL mode on `:memory:` DB and then assert on journal_mode result.

### Pitfall 4: State Transition Race with Async Token Events

**What goes wrong:** Two token events for the same mint arrive nearly simultaneously. Both pass the `isActive()` check before either writes to SQLite.

**Why it happens:** With an async SQLite driver, there's an event loop gap between the Set check and the DB write. With better-sqlite3's synchronous API, this cannot happen — the check-and-write is atomic within the synchronous call stack. However, the `on('token')` handler in `index.ts` is async (because `safetyPipeline.evaluate()` is async). This means two concurrent events COULD both be in-flight through `evaluate()` simultaneously.

**How to avoid:** The `isActive()` check must happen AFTER safety evaluation, immediately before the synchronous `createBuyingRecord()` call. Since `createBuyingRecord()` is synchronous and checks-then-writes atomically, the only window is between two concurrent `evaluate()` calls completing. The synchronous Set+write in `createBuyingRecord` handles this correctly: whichever event completes `evaluate()` first will win the Set+write; the second will see the Set has the mint and return early.

**Warning signs:** Duplicate `buy_signature` entries in the DB (Phase 5 concern, but the guard prevents this in Phase 4).

### Pitfall 5: `data/` Directory Not Created

**What goes wrong:** `new Database('data/trades.db')` throws `SQLITE_CANTOPEN: unable to open database file` when `data/` doesn't exist.

**Why it happens:** better-sqlite3 does not create intermediate directories.

**How to avoid:** Call `fs.mkdirSync(path.dirname(dbPath), { recursive: true })` before `new Database(dbPath)` in `TradeStore` constructor.

**Warning signs:** Crash on first startup with a fresh clone or after deleting `data/`.

### Pitfall 6: `COALESCE` in UPDATE Leaves Nulls Incorrectly

**What goes wrong:** Using `COALESCE(@param, column)` in UPDATE preserves existing values when param is null, but if you genuinely want to set a column to null, this pattern prevents it.

**Why it happens:** The pattern is designed to allow partial updates (only pass columns you want to change). But it conflates "not updating this column" with "setting this column to null."

**How to avoid:** For Phase 4, no column ever needs to be explicitly set to null after being set to non-null. The `error_message` column is set once when transitioning to FAILED and never cleared. This pattern is safe for this schema.

**Warning signs:** Unexpected null values retained after an update that intended to clear a column.

---

## Code Examples

Verified patterns from official sources:

### WAL Mode Setup (required, set once at startup)
```typescript
// Source: https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md
const db = new Database('data/trades.db');
db.pragma('journal_mode = WAL');
// WAL mode is now stored in DB header — survives restarts
```

### Prepared Statement with Named Parameters
```typescript
// Source: https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md
const stmt = db.prepare(`
  INSERT INTO trades (mint, state, created_at, updated_at)
  VALUES (@mint, @state, @createdAt, @updatedAt)
`);
stmt.run({ mint: 'So11111...', state: 'BUYING', createdAt: Date.now(), updatedAt: Date.now() });
// Returns: { changes: 1, lastInsertRowid: 1n }
```

### Query Single Row
```typescript
// Source: https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md
const row = db.prepare('SELECT * FROM trades WHERE mint = ? ORDER BY created_at DESC LIMIT 1').get(mint);
// Returns: row object or undefined (never throws on no result)
```

### Query Multiple Rows (startup rebuild)
```typescript
// Source: https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md
const rows = db.prepare(
  `SELECT mint FROM trades WHERE state NOT IN ('COMPLETED','FAILED','ABANDONED')`
).all() as Array<{ mint: string }>;
const activeMints = new Set(rows.map(r => r.mint));
```

### State Transition with Optimistic Locking
```typescript
// Check result.changes to verify the update happened
const result = db.prepare(`
  UPDATE trades SET state = @to, updated_at = @now
  WHERE mint = @mint AND state = @from
`).run({ to: 'MONITORING', from: 'BUYING', mint, now: Date.now() });

if (result.changes === 0) {
  throw new Error(`State transition failed: expected BUYING, mint=${mint}`);
}
```

### Graceful Close in Shutdown
```typescript
// Source: https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md
db.close();
// All pending writes are flushed synchronously before close returns
```

### TypeScript Type for Trade Row
```typescript
// To add to src/types/index.ts
export type TradeState =
  | 'DETECTED'
  | 'BUYING'
  | 'MONITORING'
  | 'SELLING'
  | 'COMPLETED'
  | 'FAILED'
  | 'ABANDONED';

export interface Trade {
  id: number;
  mint: string;
  state: TradeState;
  createdAt: number;      // Unix ms
  updatedAt: number;      // Unix ms
  buySignature?: string;
  sellSignature?: string;
  amountSol?: number;
  amountTokens?: number;
  buyPriceSol?: number;
  sellPriceSol?: number;
  errorMessage?: string;
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| sqlite3 (async) | better-sqlite3 (sync) | 2016+ | Sync API eliminates async gaps critical for write-ahead invariant |
| node:sqlite (experimental) | better-sqlite3 (production-stable) | Node 22.5, 2024 | built-in still requires `--experimental-sqlite` flag; not yet for production |
| Drizzle/Prisma ORM | Raw better-sqlite3 for simple schemas | N/A | ORM justified only for complex evolving schemas; 1 table = overhead |

**Deprecated/outdated:**
- `sqlite3` npm package: Async callback/promise API; slower, more complex, wrong tool for this use case.
- node:sqlite: Still experimental (Node 22); requires `--experimental-sqlite` CLI flag for production.

---

## Open Questions

1. **tsx and native modules**
   - What we know: tsx (the dev runtime, v4.x) generally handles native CJS modules in ESM projects. better-sqlite3 is a native addon.
   - What's unclear: Whether `tsx watch src/index.ts` will load better-sqlite3's native `.node` binary without additional configuration on this Windows dev machine.
   - Recommendation: Test `pnpm add better-sqlite3` and `pnpm dev` immediately in Wave 0 of the plan. If tsx fails with a native module error, the fallback is to add `--experimental-require-module` to the tsx call or use a stub during dev.

2. **Column types: REAL vs INTEGER for SOL amounts**
   - What we know: SOL amounts are floating-point (e.g., 0.01 SOL = 10000000 lamports). Storing as REAL (IEEE 754 double) introduces floating-point imprecision. Storing as INTEGER lamports is exact.
   - What's unclear: Phase 5 will write these values — the decision can be made in Phase 4 schema definition.
   - Recommendation: Store as REAL for human readability (values are small enough that precision loss is immaterial for logging/recovery; exact lamport arithmetic stays on-chain). If Phase 5 disagrees, altering a SQLite column type is trivial.

3. **`data/trades.db` gitignore**
   - What we know: The DB file must not be committed to git.
   - What's unclear: Whether `.gitignore` already covers `data/`.
   - Recommendation: Add `data/` to `.gitignore` in Phase 4 setup task.

---

## Sources

### Primary (HIGH confidence)
- `https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md` — Database constructor, pragma, prepare, run, get, all, transaction, close
- `https://github.com/WiseLibs/better-sqlite3/discussions/1245` — Production-readiness comparison vs node:sqlite (2025)
- Project codebase — existing patterns (ESM, tsconfig, vitest, module logger, constructor injection)

### Secondary (MEDIUM confidence)
- WebSearch: better-sqlite3 v12.6.2 current version (npm, January 2026)
- WebSearch: `@types/better-sqlite3` v7.6.13 TypeScript definitions (npm, April 2025)
- WebSearch: ESM + `esModuleInterop` default import pattern for CJS modules (TypeScript docs, multiple sources)
- WebSearch: Node.js built-in `node:sqlite` still experimental (Node 25 docs, 2025)

### Tertiary (LOW confidence)
- WebSearch: tsx + native Node.js addon compatibility — not directly verified; check during implementation

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — better-sqlite3 v12.6.2 confirmed current, @types confirmed, ESM interop verified
- Architecture: HIGH — patterns derived directly from official API docs and existing project code conventions
- Pitfalls: HIGH (Pitfalls 1-5) / MEDIUM (Pitfall 6) — derived from official docs and known SQLite/Node.js gotchas

**Research date:** 2026-02-26
**Valid until:** 2026-05-26 (stable library; 90-day window)
