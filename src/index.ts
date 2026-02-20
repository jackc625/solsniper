// IMPORTANT: env.ts must be imported first — it loads dotenv and validates all
// required environment variables. If validation fails, process.exit(1) is called
// before any other code runs.
import { env } from './config/env.js';
import { tradingConfig } from './config/trading.js';
import { logger, createModuleLogger } from './core/logger.js';
import { RpcManager } from './core/rpc-manager.js';
import { getWalletPublicKey } from './utils/wallet.js';

const log = createModuleLogger('main');

let isShuttingDown = false;

async function shutdown(signal: string, rpcManager: RpcManager): Promise<void> {
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

    // 2. Phase 2+: close WebSocket listeners
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

  // 5. Register shutdown handlers
  const handler = (signal: string) => { shutdown(signal, rpcManager); };
  process.on('SIGTERM', () => handler('SIGTERM'));
  process.on('SIGINT', () => handler('SIGINT'));

  log.info('SolSniper ready — waiting for Phase 2 (detection) to be implemented');
  // Phase 2+: start detection listeners, position monitor, etc.
}

main().catch((err) => {
  log.fatal({ err }, 'Fatal startup error');
  process.exit(1);
});
