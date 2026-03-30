/**
 * Safety Pipeline Audit Script
 *
 * Analyzes safety pipeline accuracy by correlating historical safety decisions
 * with actual trade outcomes. Produces a Markdown report with false positive/negative
 * rates, per-check accuracy, and weight/threshold recommendations.
 *
 * Usage: npx tsx scripts/audit-safety.ts --db data/trades.db [--logs bot.log] [--output reports/]
 *
 * --db:     Path to SQLite trades database (required)
 * --logs:   Path to pino JSON log file (optional -- if absent, only uses DB safety columns)
 * --output: Directory for report output (default: reports/)
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import type BetterSqlite3 from 'better-sqlite3';

// ESM interop for better-sqlite3 (same pattern as trade-store.ts)
const require = createRequire(import.meta.url);

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
// 1. parseLogLine
// ---------------------------------------------------------------------------

/**
 * Parses a single pino JSON log line and extracts safety pipeline decision data.
 * Returns null if the line is not a safety-pipeline decision entry.
 */
export function parseLogLine(line: string): SafetyLogEntry | null {
  try {
    const obj = JSON.parse(line);

    // Must be a safety-pipeline module entry with a decision field
    if (obj.module !== 'safety-pipeline' || !obj.decision) {
      return null;
    }

    // Validate required fields exist
    if (!obj.mint || obj.aggregateScore === undefined) {
      return null;
    }

    return {
      mint: obj.mint,
      source: obj.source ?? 'unknown',
      decision: obj.decision as 'PASSED' | 'REJECTED',
      aggregateScore: obj.aggregateScore,
      minSafetyScore: obj.minSafetyScore ?? 0,
      rejectionReasons: obj.rejectionReasons ?? [],
      tier1: obj.tier1 ?? [],
      tier2: obj.tier2 ?? [],
      tier3: obj.tier3 ?? [],
      durationMs: obj.durationMs ?? 0,
      time: obj.time ?? 0,
    };
  } catch {
    // Invalid JSON -- skip line
    return null;
  }
}

// ---------------------------------------------------------------------------
// 2. readLogFile
// ---------------------------------------------------------------------------

/**
 * Reads a pino JSON log file line-by-line and extracts safety pipeline entries.
 */
export async function readLogFile(logPath: string): Promise<SafetyLogEntry[]> {
  const entries: SafetyLogEntry[] = [];
  const rl = readline.createInterface({
    input: fs.createReadStream(logPath, { encoding: 'utf-8' }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    const entry = parseLogLine(line);
    if (entry) {
      entries.push(entry);
    }
  }

  return entries;
}

// ---------------------------------------------------------------------------
// 3. queryTradesFromDb
// ---------------------------------------------------------------------------

/**
 * Queries the trades database for completed trades with P&L data.
 * Opens database in read-only mode -- audit script NEVER writes to the live DB.
 */
export function queryTradesFromDb(dbPath: string): TradeAuditRow[] {
  const Database = require('better-sqlite3') as typeof BetterSqlite3;
  const db = new Database(dbPath, { readonly: true });

  try {
    // Check which safety columns exist (they may not if DB predates Phase 18)
    const columns = (db.pragma('table_info(trades)') as { name: string }[]).map(c => c.name);
    const hasSafetyCols = columns.includes('safety_score');

    // Build SELECT with safety columns only if they exist
    const safetyCols = hasSafetyCols
      ? 'safety_score, safety_rejection_reasons, safety_checks_detail,'
      : 'NULL AS safety_score, NULL AS safety_rejection_reasons, NULL AS safety_checks_detail,';

    // Query all trades (COMPLETED, FAILED, ABANDONED) for comprehensive analysis
    const rows = db.prepare(`
      SELECT mint, source, state, amount_sol, sell_price_sol,
             CASE
               WHEN sell_price_sol IS NOT NULL AND amount_sol IS NOT NULL
               THEN (sell_price_sol - amount_sol)
               ELSE NULL
             END AS pnl_sol,
             ${safetyCols}
             created_at
      FROM trades
      WHERE state IN ('COMPLETED', 'FAILED', 'ABANDONED')
      ORDER BY created_at ASC
    `).all() as TradeAuditRow[];

    if (!hasSafetyCols) {
      console.log('  Note: safety columns not found in DB schema -- using NULL values (DB predates Phase 18 migration)');
    }

    return rows;
  } finally {
    db.close();
  }
}

// ---------------------------------------------------------------------------
// 4. correlateTradesWithDecisions
// ---------------------------------------------------------------------------

/**
 * Matches trades to safety log decisions by mint address.
 * - Trades exist only for PASSED tokens (they were bought).
 * - Unmatched REJECTED decisions are included for false positive analysis.
 */
export function correlateTradesWithDecisions(
  trades: TradeAuditRow[],
  decisions: SafetyLogEntry[],
): CorrelatedEntry[] {
  const result: CorrelatedEntry[] = [];

  // Index trades by mint for O(1) lookup
  const tradeByMint = new Map<string, TradeAuditRow>();
  for (const trade of trades) {
    tradeByMint.set(trade.mint, trade);
  }

  // Index decisions by mint (use latest decision per mint)
  const decisionByMint = new Map<string, SafetyLogEntry>();
  for (const dec of decisions) {
    const existing = decisionByMint.get(dec.mint);
    if (!existing || dec.time > existing.time) {
      decisionByMint.set(dec.mint, dec);
    }
  }

  // Matched: trades with decisions
  const matchedMints = new Set<string>();
  for (const trade of trades) {
    const decision = decisionByMint.get(trade.mint);
    const pnl = trade.pnl_sol ?? 0;
    result.push({
      trade,
      decision,
      profitable: pnl > 0,
    });
    matchedMints.add(trade.mint);
  }

  // Unmatched decisions: REJECTED tokens with no trade (false positive candidates)
  for (const [mint, decision] of decisionByMint) {
    if (!matchedMints.has(mint)) {
      result.push({
        trade: undefined,
        decision,
        profitable: false,
      });
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// 5. sampleRejectedMints
// ---------------------------------------------------------------------------

/**
 * Returns a random sample of rejected mint addresses for false positive analysis.
 * Deduplicates by mint before sampling.
 */
export function sampleRejectedMints(
  decisions: SafetyLogEntry[],
  count: number,
): string[] {
  const rejectedMints = [
    ...new Set(
      decisions
        .filter(d => d.decision === 'REJECTED')
        .map(d => d.mint)
    ),
  ];

  if (rejectedMints.length <= count) {
    return rejectedMints;
  }

  // Fisher-Yates shuffle, take first `count`
  const shuffled = [...rejectedMints];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  return shuffled.slice(0, count);
}

// ---------------------------------------------------------------------------
// 6. computeStats
// ---------------------------------------------------------------------------

/**
 * Computes aggregate statistics from correlated trade/decision data.
 */
export function computeStats(
  correlated: CorrelatedEntry[],
  rejectedSample: string[],
): AuditStats {
  let totalPassed = 0;
  let totalRejected = 0;
  let profitableCount = 0;
  let lossCount = 0;
  let totalSolGained = 0;
  let totalSolLost = 0;

  const allScores: number[] = [];
  const allDurations: number[] = [];

  // Per-check tracking
  const checkMap = new Map<string, {
    totalSeen: number;
    passCount: number;
    failCount: number;
    scores: number[];
    correctReject: number;
    incorrectReject: number;
  }>();

  let earliest = Infinity;
  let latest = -Infinity;

  for (const entry of correlated) {
    const decision = entry.decision;

    if (decision) {
      // Track time range
      if (decision.time < earliest) earliest = decision.time;
      if (decision.time > latest) latest = decision.time;

      // Count decisions
      if (decision.decision === 'PASSED') {
        totalPassed++;
      } else {
        totalRejected++;
      }

      // Track scores and durations
      allScores.push(decision.aggregateScore);
      allDurations.push(decision.durationMs);

      // Per-check stats from all tiers
      const allChecks = [...decision.tier1, ...decision.tier2, ...decision.tier3];
      for (const check of allChecks) {
        let stats = checkMap.get(check.source);
        if (!stats) {
          stats = { totalSeen: 0, passCount: 0, failCount: 0, scores: [], correctReject: 0, incorrectReject: 0 };
          checkMap.set(check.source, stats);
        }
        stats.totalSeen++;
        if (check.pass) {
          stats.passCount++;
        } else {
          stats.failCount++;
          // Was the overall decision also a rejection?
          if (decision.decision === 'REJECTED') {
            stats.correctReject++;
          } else {
            stats.incorrectReject++;
          }
        }
        if (check.score !== undefined) {
          stats.scores.push(check.score);
        }
      }
    } else if (entry.trade && entry.trade.safety_score !== null) {
      // Trade with DB safety score but no log decision -- count as passed
      totalPassed++;
      allScores.push(entry.trade.safety_score);
    }
    // Trades with neither log decision nor DB safety score are NOT counted as
    // evaluated -- they predate the safety pipeline and inflating "tokens evaluated"
    // with them produces a misleading report.

    // P&L tracking (only for trades)
    if (entry.trade) {
      const pnl = entry.trade.pnl_sol ?? 0;
      if (pnl > 0) {
        profitableCount++;
        totalSolGained += pnl;
      } else if (pnl < 0) {
        lossCount++;
        totalSolLost += Math.abs(pnl);
      }
    }
  }

  // Score distribution: 10 buckets
  const scoreDistribution = buildScoreDistribution(allScores);

  // Per-check stats
  const perCheckStats: PerCheckStats[] = [];
  for (const [source, stats] of checkMap) {
    perCheckStats.push({
      source,
      totalSeen: stats.totalSeen,
      passCount: stats.passCount,
      failCount: stats.failCount,
      avgScore: stats.scores.length > 0
        ? Math.round(stats.scores.reduce((a, b) => a + b, 0) / stats.scores.length)
        : 0,
      contributedToCorrectReject: stats.correctReject,
      contributedToIncorrectReject: stats.incorrectReject,
    });
  }

  // Average duration
  const avgDurationMs = allDurations.length > 0
    ? Math.round(allDurations.reduce((a, b) => a + b, 0) / allDurations.length)
    : 0;

  // Recommendations
  const recommendations = generateRecommendations(
    correlated, totalPassed, totalRejected, profitableCount, lossCount, perCheckStats,
  );

  return {
    totalPassed,
    totalRejected,
    profitableCount,
    lossCount,
    totalSolGained,
    totalSolLost,
    netPnl: totalSolGained - totalSolLost,
    rejectedSampleCount: rejectedSample.length,
    scoreDistribution,
    perCheckStats,
    avgDurationMs,
    recommendations,
    dateRange: earliest !== Infinity ? { earliest, latest } : null,
  };
}

// ---------------------------------------------------------------------------
// Score distribution helper
// ---------------------------------------------------------------------------

function buildScoreDistribution(scores: number[]): ScoreBucket[] {
  const buckets: ScoreBucket[] = [
    { range: '0-9', count: 0 },
    { range: '10-19', count: 0 },
    { range: '20-29', count: 0 },
    { range: '30-39', count: 0 },
    { range: '40-49', count: 0 },
    { range: '50-59', count: 0 },
    { range: '60-69', count: 0 },
    { range: '70-79', count: 0 },
    { range: '80-89', count: 0 },
    { range: '90-100', count: 0 },
  ];

  for (const score of scores) {
    const idx = score >= 100 ? 9 : Math.floor(score / 10);
    if (idx >= 0 && idx < buckets.length) {
      buckets[idx].count++;
    }
  }

  return buckets;
}

// ---------------------------------------------------------------------------
// Recommendation generator
// ---------------------------------------------------------------------------

function generateRecommendations(
  correlated: CorrelatedEntry[],
  totalPassed: number,
  totalRejected: number,
  profitableCount: number,
  _lossCount: number,
  perCheckStats: PerCheckStats[],
): string[] {
  const recs: string[] = [];

  if (totalPassed + totalRejected === 0) {
    recs.push('Insufficient data -- no safety decisions found for analysis.');
    return recs;
  }

  // Win rate analysis (use trades with P&L data, not totalPassed which includes trades without outcomes)
  const tradesWithOutcome = profitableCount + _lossCount;
  if (tradesWithOutcome > 0) {
    const winRate = profitableCount / tradesWithOutcome;
    if (winRate < 0.3) {
      recs.push(
        `Low win rate (${(winRate * 100).toFixed(1)}%) suggests minSafetyScore threshold may be too low. ` +
        `Consider raising it to filter more marginal tokens.`,
      );
    } else if (winRate > 0.7) {
      recs.push(
        `High win rate (${(winRate * 100).toFixed(1)}%) suggests safety pipeline is effective. ` +
        `Consider slightly lowering minSafetyScore to capture more opportunities.`,
      );
    }
  }

  // Check for near-threshold losses: tokens that barely passed but lost money
  const nearThresholdLosses = correlated.filter(e =>
    e.trade && e.decision &&
    e.decision.decision === 'PASSED' &&
    (e.trade.pnl_sol ?? 0) < 0 &&
    e.decision.aggregateScore < (e.decision.minSafetyScore + 10),
  );
  if (nearThresholdLosses.length > 2) {
    recs.push(
      `${nearThresholdLosses.length} loss trades had scores within 10 points of the threshold. ` +
      `Consider raising minSafetyScore by 5-10 points.`,
    );
  }

  // High false rejection rate per check
  for (const check of perCheckStats) {
    if (check.failCount > 0 && check.contributedToIncorrectReject > check.contributedToCorrectReject) {
      recs.push(
        `Check '${check.source}' has more incorrect rejections (${check.contributedToIncorrectReject}) ` +
        `than correct (${check.contributedToCorrectReject}). Consider lowering its weight.`,
      );
    }
  }

  // Rejection rate
  const rejectRate = totalRejected / (totalPassed + totalRejected);
  if (rejectRate > 0.95) {
    recs.push(
      `Very high rejection rate (${(rejectRate * 100).toFixed(1)}%). ` +
      `Pipeline may be too aggressive. Review individual check thresholds.`,
    );
  } else if (rejectRate < 0.5) {
    recs.push(
      `Low rejection rate (${(rejectRate * 100).toFixed(1)}%). ` +
      `Pipeline may be too permissive. Consider raising check thresholds.`,
    );
  }

  if (recs.length === 0) {
    recs.push('No specific recommendations -- pipeline appears well-calibrated based on available data.');
  }

  return recs;
}

// ---------------------------------------------------------------------------
// 7. formatScoreDistribution
// ---------------------------------------------------------------------------

/**
 * Formats score distribution buckets as a Markdown table with histogram bars.
 */
export function formatScoreDistribution(dist: ScoreBucket[]): string {
  const maxCount = Math.max(...dist.map(b => b.count), 1);
  const barWidth = 20;

  const lines = ['| Range | Count | Distribution |', '|-------|-------|--------------|'];

  for (const bucket of dist) {
    const barLen = Math.round((bucket.count / maxCount) * barWidth);
    const bar = '#'.repeat(barLen);
    lines.push(`| ${bucket.range.padEnd(5)} | ${String(bucket.count).padStart(5)} | ${bar} |`);
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// 8. generateReport
// ---------------------------------------------------------------------------

/**
 * Generates a Markdown audit report from computed statistics.
 * Returns the report content as a string.
 */
export function generateReport(stats: AuditStats): string {
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];

  const dateRange = stats.dateRange
    ? `${new Date(stats.dateRange.earliest).toISOString().split('T')[0]} to ${new Date(stats.dateRange.latest).toISOString().split('T')[0]}`
    : 'N/A';

  const lines: string[] = [];

  // Title
  lines.push(`# Safety Pipeline Audit Report`);
  lines.push(`\n**Generated:** ${dateStr}`);
  lines.push(`**Date range:** ${dateRange}`);
  lines.push('');

  // Summary
  lines.push('## Summary');
  lines.push('');
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Total tokens evaluated | ${stats.totalPassed + stats.totalRejected} |`);
  lines.push(`| Passed | ${stats.totalPassed} |`);
  lines.push(`| Rejected | ${stats.totalRejected} |`);
  lines.push(`| Rejection rate | ${stats.totalPassed + stats.totalRejected > 0 ? ((stats.totalRejected / (stats.totalPassed + stats.totalRejected)) * 100).toFixed(1) : 0}% |`);
  lines.push(`| Avg evaluation duration | ${stats.avgDurationMs}ms |`);
  lines.push('');

  // Trade Outcomes
  lines.push('## Trade Outcomes');
  lines.push('');
  lines.push('Outcome analysis for tokens that passed the safety pipeline and were bought:');
  lines.push('');
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Total trades | ${stats.profitableCount + stats.lossCount} |`);
  lines.push(`| Profitable | ${stats.profitableCount} |`);
  lines.push(`| Loss | ${stats.lossCount} |`);
  lines.push(`| Win rate | ${stats.profitableCount + stats.lossCount > 0 ? ((stats.profitableCount / (stats.profitableCount + stats.lossCount)) * 100).toFixed(1) : 0}% |`);
  lines.push(`| Total SOL gained | ${stats.totalSolGained.toFixed(4)} |`);
  lines.push(`| Total SOL lost | ${stats.totalSolLost.toFixed(4)} |`);
  lines.push(`| Net P&L | ${stats.netPnl.toFixed(4)} SOL |`);
  lines.push('');

  // Per-Check Accuracy
  lines.push('## Per-Check Accuracy');
  lines.push('');
  if (stats.perCheckStats.length === 0) {
    lines.push('No per-check data available (log file not provided or no safety decisions in logs).');
  } else {
    lines.push('| Check | Seen | Pass | Fail | Avg Score | Correct Reject | Incorrect Reject |');
    lines.push('|-------|------|------|------|-----------|----------------|------------------|');
    for (const check of stats.perCheckStats) {
      lines.push(
        `| ${check.source} | ${check.totalSeen} | ${check.passCount} | ${check.failCount} | ${check.avgScore} | ${check.contributedToCorrectReject} | ${check.contributedToIncorrectReject} |`,
      );
    }
  }
  lines.push('');

  // Score Distribution
  lines.push('## Score Distribution');
  lines.push('');
  lines.push(formatScoreDistribution(stats.scoreDistribution));
  lines.push('');

  // False Positive Estimate
  lines.push('## False Positive Estimate');
  lines.push('');
  if (stats.rejectedSampleCount > 0) {
    lines.push(`Sampled ${stats.rejectedSampleCount} rejected mints for manual price/status check.`);
    lines.push('Run with `--logs` flag and check sampled mints on Solscan/Birdeye to estimate false positive rate.');
  } else {
    lines.push('No rejected mints sampled. Provide a log file with `--logs` for false positive analysis.');
  }
  lines.push('');

  // Recommendations
  lines.push('## Recommendations');
  lines.push('');
  for (const rec of stats.recommendations) {
    lines.push(`- ${rec}`);
  }
  lines.push('');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Report writer (file output)
// ---------------------------------------------------------------------------

/**
 * Writes the audit report to a Markdown file in the output directory.
 * Returns the file path.
 */
export function writeReport(stats: AuditStats, outputDir: string): string {
  const report = generateReport(stats);
  const dateStr = new Date().toISOString().split('T')[0];
  const filename = `safety-audit-${dateStr}.md`;
  const filePath = path.join(outputDir, filename);

  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(filePath, report, 'utf-8');

  return filePath;
}

// ---------------------------------------------------------------------------
// CLI argument parser
// ---------------------------------------------------------------------------

interface CliArgs {
  db: string;
  logs?: string;
  output: string;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let db: string | undefined;
  let logs: string | undefined;
  let output = 'reports/';

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--db':
        db = args[++i];
        break;
      case '--logs':
        logs = args[++i];
        break;
      case '--output':
        output = args[++i];
        break;
    }
  }

  if (!db) {
    console.error('Usage: npx tsx scripts/audit-safety.ts --db <path> [--logs <path>] [--output <dir>]');
    process.exit(1);
  }

  return { db, logs, output };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs();

  console.log(`Reading trades from: ${args.db}`);
  const trades = queryTradesFromDb(args.db);
  console.log(`  Found ${trades.length} trades (COMPLETED/FAILED/ABANDONED)`);

  let decisions: SafetyLogEntry[] = [];
  if (args.logs) {
    console.log(`Reading safety decisions from: ${args.logs}`);
    decisions = await readLogFile(args.logs);
    console.log(`  Found ${decisions.length} safety pipeline decisions`);
  } else {
    console.log('No log file provided -- using DB safety columns only');
  }

  const correlated = correlateTradesWithDecisions(trades, decisions);
  const rejectedSample = sampleRejectedMints(decisions, 50);

  if (rejectedSample.length > 0) {
    console.log(`\nSampled ${rejectedSample.length} rejected mints for manual price check:`);
    for (const mint of rejectedSample.slice(0, 5)) {
      console.log(`  https://solscan.io/token/${mint}`);
    }
    if (rejectedSample.length > 5) {
      console.log(`  ... and ${rejectedSample.length - 5} more (see report)`);
    }
  }

  const stats = computeStats(correlated, rejectedSample);
  const reportPath = writeReport(stats, args.output);
  console.log(`\nAudit report written to: ${reportPath}`);
}

// Only run main when executed directly (not when imported by tests)
const isDirectExecution = process.argv[1]?.endsWith('audit-safety.ts') ||
  process.argv[1]?.endsWith('audit-safety.js');
if (isDirectExecution) {
  main().catch(err => {
    console.error('Audit script failed:', err);
    process.exit(1);
  });
}
