import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getRuntimeConfig, patchRuntimeConfig } from '../../config/trading.js';

// Partial update schema — only fields the dashboard Settings tab can change.
// Uses .optional() so the POST body may include any subset.
const ConfigPatchSchema = z.object({
  minSafetyScore:          z.number().int().min(0).max(100).optional(),
  buyAmountSol:            z.number().positive().max(10).optional(),
  maxConcurrentPositions:  z.number().int().min(1).max(50).optional(),
  maxSlippageBps:          z.number().int().min(50).max(4900).optional(),
  stopLossPct:             z.number().negative().optional(),      // legacy top-level field
  takeProfitPct:           z.number().positive().optional(),
  positionManagement: z.object({
    stopLossPct:       z.number().negative().optional(),
    trailingStopPct:   z.number().min(0).max(100).optional(),
    tieredTp: z.array(z.object({
      at:  z.number().positive(),
      pct: z.number().int().min(1).max(100),
    })).optional(),
  }).optional(),
  safety: z.object({
    weights: z.object({
      rugCheck: z.number().int().min(0).max(100).optional(),
      holder:   z.number().int().min(0).max(100).optional(),
      creator:  z.number().int().min(0).max(100).optional(),
    }).optional(),
  }).optional(),
});

export async function configRoute(fastify: FastifyInstance): Promise<void> {
  // GET /api/config — return current runtime config
  fastify.get('/config', async (_request, reply) => {
    return reply.send(getRuntimeConfig());
  });

  // POST /api/config — apply partial updates atomically
  // Changes are in-memory only — restart reverts to config file values (CONTEXT.md constraint)
  fastify.post('/config', async (request, reply) => {
    const result = ConfigPatchSchema.safeParse(request.body);
    if (!result.success) {
      return reply.code(400).send({
        error: 'Validation failed',
        details: result.error.flatten(),
      });
    }
    const updated = patchRuntimeConfig(result.data as Parameters<typeof patchRuntimeConfig>[0]);
    return reply.send({ ok: true, config: updated });
  });
}
