/**
 * TradeStore — SQLite-backed trade persistence with state machine and duplicate guard.
 *
 * Architectural guarantee: createBuyingRecord() is fully synchronous.
 * The Set check and DB write are a single synchronous operation with no async
 * gap, preventing duplicate buy orders even under concurrent event emissions.
 *
 * ESM interop note: better-sqlite3 is a CommonJS native module.
 * We use createRequire() because Node16 module resolution does not allow
 * default CJS imports in ESM without esModuleInterop — and even with it,
 * the @types/better-sqlite3 types need a manual cast here to satisfy tsc.
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { createModuleLogger } from '../core/logger.js';
import { SCHEMA_SQL } from './schema.js';
import type { Trade, TradeState } from '../types/index.js';
import type BetterSqlite3 from 'better-sqlite3';

// ESM interop fallback for better-sqlite3 (TS1259 guard)
const require = createRequire(import.meta.url);
const Database = require('better-sqlite3') as typeof BetterSqlite3;

const log = createModuleLogger('trade-store');

const TERMINAL_STATES: ReadonlySet<TradeState> = new Set([
  'COMPLETED',
  'FAILED',
  'ABANDONED',
]);

const NON_TERMINAL_STATES = ['DETECTED', 'BUYING', 'MONITORING', 'SELLING'];

export class TradeStore {
  private readonly db: BetterSqlite3.Database;
  private readonly activeMints = new Set<string>();

  private readonly stmtInsert: BetterSqlite3.Statement;
  private readonly stmtUpdateState: BetterSqlite3.Statement;
  private readonly stmtGetNonTerminal: BetterSqlite3.Statement;

  constructor(dbPath: string) {
    if (dbPath !== ':memory:') {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    }

    this.db = new Database(dbPath);

    if (dbPath !== ':memory:') {
      // WAL mode gives better write concurrency for file-backed DBs.
      // Skip for :memory: — SQLite silently reverts WAL on in-memory DBs.
      this.db.pragma('journal_mode = WAL');
    }

    this.db.exec(SCHEMA_SQL);

    // Compile prepared statements once at construction time for efficiency.
    this.stmtInsert = this.db.prepare(
      `INSERT INTO trades (mint, state, created_at, updated_at)
       VALUES (@mint, @state, @now, @now)`
    );

    // COALESCE pattern: only overwrite a column if the caller supplies a non-null value.
    this.stmtUpdateState = this.db.prepare(
      `UPDATE trades SET
         state          = @state,
         updated_at     = @now,
         buy_signature  = COALESCE(@buy_signature,  buy_signature),
         sell_signature = COALESCE(@sell_signature, sell_signature),
         error_message  = COALESCE(@error_message,  error_message),
         amount_sol     = COALESCE(@amount_sol,     amount_sol),
         amount_tokens  = COALESCE(@amount_tokens,  amount_tokens),
         buy_price_sol  = COALESCE(@buy_price_sol,  buy_price_sol),
         sell_price_sol = COALESCE(@sell_price_sol, sell_price_sol)
       WHERE mint = @mint AND state = @expectedState`
    );

    this.stmtGetNonTerminal = this.db.prepare(
      `SELECT mint FROM trades WHERE state IN (${NON_TERMINAL_STATES.map(() => '?').join(',')})`
    );

    // Rebuild the active Set from any non-terminal rows left in the DB.
    // This handles crash recovery: if the process died mid-trade, the Set
    // is reconstructed so isActive() continues to guard against duplicates.
    this._rebuildActiveSet();
  }

  /**
   * Returns true if the given mint has an open (non-terminal) trade.
   */
  isActive(mint: string): boolean {
    return this.activeMints.has(mint);
  }

  /**
   * Inserts a BUYING record for the mint synchronously.
   * Throws immediately if the mint is already in the active Set.
   *
   * The synchronous better-sqlite3 API ensures no async gap exists between
   * the Set check and the DB write — this is the duplicate-guard guarantee.
   */
  createBuyingRecord(mint: string): void {
    if (this.activeMints.has(mint)) {
      throw new Error(`Duplicate buy attempt blocked for mint: ${mint}`);
    }

    const now = Date.now();
    this.stmtInsert.run({ mint, state: 'BUYING', now });
    this.activeMints.add(mint);

    log.debug({ mint }, 'createBuyingRecord: inserted BUYING row');
  }

  /**
   * Transitions a trade from one state to another using optimistic locking.
   *
   * Returns the number of rows changed (1 = success, 0 = state mismatch).
   * Callers should treat changes=0 as a concurrency conflict.
   *
   * Terminal states (COMPLETED, FAILED, ABANDONED) remove the mint from
   * the active Set so future createBuyingRecord() calls are allowed.
   */
  transition(
    mint: string,
    from: TradeState,
    to: TradeState,
    extra: Partial<Pick<Trade, 'buySignature' | 'sellSignature' | 'errorMessage' | 'amountSol' | 'amountTokens' | 'buyPriceSol' | 'sellPriceSol'>> = {}
  ): number {
    const now = Date.now();

    const result = this.stmtUpdateState.run({
      mint,
      state: to,
      now,
      expectedState: from,
      buy_signature:  extra.buySignature  ?? null,
      sell_signature: extra.sellSignature ?? null,
      error_message:  extra.errorMessage  ?? null,
      amount_sol:     extra.amountSol     ?? null,
      amount_tokens:  extra.amountTokens  ?? null,
      buy_price_sol:  extra.buyPriceSol   ?? null,
      sell_price_sol: extra.sellPriceSol  ?? null,
    });

    const changes = result.changes;

    if (changes > 0 && TERMINAL_STATES.has(to)) {
      this.activeMints.delete(mint);
      log.debug({ mint, from, to }, 'transition: reached terminal state, removed from active set');
    } else if (changes > 0) {
      log.debug({ mint, from, to }, 'transition: non-terminal state update');
    } else {
      log.warn({ mint, from, to }, 'transition: optimistic lock miss (state mismatch)');
    }

    return changes;
  }

  /**
   * Flushes and closes the underlying SQLite database.
   */
  close(): void {
    this.db.close();
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private _rebuildActiveSet(): void {
    const rows = this.stmtGetNonTerminal.all(...NON_TERMINAL_STATES) as Array<{ mint: string }>;
    for (const row of rows) {
      this.activeMints.add(row.mint);
    }
    log.debug({ count: rows.length }, 'activeMints rebuilt from DB');
  }
}
