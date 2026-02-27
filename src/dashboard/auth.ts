import type { FastifyRequest, FastifyReply } from 'fastify';
import { env } from '../config/env.js';

/**
 * Fastify onRequest hook for API key authentication.
 * Auth is disabled if DASHBOARD_API_KEY is not set in .env.
 * Client must pass the key in the 'x-dashboard-key' header.
 */
export async function apiKeyAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!env.DASHBOARD_API_KEY) return; // Auth disabled — no key configured
  const key = request.headers['x-dashboard-key'];
  if (key !== env.DASHBOARD_API_KEY) {
    await reply.code(401).send({ error: 'Unauthorized' });
  }
}
