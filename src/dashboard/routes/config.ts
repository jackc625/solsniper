import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { TradingConfigSchema, getRuntimeConfig, patchRuntimeConfig, restoreRuntimeConfig } from '../../config/trading.js';
import type { TradingConfig } from '../../config/trading.js';
import { botEventBus } from '../bot-event-bus.js';
import { createModuleLogger } from '../../core/logger.js';

const log = createModuleLogger('config-route');

// Partial update schema -- only fields the dashboard Settings tab can change.
// Uses .optional() so the POST body may include any subset.
const ConfigPatchSchema = z.object({
  dryRun:                  z.boolean().optional(),  // Phase 12: dry-run toggle
  minSafetyScore:          z.number().int().min(0).max(100).optional(),
  buyAmountSol:            z.number().positive().max(10).optional(),
  maxConcurrentPositions:  z.number().int().min(1).max(50).optional(),
  maxSlippageBps:          z.number().int().min(50).max(4900).optional(),
  stopLossPct:             z.number().negative().optional(),      // legacy top-level field
  takeProfitPct:           z.number().positive().optional(),
  positionManagement: z.object({
    stopLossPct:       z.number().negative().optional(),
    trailingStopPct:   z.number().min(0).max(100).optional(),
    maxHoldTimeMs:     z.number().int().min(0).optional(),
    pollIntervalMs:    z.number().int().positive().min(1000).max(60000).optional(),
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
  execution: z.object({
    buy: z.object({
      slippageBps: z.number().int().min(50).max(4900).optional(),
    }).optional(),
  }).optional(),
});

function formatZodErrors(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.join('.');
    return path ? `${path}: ${issue.message}` : issue.message;
  });
}

function validateSemantics(config: TradingConfig): string[] {
  const errors: string[] = [];

  // Tiered TP percentages must sum to <= 100
  const tpSum = config.positionManagement.tieredTp.reduce((s, t) => s + t.pct, 0);
  if (tpSum > 100) {
    errors.push(`Tiered TP percentages sum to ${tpSum}%, must be <= 100%`);
  }

  // Safety weights should sum to 100 (weighted average expectation)
  const { rugCheck, holder, creator } = config.safety.weights;
  const weightSum = rugCheck + holder + creator;
  if (weightSum !== 100) {
    errors.push(`Safety weights sum to ${weightSum}, must equal 100`);
  }

  return errors;
}

export async function configRoute(fastify: FastifyInstance): Promise<void> {
  // GET /api/config -- return current runtime config
  fastify.get('/config', async (_request, reply) => {
    return reply.send(getRuntimeConfig());
  });

  // POST /api/config -- apply partial updates with 3-layer validation
  // Layer 1: Patch shape validation (ConfigPatchSchema)
  // Layer 2: Merged result validation (TradingConfigSchema)
  // Layer 3: Cross-field semantic checks (validateSemantics)
  // Changes are in-memory only -- restart reverts to config file values (CONTEXT.md constraint)
  fastify.post('/config', async (request, reply) => {
    // Layer 1: Validate patch body shape
    const patchResult = ConfigPatchSchema.safeParse(request.body);
    if (!patchResult.success) {
      return reply.code(400).send({
        error: 'Validation failed',
        details: formatZodErrors(patchResult.error),
      });
    }

    // Snapshot for rollback (deep clone to avoid reference issues --
    // getRuntimeConfig() returns a reference that patchRuntimeConfig() mutates)
    const snapshot = structuredClone(getRuntimeConfig());

    // Apply patch (mutates _runtimeConfig)
    const merged = patchRuntimeConfig(patchResult.data as Parameters<typeof patchRuntimeConfig>[0]);

    // Layer 2: Validate merged result against full schema
    const mergedResult = TradingConfigSchema.safeParse(merged);
    if (!mergedResult.success) {
      restoreRuntimeConfig(snapshot);
      return reply.code(400).send({
        error: 'Merged config invalid',
        details: formatZodErrors(mergedResult.error),
      });
    }

    // Layer 3: Cross-field semantic checks
    const semanticErrors = validateSemantics(mergedResult.data);
    if (semanticErrors.length > 0) {
      restoreRuntimeConfig(snapshot);
      return reply.code(400).send({
        error: 'Semantic validation failed',
        details: semanticErrors,
      });
    }

    // Success -- determine what actually changed
    const changedKeys = Object.keys(patchResult.data).filter(
      (k) => JSON.stringify((snapshot as Record<string, unknown>)[k]) !== JSON.stringify((merged as Record<string, unknown>)[k]),
    );
    if (changedKeys.length > 0) {
      botEventBus.emit('event', {
        type: 'CONFIG_CHANGED',
        mint: '',
        ts: Date.now(),
        detail: `Settings updated: ${changedKeys.join(', ')}`,
      });
    }
    log.info({ changedKeys }, 'Runtime config patched via dashboard');
    return reply.send({ ok: true, config: merged });
  });
}
