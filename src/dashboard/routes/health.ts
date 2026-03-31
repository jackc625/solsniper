import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import type { HealthService } from '../../monitoring/health-service.js';

interface HealthPluginOptions extends FastifyPluginOptions {
  healthService: HealthService;
}

export async function healthRoute(fastify: FastifyInstance, opts: HealthPluginOptions): Promise<void> {
  fastify.get('/health', async (_request, reply) => {
    const result = opts.healthService.check();
    const httpStatus = result.status === 'down' ? 503 : 200;
    return reply.code(httpStatus).send(result);
  });
}
