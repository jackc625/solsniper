/**
 * Safety Pipeline Audit Script
 *
 * Analyzes safety pipeline accuracy by correlating historical safety decisions
 * with actual trade outcomes. Produces a Markdown report with false positive/negative
 * rates, per-check accuracy, and weight/threshold recommendations.
 *
 * Usage: npx tsx scripts/audit-safety.ts --db data/trades.db [--logs bot.log] [--output reports/]
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CheckDetail {
  source: string;
  pass: boolean;
  score?: number;
  detail: string;
}

export interface SafetyLogEntry {
  mint: string;
  source: string;
  decision: 'PASSED' | 'REJECTED';
  aggregateScore: number;
  minSafetyScore: number;
  rejectionReasons: string[];
  tier1: CheckDetail[];
  tier2: CheckDetail[];
  tier3: CheckDetail[];
  durationMs: number;
  time: number;
}

export interface TradeAuditRow {
  mint: string;
  source: string | null;
  state: string;
  amount_sol: number | null;
  sell_price_sol: number | null;
  pnl_sol: number | null;
  safety_score: number | null;
  safety_rejection_reasons: string | null;
  safety_checks_detail: string | null;
  created_at: number;
}

export interface CorrelatedEntry {
  trade?: TradeAuditRow;
  decision?: SafetyLogEntry;
  profitable: boolean;
}

export interface ScoreBucket {
  range: string;
  count: number;
}

export interface PerCheckStats {
  source: string;
  totalSeen: number;
  passCount: number;
  failCount: number;
  avgScore: number;
  contributedToCorrectReject: number;
  contributedToIncorrectReject: number;
}

export interface AuditStats {
  totalPassed: number;
  totalRejected: number;
  profitableCount: number;
  lossCount: number;
  totalSolGained: number;
  totalSolLost: number;
  netPnl: number;
  rejectedSampleCount: number;
  scoreDistribution: ScoreBucket[];
  perCheckStats: PerCheckStats[];
  avgDurationMs: number;
  recommendations: string[];
  dateRange: { earliest: number; latest: number } | null;
}

// ---------------------------------------------------------------------------
// Stub exports -- TDD RED phase, will be implemented in GREEN
// ---------------------------------------------------------------------------

export function parseLogLine(_line: string): SafetyLogEntry | null {
  throw new Error('Not implemented');
}

export function correlateTradesWithDecisions(
  _trades: TradeAuditRow[],
  _decisions: SafetyLogEntry[],
): CorrelatedEntry[] {
  throw new Error('Not implemented');
}

export function computeStats(
  _correlated: CorrelatedEntry[],
  _rejectedSample: string[],
): AuditStats {
  throw new Error('Not implemented');
}

export function generateReport(_stats: AuditStats): string {
  throw new Error('Not implemented');
}

export function formatScoreDistribution(_dist: ScoreBucket[]): string {
  throw new Error('Not implemented');
}

export function sampleRejectedMints(
  _decisions: SafetyLogEntry[],
  _count: number,
): string[] {
  throw new Error('Not implemented');
}
