/**
 * Tests for the safety audit script.
 *
 * Tests pure functions: parseLogLine, correlateTradesWithDecisions, computeStats,
 * generateReport, formatScoreDistribution. Uses mock data -- no filesystem or DB access.
 */
import { describe, it, expect } from 'vitest';
import {
  parseLogLine,
  correlateTradesWithDecisions,
  computeStats,
  generateReport,
  formatScoreDistribution,
  sampleRejectedMints,
  type SafetyLogEntry,
  type TradeAuditRow,
} from './audit-safety.js';

// ---------------------------------------------------------------------------
// Mock data factories
// ---------------------------------------------------------------------------

function makeSafetyLog(overrides: Partial<SafetyLogEntry> = {}): SafetyLogEntry {
  return {
    mint: 'TokenMint111111111111111111111111111111111111',
    source: 'pumpportal',
    decision: 'PASSED',
    aggregateScore: 85,
    minSafetyScore: 60,
    rejectionReasons: [],
    tier1: [{ source: 'mint_authority', pass: true, detail: 'revoked' }],
    tier2: [{ source: 'rugcheck', pass: true, score: 70, detail: 'low risk' }],
    tier3: [{ source: 'creator_history', pass: true, score: 90, detail: 'clean' }],
    durationMs: 245,
    time: 1711234567890,
    ...overrides,
  };
}

function makeTradeRow(overrides: Partial<TradeAuditRow> = {}): TradeAuditRow {
  return {
    mint: 'TokenMint111111111111111111111111111111111111',
    source: 'pumpportal',
    state: 'COMPLETED',
    amount_sol: 0.05,
    sell_price_sol: 0.08,
    pnl_sol: 0.03,
    safety_score: 85,
    safety_rejection_reasons: null,
    safety_checks_detail: null,
    created_at: 1711234567890,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// parseLogLine
// ---------------------------------------------------------------------------

describe('parseLogLine', () => {
  it('extracts safety decision fields from valid pino JSON line', () => {
    const line = JSON.stringify({
      level: 30,
      time: 1711234567890,
      module: 'safety-pipeline',
      mint: 'TokenMint111111111111111111111111111111111111',
      source: 'pumpportal',
      decision: 'PASSED',
      aggregateScore: 85,
      minSafetyScore: 60,
      rejectionReasons: [],
      tier1: [{ source: 'mint_authority', pass: true, detail: 'revoked' }],
      tier2: [{ source: 'rugcheck', pass: true, score: 70, detail: 'low risk' }],
      tier3: [{ source: 'creator_history', pass: true, score: 90, detail: 'clean' }],
      durationMs: 245,
      msg: 'Token passed safety pipeline',
    });

    const result = parseLogLine(line);
    expect(result).not.toBeNull();
    expect(result!.mint).toBe('TokenMint111111111111111111111111111111111111');
    expect(result!.decision).toBe('PASSED');
    expect(result!.aggregateScore).toBe(85);
    expect(result!.tier1).toHaveLength(1);
    expect(result!.durationMs).toBe(245);
  });

  it('returns null for non-safety-pipeline log lines', () => {
    const nonSafetyLine = JSON.stringify({
      level: 30,
      time: 1711234567890,
      module: 'trade-store',
      msg: 'createBuyingRecord: inserted BUYING row',
    });

    expect(parseLogLine(nonSafetyLine)).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    expect(parseLogLine('not json at all')).toBeNull();
  });

  it('returns null for lines missing decision field', () => {
    const incomplete = JSON.stringify({
      level: 30,
      time: 1711234567890,
      module: 'safety-pipeline',
      mint: 'TokenMint111111111111111111111111111111111111',
      msg: 'some other safety log',
    });
    expect(parseLogLine(incomplete)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// correlateTradesWithDecisions
// ---------------------------------------------------------------------------

describe('correlateTradesWithDecisions', () => {
  it('matches trade mint to log decision', () => {
    const mint = 'TokenMint111111111111111111111111111111111111';
    const trades = [makeTradeRow({ mint })];
    const decisions = [makeSafetyLog({ mint, decision: 'PASSED' })];

    const result = correlateTradesWithDecisions(trades, decisions);
    expect(result).toHaveLength(1);
    expect(result[0].trade).toBeDefined();
    expect(result[0].decision).toBeDefined();
    expect(result[0].profitable).toBe(true);
  });

  it('marks loss trades as not profitable', () => {
    const mint = 'LossMint111111111111111111111111111111111111';
    const trades = [makeTradeRow({ mint, pnl_sol: -0.02 })];
    const decisions = [makeSafetyLog({ mint, decision: 'PASSED' })];

    const result = correlateTradesWithDecisions(trades, decisions);
    expect(result[0].profitable).toBe(false);
  });

  it('includes rejected decisions without matching trades', () => {
    const rejectedMint = 'RejMint1111111111111111111111111111111111111';
    const trades: TradeAuditRow[] = [];
    const decisions = [makeSafetyLog({ mint: rejectedMint, decision: 'REJECTED' })];

    const result = correlateTradesWithDecisions(trades, decisions);
    expect(result).toHaveLength(1);
    expect(result[0].trade).toBeUndefined();
    expect(result[0].decision?.decision).toBe('REJECTED');
  });
});

// ---------------------------------------------------------------------------
// computeStats
// ---------------------------------------------------------------------------

describe('computeStats', () => {
  it('calculates correct P&L distribution for passed tokens', () => {
    const correlated = [
      { trade: makeTradeRow({ pnl_sol: 0.05 }), decision: makeSafetyLog({ decision: 'PASSED' }), profitable: true },
      { trade: makeTradeRow({ pnl_sol: -0.02 }), decision: makeSafetyLog({ decision: 'PASSED' }), profitable: false },
      { trade: makeTradeRow({ pnl_sol: 0.10 }), decision: makeSafetyLog({ decision: 'PASSED' }), profitable: true },
    ];

    const stats = computeStats(correlated, []);
    expect(stats.totalPassed).toBe(3);
    expect(stats.profitableCount).toBe(2);
    expect(stats.lossCount).toBe(1);
    expect(stats.totalSolGained).toBeCloseTo(0.15);
    expect(stats.totalSolLost).toBeCloseTo(0.02);
    expect(stats.netPnl).toBeCloseTo(0.13);
  });

  it('identifies false negatives (rejected tokens in sample)', () => {
    const correlated = [
      {
        decision: makeSafetyLog({ decision: 'REJECTED', mint: 'Rej111111111111111111111111111111111111111111' }),
        trade: undefined,
        profitable: false,
      },
    ];

    const stats = computeStats(correlated, ['Rej111111111111111111111111111111111111111111']);
    expect(stats.totalRejected).toBe(1);
    expect(stats.rejectedSampleCount).toBe(1);
  });

  it('computes score distribution buckets', () => {
    const correlated = [
      { trade: makeTradeRow(), decision: makeSafetyLog({ aggregateScore: 15 }), profitable: true },
      { trade: makeTradeRow(), decision: makeSafetyLog({ aggregateScore: 45 }), profitable: true },
      { trade: makeTradeRow(), decision: makeSafetyLog({ aggregateScore: 85 }), profitable: true },
      { trade: makeTradeRow(), decision: makeSafetyLog({ aggregateScore: 92 }), profitable: true },
    ];

    const stats = computeStats(correlated, []);
    expect(stats.scoreDistribution).toBeDefined();
    expect(stats.scoreDistribution.length).toBe(10); // 10 buckets: 0-9, 10-19, ... 90-100
  });

  it('handles empty correlated array gracefully', () => {
    const stats = computeStats([], []);
    expect(stats.totalPassed).toBe(0);
    expect(stats.profitableCount).toBe(0);
    expect(stats.netPnl).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// formatScoreDistribution
// ---------------------------------------------------------------------------

describe('formatScoreDistribution', () => {
  it('creates histogram buckets', () => {
    const dist = [
      { range: '0-9', count: 1 },
      { range: '10-19', count: 0 },
      { range: '20-29', count: 0 },
      { range: '30-39', count: 0 },
      { range: '40-49', count: 1 },
      { range: '50-59', count: 0 },
      { range: '60-69', count: 0 },
      { range: '70-79', count: 0 },
      { range: '80-89', count: 1 },
      { range: '90-100', count: 1 },
    ];

    const output = formatScoreDistribution(dist);
    expect(output).toContain('0-9');
    expect(output).toContain('90-100');
    expect(typeof output).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// generateReport
// ---------------------------------------------------------------------------

describe('generateReport', () => {
  it('produces Markdown with required sections', () => {
    const stats = computeStats([
      { trade: makeTradeRow({ pnl_sol: 0.05 }), decision: makeSafetyLog({ decision: 'PASSED' }), profitable: true },
      { trade: makeTradeRow({ pnl_sol: -0.02 }), decision: makeSafetyLog({ decision: 'PASSED' }), profitable: false },
    ], []);

    const report = generateReport(stats);
    expect(report).toContain('# Safety Pipeline Audit Report');
    expect(report).toContain('## Summary');
    expect(report).toContain('## Trade Outcomes');
    expect(report).toContain('## Per-Check Accuracy');
    expect(report).toContain('## Score Distribution');
    expect(report).toContain('## Recommendations');
  });
});

// ---------------------------------------------------------------------------
// sampleRejectedMints
// ---------------------------------------------------------------------------

describe('sampleRejectedMints', () => {
  it('returns up to count rejected mints', () => {
    const decisions = [
      makeSafetyLog({ decision: 'REJECTED', mint: 'Rej1' }),
      makeSafetyLog({ decision: 'REJECTED', mint: 'Rej2' }),
      makeSafetyLog({ decision: 'PASSED', mint: 'Pass1' }),
      makeSafetyLog({ decision: 'REJECTED', mint: 'Rej3' }),
    ];

    const sample = sampleRejectedMints(decisions, 2);
    expect(sample.length).toBeLessThanOrEqual(2);
    // All sampled mints should be from rejected decisions
    for (const mint of sample) {
      expect(['Rej1', 'Rej2', 'Rej3']).toContain(mint);
    }
  });

  it('returns all rejected mints when fewer than count', () => {
    const decisions = [
      makeSafetyLog({ decision: 'REJECTED', mint: 'Rej1' }),
    ];

    const sample = sampleRejectedMints(decisions, 50);
    expect(sample).toEqual(['Rej1']);
  });
});
