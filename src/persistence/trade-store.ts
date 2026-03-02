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
import { SCHEMA_SQL, MIGRATION_SQL } from './schema.js';
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
  private readonly stmtGetBuying: BetterSqlite3.Statement;
  private readonly stmtGetSelling: BetterSqlite3.Statement;
  private readonly stmtGetMonitoring: BetterSqlite3.Statement;
  private readonly stmtGetDetected: BetterSqlite3.Statement;
  private readonly stmtUpdateStateById: BetterSqlite3.Statement;
  private readonly stmtSetMonitoringAmount: BetterSqlite3.Statement;
  private readonly stmtGetByMint: BetterSqlite3.Statement;

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

    // Run migrations for existing databases (no-op for fresh DBs with columns already present)
    for (const sql of MIGRATION_SQL) {
      try {
        this.db.exec(sql);
      } catch {
        // Column already exists — safe to ignore
      }
    }

    // Compile prepared statements once at construction time for efficiency.
    this.stmtInsert = this.db.prepare(
      `INSERT INTO trades (mint, state, created_at, updated_at, source, token_program_id)
       VALUES (@mint, @state, @now, @now, @source, @token_program_id)`
    );

    // COALESCE pattern: only overwrite a column if the caller supplies a non-null value.
    this.stmtUpdateState = this.db.prepare(
      `UPDATE trades SET
         state              = @state,
         updated_at         = @now,
         buy_signature      = COALESCE(@buy_signature,     buy_signature),
         sell_signature     = COALESCE(@sell_signature,    sell_signature),
         error_message      = COALESCE(@error_message,     error_message),
         amount_sol         = COALESCE(@amount_sol,        amount_sol),
         amount_tokens      = COALESCE(@amount_tokens,     amount_tokens),
         buy_price_sol      = COALESCE(@buy_price_sol,     buy_price_sol),
         sell_price_sol     = COALESCE(@sell_price_sol,    sell_price_sol),
         source             = COALESCE(@source,            source),
         token_program_id   = COALESCE(@token_program_id,  token_program_id)
       WHERE mint = @mint AND state = @expectedState`
    );

    this.stmtGetNonTerminal = this.db.prepare(
      `SELECT mint FROM trades WHERE state IN (${NON_TERMINAL_STATES.map(() => '?').join(',')})`
    );

    this.stmtGetBuying = this.db.prepare(
      `SELECT id, mint, state, created_at, updated_at, amount_tokens, error_message, source, token_program_id
       FROM trades WHERE state = 'BUYING' ORDER BY updated_at DESC`
    );

    this.stmtGetSelling = this.db.prepare(
      `SELECT id, mint, state, created_at, updated_at, amount_tokens, error_message, source, token_program_id
       FROM trades WHERE state = 'SELLING' ORDER BY updated_at DESC`
    );

    this.stmtGetMonitoring = this.db.prepare(
      `SELECT id, mint, state, created_at, updated_at, amount_tokens, source, token_program_id
       FROM trades WHERE state = 'MONITORING' ORDER BY updated_at DESC`
    );

    this.stmtGetDetected = this.db.prepare(
      `SELECT id, mint FROM trades WHERE state = 'DETECTED'`
    );

    this.stmtUpdateStateById = this.db.prepare(
      `UPDATE trades SET
         state         = @state,
         updated_at    = @now,
         error_message = COALESCE(@error_message, error_message)
       WHERE id = @id AND state = @expectedState`
    );

    this.stmtSetMonitoringAmount = this.db.prepare(
      `UPDATE trades SET amount_tokens = @amount_tokens, updated_at = @now
       WHERE mint = @mint AND state = 'MONITORING'`
    );

    this.stmtGetByMint = this.db.prepare(
      `SELECT id, mint, state, created_at, updated_at, buy_signature, sell_signature,
              amount_sol, amount_tokens, buy_price_sol, sell_price_sol, error_message,
              source, token_program_id
       FROM trades WHERE mint = @mint ORDER BY updated_at DESC LIMIT 1`
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
   *
   * @param source - Optional detection source ('pumpportal' | 'raydium' | 'pumpswap')
   * @param tokenProgramId - Optional detected token program ID (base58 pubkey)
   */
  createBuyingRecord(mint: string, source?: string, tokenProgramId?: string): void {
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
    });
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
    extra: Partial<Pick<Trade, 'buySignature' | 'sellSignature' | 'errorMessage' | 'amountSol' | 'amountTokens' | 'buyPriceSol' | 'sellPriceSol' | 'source' | 'tokenProgramId'>> = {}
  ): number {
    const now = Date.now();

    const result = this.stmtUpdateState.run({
      mint,
      state: to,
      now,
      expectedState: from,
      buy_signature:    extra.buySignature    ?? null,
      sell_signature:   extra.sellSignature   ?? null,
      error_message:    extra.errorMessage    ?? null,
      amount_sol:       extra.amountSol       ?? null,
      amount_tokens:    extra.amountTokens    ?? null,
      buy_price_sol:    extra.buyPriceSol     ?? null,
      sell_price_sol:   extra.sellPriceSol    ?? null,
      source:           extra.source          ?? null,
      token_program_id: extra.tokenProgramId  ?? null,
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
   * Returns all trades currently in BUYING state.
   * Ordered by updated_at DESC.
   */
  getBuyingTrades(): Trade[] {
    return (this.stmtGetBuying.all() as Record<string, unknown>[]).map(r => this.mapRow(r));
  }

  /**
   * Returns all trades currently in SELLING state.
   * Ordered by updated_at DESC — most recently updated first, useful for
   * duplicate-SELLING detection during crash recovery.
   */
  getSellingTrades(): Trade[] {
    return (this.stmtGetSelling.all() as Record<string, unknown>[]).map(r => this.mapRow(r));
  }

  /**
   * Returns all trades currently in MONITORING state.
   * Ordered by updated_at DESC.
   */
  getMonitoringTrades(): Trade[] {
    return (this.stmtGetMonitoring.all() as Record<string, unknown>[]).map(r => this.mapRow(r));
  }

  /**
   * Updates amount_tokens for a MONITORING trade without state transition.
   * Used by PositionManager to backfill token amounts for PumpPortal trades
   * (which enter MONITORING with amountTokens = undefined).
   *
   * Returns number of rows changed (0 if trade not in MONITORING state).
   */
  updateMonitoringAmount(mint: string, amountTokens: number): number {
    const result = this.stmtSetMonitoringAmount.run({
      mint,
      amount_tokens: amountTokens,
      now: Date.now(),
    });
    return result.changes;
  }

  /**
   * Returns all trades currently in DETECTED state (id + mint only).
   */
  getDetectedTrades(): Pick<Trade, 'id' | 'mint'>[] {
    return this.stmtGetDetected.all() as Array<{ id: number; mint: string }>;
  }

  /**
   * Id-precise state transition — for deduplicating multiple SELLING rows
   * for the same mint during crash recovery.
   *
   * Uses the row id instead of mint+state in the WHERE clause, so callers
   * can target a specific row when duplicates exist.
   *
   * Returns the number of rows changed (1 = success, 0 = optimistic lock miss).
   * Removes the mint from activeMints when transitioning to a terminal state.
   */
  transitionById(
    id: number,
    mint: string,
    from: TradeState,
    to: TradeState,
    extra: Partial<Pick<Trade, 'errorMessage'>> = {}
  ): number {
    const now = Date.now();
    const result = this.stmtUpdateStateById.run({
      id,
      state: to,
      now,
      expectedState: from,
      error_message: extra.errorMessage ?? null,
    });
    const changes = result.changes;
    if (changes > 0 && TERMINAL_STATES.has(to)) {
      this.activeMints.delete(mint);
      log.debug({ id, mint, from, to }, 'transitionById: reached terminal state, removed from active set');
    } else if (changes > 0) {
      log.debug({ id, mint, from, to }, 'transitionById: non-terminal state update');
    } else {
      log.warn({ id, mint, from, to }, 'transitionById: optimistic lock miss (state or id mismatch)');
    }
    return changes;
  }

  /**
   * Returns the most recent trade for the given mint, or undefined if none exists.
   * Includes source and tokenProgramId for sell ladder use (Token-2022 ATA lookup, etc.)
   */
  getTradeByMint(mint: string): Trade | undefined {
    const row = this.stmtGetByMint.get({ mint }) as Record<string, unknown> | undefined;
    return row ? this.mapRow(row) : undefined;
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

  private mapRow(row: Record<string, unknown>): Trade {
    return {
      id:             row['id']          as number,
      mint:           row['mint']         as string,
      state:          row['state']        as TradeState,
      createdAt:      row['created_at']   as number,
      updatedAt:      row['updated_at']   as number,
      buySignature:   row['buy_signature']   != null ? (row['buy_signature']   as string) : undefined,
      sellSignature:  row['sell_signature']  != null ? (row['sell_signature']  as string) : undefined,
      amountSol:      row['amount_sol']      != null ? (row['amount_sol']      as number) : undefined,
      amountTokens:   row['amount_tokens']   != null ? (row['amount_tokens']   as number) : undefined,
      buyPriceSol:    row['buy_price_sol']   != null ? (row['buy_price_sol']   as number) : undefined,
      sellPriceSol:   row['sell_price_sol']  != null ? (row['sell_price_sol']  as number) : undefined,
      errorMessage:   row['error_message']   != null ? (row['error_message']   as string) : undefined,
      source:         row['source']          != null ? (row['source']          as string) : undefined,
      tokenProgramId: row['token_program_id'] != null ? (row['token_program_id'] as string) : undefined,
    };
  }

  private _rebuildActiveSet(): void {
    const rows = this.stmtGetNonTerminal.all(...NON_TERMINAL_STATES) as Array<{ mint: string }>;
    for (const row of rows) {
      this.activeMints.add(row.mint);
    }
    log.debug({ count: rows.length }, 'activeMints rebuilt from DB');
  }
}
