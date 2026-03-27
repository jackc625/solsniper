import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import { configRoute } from './config.js';
import { getRuntimeConfig, restoreRuntimeConfig } from '../../config/trading.js';
import type { TradingConfig } from '../../config/trading.js';

describe('config route validation', () => {
  let app: ReturnType<typeof Fastify>;
  let originalConfig: TradingConfig;

  beforeEach(async () => {
    originalConfig = structuredClone(getRuntimeConfig());
    app = Fastify();
    await app.register(configRoute, { prefix: '/api' });
    await app.ready();
  });

  afterEach(async () => {
    restoreRuntimeConfig(originalConfig);
    await app.close();
  });

  it('valid partial update returns 200 with updated config', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/config',
      payload: { buyAmountSol: 0.5 },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.ok).toBe(true);
    expect(body.config.buyAmountSol).toBe(0.5);
  });

  it('invalid shape (wrong type) returns 400 with human-friendly errors', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/config',
      payload: { buyAmountSol: 'not_a_number' },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.error).toBe('Validation failed');
    expect(Array.isArray(body.details)).toBe(true);
    // Details should be strings (not Zod objects)
    expect(typeof body.details[0]).toBe('string');
    expect(body.details.some((d: string) => d.includes('buyAmountSol'))).toBe(true);
  });

  it('safety weights summing to != 100 returns 400 semantic error', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/config',
      payload: { safety: { weights: { rugCheck: 80, holder: 80, creator: 80 } } },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.error).toBe('Semantic validation failed');
    expect(body.details.some((d: string) => d.includes('Safety weights sum to 240'))).toBe(true);
  });

  it('tiered TP percentages summing to > 100% returns 400 semantic error', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/config',
      payload: {
        positionManagement: {
          tieredTp: [
            { at: 2, pct: 60 },
            { at: 5, pct: 60 },
          ],
        },
      },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.error).toBe('Semantic validation failed');
    expect(body.details.some((d: string) => d.includes('Tiered TP percentages sum to 120%'))).toBe(true);
  });

  it('rollback restores pre-patch config after semantic rejection', async () => {
    const beforeWeights = structuredClone(getRuntimeConfig().safety.weights);

    // Send invalid safety weights patch
    const response = await app.inject({
      method: 'POST',
      url: '/api/config',
      payload: { safety: { weights: { rugCheck: 80, holder: 80, creator: 80 } } },
    });

    expect(response.statusCode).toBe(400);

    // Verify rollback -- config should be unchanged
    const afterWeights = getRuntimeConfig().safety.weights;
    expect(afterWeights.rugCheck).toBe(beforeWeights.rugCheck);
    expect(afterWeights.holder).toBe(beforeWeights.holder);
    expect(afterWeights.creator).toBe(beforeWeights.creator);
  });

  it('unknown keys are silently stripped (Zod 4 default)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/config',
      payload: { buyAmountSol: 0.5, unknownField: 'should_be_stripped' },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.ok).toBe(true);
    expect(body.config).not.toHaveProperty('unknownField');
  });

  it('error details are human-friendly strings (path: message format)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/config',
      payload: { buyAmountSol: -1 },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(Array.isArray(body.details)).toBe(true);
    // Each detail should be a string in "path: message" format
    for (const detail of body.details) {
      expect(typeof detail).toBe('string');
    }
    // buyAmountSol: -1 violates .positive(), so error path should include 'buyAmountSol'
    expect(body.details.some((d: string) => d.includes('buyAmountSol'))).toBe(true);
  });
});
