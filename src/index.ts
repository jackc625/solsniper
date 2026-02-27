// IMPORTANT: env.ts must be imported first — it loads dotenv and validates all
// required environment variables. If validation fails, process.exit(1) is called
// before any other code runs.
import { env } from './config/env.js';
import { tradingConfig } from './config/trading.js';
import { logger, createModuleLogger } from './core/logger.js';
import { RpcManager } from './core/rpc-manager.js';
import { DetectionManager } from './detection/detection-manager.js';
import { SafetyPipeline } from './safety/safety-pipeline.js';
import { getWalletPublicKey } from './utils/wallet.js';

const log = createModuleLogger('main');

let isShuttingDown = false;

async function shutdown(
  signal: string,
  rpcManager: RpcManager,
  detectionManager: DetectionManager
): Promise<void> {
  if (isShuttingDown) return; // Prevent double-shutdown
  isShuttingDown = true;

  log.info({ signal }, 'Shutdown signal received');

  const timeout = setTimeout(() => {
    log.warn('Graceful shutdown timed out after 5s — forcing exit');
    process.exit(1);
  }, 5000);
  timeout.unref();

  try {
    // 1. Close RPC health check timers
    rpcManager.close();

    // 2. Close detection listeners (WebSocket + onLogs subscriptions)
    await detectionManager.stop();

    // 3. Phase 4+: flush SQLite writes

    // 4. Flush pino logger (ensures buffered logs written)
    log.info('Shutdown complete');
    await new Promise<void>((resolve) => logger.flush(() => resolve()));
  } finally {
    clearTimeout(timeout);
    process.exit(0);
  }
}

async function main(): Promise<void> {
  log.info({ nodeEnv: env.NODE_ENV, logLevel: env.LOG_LEVEL }, 'SolSniper starting');

  // 1. Load wallet (validates private key)
  const publicKey = getWalletPublicKey();
  log.info({ publicKey }, 'Wallet loaded');

  // 2. Initialize RPC manager
  const rpcManager = new RpcManager(
    env.SOLSNIPER_RPC_URL,
    env.SOLSNIPER_RPC_BACKUP_URL
  );

  // 3. Log RPC manager events
  rpcManager.on('failover', (data) => log.warn(data, 'RPC failover triggered'));
  rpcManager.on('recovered', (data) => log.info(data, 'RPC primary recovered'));
  rpcManager.on('degraded', (data) => log.debug(data, 'RPC degraded'));

  // 4. Log trading config (safe — no secrets)
  log.info({ tradingConfig }, 'Trading configuration loaded');

  // 5. Initialize detection manager
  const detectionManager = new DetectionManager(env, tradingConfig, rpcManager.getConnection());
  detectionManager.start();
  log.info('Detection manager started');

  // 5.5. Initialize safety pipeline
  const safetyPipeline = new SafetyPipeline(rpcManager.getConnection(), tradingConfig, env);
  log.info('Safety pipeline initialized');

  // 6. Wire token events through safety pipeline
  detectionManager.on('token', async (event) => {
    try {
      const result = await safetyPipeline.evaluate(event);
      if (result.pass) {
        // Phase 5+: pass to execution engine
        log.debug({ mint: event.mint, score: result.aggregateScore }, 'Token approved — awaiting execution engine (Phase 5)');
      }
      // Rejections already logged by SafetyPipeline with full detail
    } catch (err) {
      log.error({ err, mint: event.mint }, 'Safety pipeline error');
    }
  });

  // 7. Register shutdown handlers (WebSocket and onLogs keep event loop alive — no keepalive needed)
  const handler = (signal: string) => { void shutdown(signal, rpcManager, detectionManager); };
  process.on('SIGTERM', () => handler('SIGTERM'));
  process.on('SIGINT', () => handler('SIGINT'));
}

main().catch((err) => {
  log.fatal({ err }, 'Fatal startup error');
  process.exit(1);
});
