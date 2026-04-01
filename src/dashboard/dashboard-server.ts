import Fastify, { type FastifyInstance } from 'fastify';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import { createRequire } from 'node:module';
const _require = createRequire(import.meta.url);
// @fastify/sse CJS module -- use createRequire for reliable ESM interop with Fastify 5
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any
const fastifySSE = _require('@fastify/sse') as any;
import fastifyStatic from '@fastify/static';
import fastifyCors from '@fastify/cors';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { env } from '../config/env.js';
import { apiKeyAuth } from './auth.js';
import { eventsRoute } from './routes/events.js';
import { tradesRoute } from './routes/trades.js';
import { configRoute } from './routes/config.js';
import { healthRoute } from './routes/health.js';
import { alertsRoute } from './routes/alerts.js';
import { metricsRoute } from './routes/metrics.js';
import { controlsRoute } from './routes/controls.js';
import type { TradeStore } from '../persistence/trade-store.js';
import type { HealthService } from '../monitoring/health-service.js';
import type { AlertStore } from '../monitoring/alert-store.js';
import type { MetricsTracker } from '../monitoring/metrics-tracker.js';
import { createModuleLogger } from '../core/logger.js';

const log = createModuleLogger('dashboard');

export async function createDashboardServer(
  tradeStore: TradeStore,
  healthService: HealthService,
  alertStore: AlertStore,
  metricsTracker: MetricsTracker,
  controlsOpts: {
    getDetectionPaused: () => boolean;
    setDetectionPaused: (paused: boolean) => void;
    isSellInFlight: (mint: string) => boolean;
    triggerSell: (mint: string, tokenAmount: bigint) => void;
  },
): Promise<FastifyInstance> {
  const fastify = Fastify({
    logger: false,                  // Use bot's pino logger -- avoid duplicate log streams
    forceCloseConnections: 'idle',  // Close idle keep-alive on shutdown
    return503OnClosing: true,       // Return 503 to new requests during drain
  });

  // CORS: allow Vite dev server in development only
  await fastify.register(fastifyCors, {
    origin: env.NODE_ENV === 'development'
      ? ['http://localhost:5173', 'http://127.0.0.1:5173']
      : false,
    methods: ['GET', 'POST'],
  });

  // SSE plugin -- must register before SSE routes
  await fastify.register(fastifySSE);

  // Serve pre-built SPA from dashboard/dist/
  // Use fileURLToPath + dirname for Node16 module resolution compatibility
  const distPath = join(dirname(fileURLToPath(import.meta.url)), '../../dashboard/dist');
  await fastify.register(fastifyStatic, {
    root: distPath,
    prefix: '/',
    decorateReply: true,
  });

  // Global API key auth hook (no-op if DASHBOARD_API_KEY not set)
  fastify.addHook('onRequest', apiKeyAuth);

  // API routes
  await fastify.register(eventsRoute);
  await fastify.register(tradesRoute, { tradeStore, prefix: '/api' });
  await fastify.register(configRoute, { prefix: '/api' });
  await fastify.register(healthRoute, { healthService, prefix: '/api' });
  await fastify.register(alertsRoute, { alertStore, prefix: '/api' });
  await fastify.register(metricsRoute, { metricsTracker, prefix: '/api' });
  await fastify.register(controlsRoute, { ...controlsOpts, tradeStore, prefix: '/api' });

  // SPA fallback -- serve index.html for all non-asset, non-API GET requests
  // Required because tab-based UI uses only '/' but direct URL access still needs fallback
  fastify.setNotFoundHandler(async (request, reply) => {
    if (request.method === 'GET' && !request.url.startsWith('/api') && !request.url.startsWith('/events')) {
      try {
        return reply.sendFile('index.html');
      } catch {
        // dist/ not built yet (dev mode without frontend build) -- return helpful error
        return reply.code(404).send({ error: 'Dashboard not built -- run: pnpm build:dashboard' });
      }
    }
    return reply.code(404).send({ error: 'Not found' });
  });

  log.info({ port: env.DASHBOARD_PORT }, 'Dashboard server created');
  return fastify;
}
