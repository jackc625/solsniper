import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import type { TradeStore } from '../../persistence/trade-store.js';
import type { Trade } from '../../types/index.js';
import { getRuntimeConfig } from '../../config/trading.js';
import type BetterSqlite3 from 'better-sqlite3';

interface TradesPluginOptions extends FastifyPluginOptions {
  tradeStore: TradeStore;
}

export async function tradesRoute(fastify: FastifyInstance, opts: TradesPluginOptions): Promise<void> {
  const { tradeStore } = opts;

  // GET /api/trades -- active MONITORING positions with entry P&L
  fastify.get('/trades', async (_request, reply) => {
    const trades: Trade[] = tradeStore.getMonitoringTrades();
    const config = getRuntimeConfig();

    const enriched = trades.map((t) => {
      const entryPriceSol = t.buyPriceSol ?? t.amountSol;
      // last-known price from TradeStore (no live Jupiter calls from dashboard -- avoids rate pressure)
      // sellPriceSol is null for MONITORING; use amountSol as entry reference
      return {
        ...t,
        entryPriceSol,
        stopLossTarget: entryPriceSol != null
          ? entryPriceSol * (1 + config.positionManagement.stopLossPct / 100)
          : null,
        takeProfitTarget: entryPriceSol != null
          ? entryPriceSol * (config.positionManagement.tieredTp[0]?.at ?? 2)
          : null,
      };
    });

    return reply.send(enriched);
  });

  // GET /api/trades/history -- completed/failed trades with P&L data (for Performance view)
  fastify.get('/trades/history', async (_request, reply) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = (tradeStore as any).db as BetterSqlite3.Database;
    const rows = db.prepare(`
      SELECT id, mint, state, source, amount_sol, buy_price_sol, sell_price_sol,
             created_at, updated_at, dry_run,
             CASE WHEN sell_price_sol IS NOT NULL AND amount_sol IS NOT NULL
                  THEN sell_price_sol - amount_sol ELSE NULL END as pnl_sol
      FROM trades
      WHERE state IN ('COMPLETED', 'FAILED', 'ABANDONED')
        AND (dry_run IS NULL OR dry_run = 0)
      ORDER BY updated_at DESC
      LIMIT 500
    `).all();
    return reply.send(rows);
  });

  // GET /api/stats -- portfolio summary
  fastify.get('/stats', async (_request, reply) => {
    const monitoring = tradeStore.getMonitoringTrades();
    const selling = tradeStore.getSellingTrades();
    const buying = tradeStore.getBuyingTrades();

    // Access raw DB for completed/failed counts -- TradeStore exposes db privately.
    // Type-cast to access it for read-only stats query (no writes from dashboard).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = (tradeStore as any).db as BetterSqlite3.Database;
    const completedRow = db.prepare(
      `SELECT
         COUNT(*) as total,
         SUM(CASE WHEN state = 'COMPLETED' THEN 1 ELSE 0 END) as completed,
         SUM(CASE WHEN state = 'FAILED' OR state = 'ABANDONED' THEN 1 ELSE 0 END) as failed,
         SUM(CASE WHEN sell_price_sol IS NOT NULL AND amount_sol IS NOT NULL
                  THEN sell_price_sol - amount_sol ELSE 0 END) as total_pnl_sol,
         SUM(CASE WHEN state = 'COMPLETED' AND sell_price_sol IS NOT NULL
                  AND sell_price_sol - amount_sol > 0 THEN 1 ELSE 0 END) as wins,
         SUM(CASE WHEN sell_price_sol IS NOT NULL THEN 1 ELSE 0 END) as total_with_pnl
       FROM trades WHERE state IN ('COMPLETED','FAILED','ABANDONED')
         AND (dry_run IS NULL OR dry_run = 0)`
    ).get() as { total: number; completed: number; failed: number; total_pnl_sol: number; wins: number; total_with_pnl: number };

    // Win rate: wins (positive P&L) / total_with_pnl (trades that have sell price data).
    // Excludes legacy trades with NULL sell_price_sol from both numerator and denominator.
    const winRate = completedRow.total_with_pnl > 0
      ? Math.round((completedRow.wins / completedRow.total_with_pnl) * 100)
      : 0;

    return reply.send({
      openPositions: monitoring.length,
      activeSells: selling.length,
      pendingBuys: buying.length,
      totalTrades: completedRow.total,
      completedTrades: completedRow.completed,
      failedTrades: completedRow.failed,
      winRate,                                           // percentage 0-100
      totalPnlSol: completedRow.total_pnl_sol ?? 0,     // realized P&L in SOL
    });
  });
}
