import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import type { MetricsTracker } from '../../monitoring/metrics-tracker.js';

interface MetricsPluginOptions extends FastifyPluginOptions {
  metricsTracker: MetricsTracker;
}

export async function metricsRoute(fastify: FastifyInstance, opts: MetricsPluginOptions): Promise<void> {
  fastify.get('/metrics', async (_request, reply) => {
    const endpoints = opts.metricsTracker.getAllStats();
    return reply.send({ endpoints, windowMs: 300_000 });
  });
}
