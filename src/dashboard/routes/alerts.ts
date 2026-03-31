import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import type { AlertStore } from '../../monitoring/alert-store.js';

interface AlertsPluginOptions extends FastifyPluginOptions {
  alertStore: AlertStore;
}

export async function alertsRoute(fastify: FastifyInstance, opts: AlertsPluginOptions): Promise<void> {
  fastify.get('/alerts', async (request, reply) => {
    const { page = '1', limit = '50' } = request.query as Record<string, string>;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
    const result = opts.alertStore.query({ page: pageNum, limit: limitNum });
    return reply.send(result);
  });
}
