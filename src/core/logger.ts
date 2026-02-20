import pino from 'pino';
import { env } from '../config/env.js';

const isDev = env.NODE_ENV === 'development';

/**
 * Custom serializer that strips sensitive keys from any logged object.
 * Belt-and-suspenders protection: if anyone accidentally passes an object
 * containing PRIVATE_KEY or SECRET fields, those values are redacted.
 */
function sanitizeObject(obj: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const upperKey = key.toUpperCase();
    if (upperKey.includes('PRIVATE_KEY') || upperKey.includes('SECRET')) {
      sanitized[key] = '[REDACTED]';
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

export const logger = pino({
  level: env.LOG_LEVEL,
  transport: isDev
    ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard' } }
    : undefined,
  serializers: {
    // Strip sensitive keys from any object logged under the 'env' key
    env: (envObj: Record<string, unknown>) => ({
      NODE_ENV: envObj['NODE_ENV'],
      LOG_LEVEL: envObj['LOG_LEVEL'],
    }),
    // Generic sanitizer for any object that might contain sensitive fields
    config: (configObj: Record<string, unknown>) => sanitizeObject(configObj),
  },
});

/**
 * Creates a child logger bound to a specific module.
 * Every log line will include { module } in the structured output.
 *
 * Usage: const log = createModuleLogger('rpc-manager');
 */
export function createModuleLogger(module: string): pino.Logger {
  return logger.child({ module });
}

/**
 * Creates a child logger bound to a specific trade ID.
 * Every log line will include { tradeId } in the structured output,
 * enabling easy filtering of all logs for a given trade.
 *
 * Usage: const log = createTradeLogger(tradeId, 'execution');
 */
export function createTradeLogger(tradeId: string, module?: string): pino.Logger {
  return logger.child({ tradeId, ...(module ? { module } : {}) });
}

/**
 * Wraps an async operation with latency logging.
 * Logs latencyMs on both success (debug) and failure (error).
 * Always logs — no threshold gate — so latency data is complete.
 *
 * Usage: await withLatency(log, 'safety_check', () => runSafetyChecks(mint));
 */
export async function withLatency<T>(
  log: pino.Logger,
  operation: string,
  fn: () => Promise<T>
): Promise<T> {
  const start = Date.now();
  try {
    const result = await fn();
    log.debug({ operation, latencyMs: Date.now() - start }, `${operation} completed`);
    return result;
  } catch (err) {
    log.error({ operation, latencyMs: Date.now() - start, err }, `${operation} failed`);
    throw err;
  }
}
