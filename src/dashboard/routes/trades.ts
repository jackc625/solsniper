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

  // GET /api/trades — active MONITORING positions with entry P&L
  fastify.get('/trades', async (_request, reply) => {
    const trades: Trade[] = tradeStore.getMonitoringTrades();
    const config = getRuntimeConfig();

    const enriched = trades.map((t) => {
      const entryPriceSol = t.buyPriceSol ?? t.amountSol;
      // last-known price from TradeStore (no live Jupiter calls from dashboard — avoids rate pressure)
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

  // GET /api/stats — portfolio summary
  fastify.get('/stats', async (_request, reply) => {
    const monitoring = tradeStore.getMonitoringTrades();
    const selling = tradeStore.getSellingTrades();
    const buying = tradeStore.getBuyingTrades();

    // Access raw DB for completed/failed counts — TradeStore exposes db privately.
    // Type-cast to access it for read-only stats query (no writes from dashboard).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = (tradeStore as any).db as BetterSqlite3.Database;
    const completedRow = db.prepare(
      `SELECT
         COUNT(*) as total,
         SUM(CASE WHEN state = 'COMPLETED' THEN 1 ELSE 0 END) as completed,
         SUM(CASE WHEN state = 'FAILED' OR state = 'ABANDONED' THEN 1 ELSE 0 END) as failed,
         SUM(CASE WHEN sell_price_sol IS NOT NULL AND buy_price_sol IS NOT NULL
                  THEN sell_price_sol - buy_price_sol ELSE 0 END) as total_pnl_sol
       FROM trades WHERE state IN ('COMPLETED','FAILED','ABANDONED')
         AND (dry_run IS NULL OR dry_run = 0)`
    ).get() as { total: number; completed: number; failed: number; total_pnl_sol: number };

    const winRate = completedRow.total > 0
      ? Math.round((completedRow.completed / completedRow.total) * 100)
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
