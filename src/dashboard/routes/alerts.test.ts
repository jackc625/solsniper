import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import { alertsRoute } from './alerts.js';
import type { AlertQueryResult } from '../../monitoring/alert-store.js';

function createMockAlertStore(result: AlertQueryResult) {
  return { query: vi.fn(() => result) };
}

describe('GET /api/alerts', () => {
  it('calls alertStore.query with default page=1 limit=50 when no query params', async () => {
    const queryResult: AlertQueryResult = { alerts: [], total: 0, page: 1, limit: 50 };
    const alertStore = createMockAlertStore(queryResult);
    const fastify = Fastify();
    await fastify.register(alertsRoute, { alertStore, prefix: '/api' });

    const res = await fastify.inject({ method: 'GET', url: '/api/alerts' });
    expect(res.statusCode).toBe(200);
    expect(alertStore.query).toHaveBeenCalledWith({ page: 1, limit: 50 });
  });

  it('passes custom page and limit from query params', async () => {
    const queryResult: AlertQueryResult = { alerts: [], total: 100, page: 2, limit: 10 };
    const alertStore = createMockAlertStore(queryResult);
    const fastify = Fastify();
    await fastify.register(alertsRoute, { alertStore, prefix: '/api' });

    const res = await fastify.inject({ method: 'GET', url: '/api/alerts?page=2&limit=10' });
    expect(res.statusCode).toBe(200);
    expect(alertStore.query).toHaveBeenCalledWith({ page: 2, limit: 10 });
  });

  it('response has alerts array, total, page, limit fields', async () => {
    const alerts = [
      { id: 1, timestamp: Date.now(), type: 'component_down', severity: 'error', source: 'rpc', message: 'rpc: healthy -> down' },
    ];
    const queryResult: AlertQueryResult = { alerts, total: 1, page: 1, limit: 50 };
    const alertStore = createMockAlertStore(queryResult);
    const fastify = Fastify();
    await fastify.register(alertsRoute, { alertStore, prefix: '/api' });

    const res = await fastify.inject({ method: 'GET', url: '/api/alerts' });
    const body = JSON.parse(res.body);

    expect(body).toHaveProperty('alerts');
    expect(body).toHaveProperty('total');
    expect(body).toHaveProperty('page');
    expect(body).toHaveProperty('limit');
    expect(body.alerts).toHaveLength(1);
    expect(body.total).toBe(1);
  });

  it('caps limit at 100', async () => {
    const queryResult: AlertQueryResult = { alerts: [], total: 0, page: 1, limit: 100 };
    const alertStore = createMockAlertStore(queryResult);
    const fastify = Fastify();
    await fastify.register(alertsRoute, { alertStore, prefix: '/api' });

    const res = await fastify.inject({ method: 'GET', url: '/api/alerts?limit=999' });
    expect(res.statusCode).toBe(200);
    expect(alertStore.query).toHaveBeenCalledWith({ page: 1, limit: 100 });
  });
});
