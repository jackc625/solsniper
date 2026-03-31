/**
 * AlertStore -- SQLite-backed alert persistence for SYSTEM_ALERT events (REL-02).
 *
 * Receives the same better-sqlite3 Database instance as TradeStore to share the
 * WAL-mode connection. Does NOT create its own database -- caller provides it.
 *
 * ESM interop note: uses createRequire() for better-sqlite3 type import
 * (same pattern as TradeStore).
 */
import { createRequire } from 'node:module';
import type BetterSqlite3 from 'better-sqlite3';

const require = createRequire(import.meta.url);
// Ensures better-sqlite3 types are available at runtime for statement typing
void require;

export interface Alert {
  id: number;
  timestamp: number;
  type: string;
  severity: string;
  source: string;
  message: string;
}

export interface AlertInput {
  timestamp: number;
  type: string;
  severity: string;
  source: string;
  message: string;
}

export interface AlertQueryResult {
  alerts: Alert[];
  total: number;
  page: number;
  limit: number;
}

export class AlertStore {
  private readonly stmtInsert: BetterSqlite3.Statement;
  private readonly stmtQuery: BetterSqlite3.Statement;
  private readonly stmtCount: BetterSqlite3.Statement;

  constructor(db: BetterSqlite3.Database) {
    this.stmtInsert = db.prepare(
      `INSERT INTO alerts (timestamp, type, severity, source, message)
       VALUES (@timestamp, @type, @severity, @source, @message)`
    );

    this.stmtQuery = db.prepare(
      `SELECT id, timestamp, type, severity, source, message
       FROM alerts ORDER BY timestamp DESC LIMIT @limit OFFSET @offset`
    );

    this.stmtCount = db.prepare(`SELECT COUNT(*) AS cnt FROM alerts`);
  }

  /**
   * Inserts a new alert row.
   */
  insert(alert: AlertInput): void {
    this.stmtInsert.run(alert);
  }

  /**
   * Returns paginated alerts ordered by timestamp DESC.
   * Uses standard LIMIT/OFFSET pagination.
   */
  query(opts: { page: number; limit: number }): AlertQueryResult {
    const offset = (opts.page - 1) * opts.limit;
    const alerts = this.stmtQuery.all({ limit: opts.limit, offset }) as Alert[];
    const total = this.count();

    return {
      alerts,
      total,
      page: opts.page,
      limit: opts.limit,
    };
  }

  /**
   * Returns the total number of alerts in the table.
   */
  count(): number {
    const row = this.stmtCount.get() as { cnt: number };
    return row.cnt;
  }
}
