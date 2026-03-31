import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import { metricsRoute } from './metrics.js';
import type { EndpointStats } from '../../monitoring/metrics-tracker.js';

function createMockMetricsTracker(stats: Record<string, EndpointStats>) {
  return { getAllStats: vi.fn(() => stats) };
}

describe('GET /api/metrics', () => {
  it('returns endpoints and windowMs=300000', async () => {
    const stats: Record<string, EndpointStats> = {
      'jupiter:quote': { p50: 120, p99: 450, errorRate: 0.02, count: 50 },
      'rpc:getBalance': { p50: 45, p99: 200, errorRate: 0, count: 100 },
    };
    const metricsTracker = createMockMetricsTracker(stats);
    const fastify = Fastify();
    await fastify.register(metricsRoute, { metricsTracker: metricsTracker as any, prefix: '/api' });

    const res = await fastify.inject({ method: 'GET', url: '/api/metrics' });
    expect(res.statusCode).toBe(200);

    const body = JSON.parse(res.body);
    expect(body).toHaveProperty('endpoints');
    expect(body).toHaveProperty('windowMs', 300_000);
    expect(body.endpoints['jupiter:quote'].p50).toBe(120);
    expect(body.endpoints['rpc:getBalance'].count).toBe(100);
    expect(metricsTracker.getAllStats).toHaveBeenCalledOnce();
  });

  it('returns empty endpoints object when no metrics recorded', async () => {
    const metricsTracker = createMockMetricsTracker({});
    const fastify = Fastify();
    await fastify.register(metricsRoute, { metricsTracker: metricsTracker as any, prefix: '/api' });

    const res = await fastify.inject({ method: 'GET', url: '/api/metrics' });
    const body = JSON.parse(res.body);

    expect(body.endpoints).toEqual({});
    expect(body.windowMs).toBe(300_000);
  });
});
