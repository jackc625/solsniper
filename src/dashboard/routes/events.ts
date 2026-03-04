import type { FastifyInstance } from 'fastify';
// Import @fastify/sse types to apply the 'declare module fastify' augmentation
// that adds reply.sse and the sse route option to Fastify's type declarations.
import type {} from '@fastify/sse';
import { botEventBus, type BotEvent } from '../bot-event-bus.js';

export async function eventsRoute(fastify: FastifyInstance): Promise<void> {
  fastify.get('/events', { sse: true }, async (_request, reply) => {
    // Force SSE headers to be sent immediately so Fastify sees reply.raw.headersSent === true
    // and doesn't close the connection when the handler returns.
    reply.sse.sendHeaders();

    // Keep the SSE connection open indefinitely
    reply.sse.keepAlive();

    // Register listener for this client
    const sendEvent = (event: BotEvent): void => {
      if (reply.sse.isConnected) {
        void reply.sse.send({
          event: event.type,
          data: event,
        });
      }
    };

    botEventBus.on('event', sendEvent);

    // Clean up when client disconnects — prevents listener leak
    reply.sse.onClose(() => {
      botEventBus.off('event', sendEvent);
    });
  });
}
