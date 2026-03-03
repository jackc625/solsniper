// IMPORTANT: env.ts must be imported first — it loads dotenv and validates all
// required environment variables. If validation fails, process.exit(1) is called
// before any other code runs.
import { env } from './config/env.js';
import { tradingConfig, getRuntimeConfig } from './config/trading.js';
import { logger, createModuleLogger } from './core/logger.js';
import { RpcManager } from './core/rpc-manager.js';
import { DetectionManager } from './detection/detection-manager.js';
import { SafetyPipeline } from './safety/safety-pipeline.js';
import { getWallet, getWalletPublicKey } from './utils/wallet.js';
import { ExecutionEngine } from './execution/execution-engine.js';
import { SellLadder } from './execution/sell/sell-ladder.js';
import { TradeStore } from './persistence/trade-store.js';
import { PublicKey } from '@solana/web3.js';
import { RecoveryManager } from './recovery/recovery-manager.js';
import { PositionManager } from './position/position-manager.js';
import { jupiterClient } from './execution/jupiter-client.js';
import { createDashboardServer } from './dashboard/dashboard-server.js';
import { botEventBus } from './dashboard/bot-event-bus.js';
import type { FastifyInstance } from 'fastify';

const log = createModuleLogger('main');

let isShuttingDown = false;

async function shutdown(
  signal: string,
  rpcManager: RpcManager,
  detectionManager: DetectionManager,
  tradeStore: TradeStore,
  positionManager: PositionManager,
  dashboardServer: FastifyInstance,
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
    // 0. Stop position manager polling (synchronous, clears setTimeout)
    // Must stop first — prevents new sell triggers during teardown while connections are still open
    positionManager.stop();

    // 0.5. Close dashboard HTTP server (SSE clients get 503; drains in-flight API requests)
    await dashboardServer.close();

    // 1. Close RPC health check timers
    rpcManager.close();

    // 2. Close detection listeners (WebSocket + onLogs subscriptions)
    await detectionManager.stop();

    // 3. Flush SQLite writes (TradeStore.close() is synchronous — flushes and closes)
    tradeStore.close();

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
  const walletPubKeyStr = getWalletPublicKey();
  log.info({ publicKey: walletPubKeyStr }, 'Wallet loaded');

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

  // 5. Initialize safety pipeline
  const safetyPipeline = new SafetyPipeline(rpcManager.getConnection(), tradingConfig, env);
  log.info('Safety pipeline initialized');

  // 6. Initialize trade store (write-ahead persistence layer)
  const tradeStore = new TradeStore('data/trades.db');
  log.info('TradeStore initialized');

  // 7. Load wallet keypair for execution
  const wallet = getWallet();

  // 8. Initialize execution engine (buy routing: PumpPortal vs Jupiter)
  const executionEngine = new ExecutionEngine(
    wallet,
    rpcManager.getAllConnections(),
    tradingConfig,
    tradeStore
  );

  // 9. Initialize sell ladder
  const sellLadder = new SellLadder(
    wallet,
    rpcManager.getAllConnections(),
    tradingConfig,
    tradeStore
  );
  log.info({ sellLadderReady: true }, 'ExecutionEngine and SellLadder initialized');

  // 10. Initialize position manager (started after recovery completes — see step 12)
  const positionManager = new PositionManager(
    tradeStore,
    sellLadder,
    rpcManager.getConnection(),
    new PublicKey(walletPubKeyStr),
    tradingConfig,
    jupiterClient,
  );

  // 11. Run crash recovery — BLOCKS until complete (PER-03, PER-05)
  // Detection must not start until recovery is fully done — no racing with live events.
  const recoveryManager = new RecoveryManager(
    tradeStore,
    rpcManager.getConnection(),
    new PublicKey(walletPubKeyStr),
    sellLadder,
  );
  const recoverySummary = await recoveryManager.run();
  log.info({
    monitoring: recoverySummary.monitoring,
    sellingResumed: recoverySummary.sellingResumed,
    sellingCompleted: recoverySummary.sellingCompleted,
    buyingRecovered: recoverySummary.buyingRecovered,
    buyingUnrecovered: recoverySummary.buyingUnrecovered,
    detectedDiscarded: recoverySummary.detectedDiscarded,
  }, 'Recovery complete');

  // 12. Start position manager — monitors MONITORING trades for exit triggers
  // Starts after recovery so recovered MONITORING trades are already in the store
  positionManager.start();
  log.info('PositionManager started');

  // 12.5. Start dashboard HTTP server (in-process, read-only observer)
  const dashboardServer = await createDashboardServer(tradeStore);
  await dashboardServer.listen({ port: env.DASHBOARD_PORT, host: '127.0.0.1' });
  log.info({ port: env.DASHBOARD_PORT }, 'Dashboard HTTP server listening');

  // 13. Start detection (safe: recovery is done, duplicate guard populated)
  const detectionManager = new DetectionManager(env, tradingConfig, rpcManager.getConnection());
  detectionManager.start();
  log.info('Detection manager started');

  // 14. Wire token events through safety pipeline and trade persistence
  detectionManager.on('token', async (event) => {
    try {
      const result = await safetyPipeline.evaluate(event);
      if (result.pass) {
        botEventBus.emit('event', { type: 'TOKEN_DETECTED', mint: event.mint, ts: Date.now(), detail: `from ${event.source}` });
        // POS-06: Enforce max concurrent position limit
        const activePositions = tradeStore.getMonitoringTrades().length;
        if (activePositions >= tradingConfig.maxConcurrentPositions) {
          log.info({ mint: event.mint, activePositions, limit: tradingConfig.maxConcurrentPositions },
            'Max concurrent positions reached — buy rejected');
          return;
        }
        // Duplicate guard: reject if a non-terminal trade already exists for this mint
        if (tradeStore.isActive(event.mint)) {
          log.debug({ mint: event.mint }, 'Duplicate buy blocked by active-mints guard');
          return;
        }
        // Write-ahead: record BUYING state before any on-chain action (PER-02)
        // Pass source and detected token program so SQLite trade record is complete from creation time.
        // This ensures crash recovery, chunked-seller ATA lookup, and sell ladder source checks all work.
        tradeStore.createBuyingRecord(event.mint, event.source, result.programId, getRuntimeConfig().dryRun);
        // Execute buy — routes to PumpPortal (bonding curve) or Jupiter (migrated) based on event.source
        void executionEngine.buy(event);
      }
      // Rejections already logged by SafetyPipeline with full detail
    } catch (err) {
      log.error({ err, mint: event.mint }, 'Safety pipeline error');
    }
  });

  // 15. Register shutdown handlers (WebSocket and onLogs keep event loop alive — no keepalive needed)
  const handler = (signal: string) => { void shutdown(signal, rpcManager, detectionManager, tradeStore, positionManager, dashboardServer); };
  process.on('SIGTERM', () => handler('SIGTERM'));
  process.on('SIGINT', () => handler('SIGINT'));
}

main().catch((err) => {
  log.fatal({ err }, 'Fatal startup error');
  process.exit(1);
});
