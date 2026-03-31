// SQL schema for the trades table.
// Executed via db.exec(SCHEMA_SQL) in TradeStore constructor.

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS trades (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  mint              TEXT    NOT NULL,
  state             TEXT    NOT NULL,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,
  buy_signature     TEXT,
  sell_signature    TEXT,
  amount_sol        REAL,
  amount_tokens     REAL,
  buy_price_sol     REAL,
  sell_price_sol    REAL,
  error_message     TEXT,
  source            TEXT,
  token_program_id  TEXT
);

CREATE INDEX IF NOT EXISTS idx_trades_mint_state ON trades (mint, state);
`;

// Migration: add source and token_program_id columns to existing databases.
// Wrapped in try-catch so they're no-ops on fresh DBs that already have these columns.
export const MIGRATION_SQL = [
  `ALTER TABLE trades ADD COLUMN source TEXT`,
  `ALTER TABLE trades ADD COLUMN token_program_id TEXT`,
  `ALTER TABLE trades ADD COLUMN dry_run INTEGER`,
  `ALTER TABLE trades ADD COLUMN safety_score INTEGER`,
  `ALTER TABLE trades ADD COLUMN safety_rejection_reasons TEXT`,
  `ALTER TABLE trades ADD COLUMN safety_checks_detail TEXT`,
];

// Phase 20: Alerts table for SYSTEM_ALERT persistence (REL-02)
export const ALERTS_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS alerts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp  INTEGER NOT NULL,
  type       TEXT    NOT NULL,
  severity   TEXT    NOT NULL,
  source     TEXT    NOT NULL,
  message    TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_alerts_timestamp ON alerts (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_source ON alerts (source);
`;

// Future migrations for the alerts table go here.
// No-op for fresh DBs -- alerts table already created by ALERTS_SCHEMA_SQL.
export const ALERTS_MIGRATION_SQL: string[] = [];
