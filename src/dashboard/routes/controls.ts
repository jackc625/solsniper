import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import type { TradeStore } from '../../persistence/trade-store.js';
import { createModuleLogger } from '../../core/logger.js';

const log = createModuleLogger('controls-route');

interface ControlsPluginOptions extends FastifyPluginOptions {
  tradeStore: TradeStore;
  getDetectionPaused: () => boolean;
  setDetectionPaused: (paused: boolean) => void;
  isSellInFlight: (mint: string) => boolean;
  triggerSell: (mint: string, tokenAmount: bigint) => void;
}

export async function controlsRoute(
  fastify: FastifyInstance,
  opts: ControlsPluginOptions,
): Promise<void> {

  // GET /api/controls/status -- current detection state
  fastify.get('/controls/status', async (_request, reply) => {
    return reply.send({ paused: opts.getDetectionPaused() });
  });

  // POST /api/controls/detection -- pause/resume detection (D-12)
  fastify.post('/controls/detection', async (request, reply) => {
    const body = request.body as { paused?: boolean } | null;
    if (body === null || typeof body?.paused !== 'boolean') {
      return reply.code(400).send({ error: 'Body must include { paused: boolean }' });
    }
    opts.setDetectionPaused(body.paused);
    log.info({ paused: body.paused }, 'Detection state changed via controls API');
    return reply.send({ ok: true, paused: body.paused });
  });

  // POST /api/trades/:id/force-sell -- force sell a specific position (D-11, D-14)
  fastify.post('/trades/:id/force-sell', async (request, reply) => {
    const { id } = request.params as { id: string };
    const tradeId = parseInt(id, 10);
    if (isNaN(tradeId)) {
      return reply.code(400).send({ error: 'Invalid trade ID' });
    }

    // Look up trade by ID
    const trade = opts.tradeStore.getTradeById(tradeId);
    if (!trade) {
      return reply.code(404).send({ error: 'Trade not found' });
    }

    // Only MONITORING trades can be force-sold
    if (trade.state !== 'MONITORING') {
      return reply.code(400).send({ error: 'Trade is not in MONITORING state' });
    }

    // D-14: Check sellsInFlight to prevent double-sell race condition
    if (opts.isSellInFlight(trade.mint)) {
      return reply.code(409).send({ error: 'Position is already being sold' });
    }

    // Trigger sell via callback (fires SellLadder.sell asynchronously)
    const tokenAmount = BigInt(trade.amountTokens ?? 0);
    try {
      opts.triggerSell(trade.mint, tokenAmount);
      log.info({ tradeId, mint: trade.mint }, 'Force sell triggered via controls API');
      return reply.send({ ok: true, tradeId, mint: trade.mint });
    } catch (err) {
      log.error({ err, tradeId, mint: trade.mint }, 'Force sell trigger failed');
      return reply.code(500).send({ error: 'Force sell failed -- check bot logs for details' });
    }
  });

  // POST /api/controls/emergency-stop -- pause detection + force-sell all (D-13)
  fastify.post('/controls/emergency-stop', async (_request, reply) => {
    // Step 1: Pause detection FIRST (synchronous flag flip per Pitfall 3)
    opts.setDetectionPaused(true);
    log.warn('Emergency stop activated -- detection paused');

    // Step 2: Get all MONITORING trades and fire force-sell for each
    const monitoringTrades = opts.tradeStore.getMonitoringTrades();
    const sellResults: Array<{ tradeId: number; mint: string; status: string }> = [];

    for (const trade of monitoringTrades) {
      if (opts.isSellInFlight(trade.mint)) {
        sellResults.push({ tradeId: trade.id, mint: trade.mint, status: 'already_selling' });
        continue;
      }
      try {
        const tokenAmount = BigInt(trade.amountTokens ?? 0);
        opts.triggerSell(trade.mint, tokenAmount);
        sellResults.push({ tradeId: trade.id, mint: trade.mint, status: 'triggered' });
      } catch {
        sellResults.push({ tradeId: trade.id, mint: trade.mint, status: 'failed' });
      }
    }

    log.warn({ sellResults }, 'Emergency stop sell results');
    return reply.send({ paused: true, sellResults });
  });
}
