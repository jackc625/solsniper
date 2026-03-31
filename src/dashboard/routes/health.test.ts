import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import { healthRoute } from './health.js';
import type { HealthCheckResult } from '../../monitoring/health-service.js';

function createMockHealthService(result: HealthCheckResult) {
  return { check: vi.fn(() => result) };
}

function makeHealthy(): HealthCheckResult {
  return {
    status: 'healthy',
    components: {
      detection: { status: 'healthy' },
      rpc: { status: 'healthy' },
      safety: { status: 'healthy' },
      execution: { status: 'healthy' },
      apis: { status: 'healthy' },
    },
    uptime: 12345,
    version: '1.0.0',
    timestamp: Date.now(),
  };
}

describe('GET /api/health', () => {
  it('returns 200 when all components are healthy', async () => {
    const healthService = createMockHealthService(makeHealthy());
    const fastify = Fastify();
    await fastify.register(healthRoute, { healthService: healthService as any, prefix: '/api' });

    const res = await fastify.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);

    const body = JSON.parse(res.body);
    expect(body.status).toBe('healthy');
    expect(body.components).toBeDefined();
    expect(body.uptime).toBeTypeOf('number');
    expect(body.version).toBe('1.0.0');
    expect(body.timestamp).toBeTypeOf('number');
    expect(healthService.check).toHaveBeenCalledOnce();
  });

  it('returns 200 when status is degraded (not down)', async () => {
    const result = makeHealthy();
    result.status = 'degraded';
    result.components.rpc = { status: 'degraded', detail: 'slow response' };
    const healthService = createMockHealthService(result);

    const fastify = Fastify();
    await fastify.register(healthRoute, { healthService: healthService as any, prefix: '/api' });

    const res = await fastify.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).status).toBe('degraded');
  });

  it('returns 503 when status is down', async () => {
    const result = makeHealthy();
    result.status = 'down';
    result.components.detection = { status: 'down', detail: 'WebSocket closed' };
    const healthService = createMockHealthService(result);

    const fastify = Fastify();
    await fastify.register(healthRoute, { healthService: healthService as any, prefix: '/api' });

    const res = await fastify.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(503);
    expect(JSON.parse(res.body).status).toBe('down');
  });

  it('response shape matches UI-SPEC contract (all fields present)', async () => {
    const healthService = createMockHealthService(makeHealthy());
    const fastify = Fastify();
    await fastify.register(healthRoute, { healthService: healthService as any, prefix: '/api' });

    const res = await fastify.inject({ method: 'GET', url: '/api/health' });
    const body = JSON.parse(res.body);

    // All required fields per UI-SPEC
    expect(body).toHaveProperty('status');
    expect(body).toHaveProperty('components');
    expect(body).toHaveProperty('uptime');
    expect(body).toHaveProperty('version');
    expect(body).toHaveProperty('timestamp');

    // Components must be an object with 5 entries per mock (detection, rpc, safety, execution, apis)
    expect(Object.keys(body.components)).toHaveLength(5);
  });
});
