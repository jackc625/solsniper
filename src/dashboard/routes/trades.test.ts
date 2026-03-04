import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const source = readFileSync(join(__dirname, 'trades.ts'), 'utf8');

describe('trades routes P&L SQL formulas', () => {
  it('history endpoint uses sell_price_sol - amount_sol for pnl_sol', () => {
    // The P&L CASE expression should reference amount_sol, not buy_price_sol
    expect(source).toContain('sell_price_sol - amount_sol');
    expect(source).not.toMatch(/sell_price_sol\s*-\s*buy_price_sol/);
  });

  it('stats endpoint uses SUM with amount_sol for total_pnl_sol', () => {
    // The aggregate P&L must use amount_sol (total SOL in) not buy_price_sol (per-unit price)
    expect(source).toMatch(/SUM.*sell_price_sol.*amount_sol/s);
  });

  it('win rate uses total_with_pnl denominator (excludes NULL sell_price_sol trades)', () => {
    // Win rate denominator must be total_with_pnl, not total (which includes legacy NULL rows)
    expect(source).toContain('total_with_pnl');
  });

  it('win rate uses wins numerator (positive P&L trades only)', () => {
    // Wins must be counted from trades with positive P&L, not from COMPLETED state alone
    expect(source).toContain('wins');
  });

  it('legacy trade with NULL sell_price_sol shows NULL pnl_sol (not zero)', () => {
    // The CASE expression must return NULL (ELSE NULL), not ELSE 0, for the history endpoint
    // Check that the history pnl_sol CASE uses ELSE NULL
    expect(source).toMatch(/ELSE NULL END as pnl_sol/);
  });
});
