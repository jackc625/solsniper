// IMPORTANT: env.ts must be imported first -- it loads dotenv and validates all
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
import { FeeEstimator } from './core/fee-estimator.js';
import { createDashboardServer } from './dashboard/dashboard-server.js';
import { botEventBus } from './dashboard/bot-event-bus.js';
import { BalanceGuard } from './core/balance-guard.js';
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
    log.warn('Graceful shutdown timed out after 5s -- forcing exit');
    process.exit(1);
  }, 5000);
  timeout.unref();

  try {
    // 0. Stop position manager polling (synchronous, clears setTimeout)
    // Must stop first -- prevents new sell triggers during teardown while connections are still open
    positionManager.stop();

    // 0.5. Close dashboard HTTP server (SSE clients get 503; drains in-flight API requests)
    await dashboardServer.close();

    // 1. Close RPC health check timers
    rpcManager.close();

    // 2. Close detection listeners (WebSocket + onLogs subscriptions)
    await detectionManager.stop();

    // 3. Flush SQLite writes (TradeStore.close() is synchronous -- flushes and closes)
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

  // 4. Log trading config (safe -- no secrets)
  log.info({ tradingConfig }, 'Trading configuration loaded');

  // 5. Initialize safety pipeline
  const safetyPipeline = new SafetyPipeline(rpcManager.getConnection(), tradingConfig, env);
  log.info('Safety pipeline initialized');

  // 6. Initialize trade store (write-ahead persistence layer)
  const tradeStore = new TradeStore('data/trades.db');
  log.info('TradeStore initialized');

  // 7. Load wallet keypair for execution
  const wallet = getWallet();

  // 7.5. Initialize FeeEstimator (Helius dynamic priority fees)
  const feeEstimator = new FeeEstimator(env.SOLSNIPER_RPC_URL);

  // 8. Initialize execution engine (buy routing: PumpPortal vs Jupiter)
  const executionEngine = new ExecutionEngine(
    wallet,
    rpcManager.getAllConnections(),
    tradingConfig,
    tradeStore,
    feeEstimator
  );

  // 9. Initialize sell ladder
  const sellLadder = new SellLadder(
    wallet,
    rpcManager.getAllConnections(),
    tradingConfig,
    tradeStore,
    feeEstimator
  );
  log.info({ sellLadderReady: true }, 'ExecutionEngine and SellLadder initialized');

  // 9.5. Balance guard: checks wallet SOL before buying (EXE-12)
  const balanceGuard = new BalanceGuard(5000); // 5s TTL per D-18

  // 10. Initialize position manager (started after recovery completes -- see step 12)
  const positionManager = new PositionManager(
    tradeStore,
    sellLadder,
    rpcManager.getConnection(),
    new PublicKey(walletPubKeyStr),
    tradingConfig,
    jupiterClient,
  );

  // 11. Run crash recovery -- BLOCKS until complete (PER-03, PER-05)
  // Detection must not start until recovery is fully done -- no racing with live events.
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

  // 12. Start position manager -- monitors MONITORING trades for exit triggers
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
      // POS-06: Enforce max concurrent position limit (before safety pipeline to avoid wasted RPC calls)
      const activePositions = tradeStore.getMonitoringTrades().length;
      const maxPositions = getRuntimeConfig().maxConcurrentPositions;
      if (activePositions >= maxPositions) {
        log.info({ mint: event.mint, activePositions, limit: maxPositions },
          'Max concurrent positions reached -- skipping safety checks');
        return;
      }

      // EXE-12: Balance guard -- skip buy if wallet SOL is below threshold (D-14: before safety pipeline)
      const cfg = getRuntimeConfig();
      const balanceCheck = await balanceGuard.check(
        rpcManager.getConnection(),
        new PublicKey(walletPubKeyStr),
        cfg.buyAmountSol,
        cfg.minBalanceBufferSol,
      );
      if (!balanceCheck.sufficient) {
        // D-15: Skip buy and emit LOW_BALANCE event for dashboard SSE
        botEventBus.emit('event', {
          type: 'LOW_BALANCE',
          mint: event.mint,
          ts: Date.now(),
          detail: `balance ${balanceCheck.balanceSol.toFixed(4)} SOL < threshold ${balanceCheck.thresholdSol.toFixed(4)} SOL`,
        });
        log.warn(
          { mint: event.mint, balanceSol: balanceCheck.balanceSol, thresholdSol: balanceCheck.thresholdSol },
          'Balance below buy threshold -- skipping safety checks',
        );
        return; // D-19: buys only -- sells never blocked
      }

      const result = await safetyPipeline.evaluate(event);
      if (result.pass) {
        botEventBus.emit('event', { type: 'TOKEN_DETECTED', mint: event.mint, ts: Date.now(), detail: `from ${event.source}`, isDryRun: getRuntimeConfig().dryRun, safetyScore: result.aggregateScore, source: event.source, buyAmountSol: getRuntimeConfig().buyAmountSol });
        // Duplicate guard: reject if a non-terminal trade already exists for this mint
        if (tradeStore.isActive(event.mint)) {
          log.debug({ mint: event.mint }, 'Duplicate buy blocked by active-mints guard');
          return;
        }
        // Write-ahead: record BUYING state before any on-chain action (PER-02)
        // Pass source, detected token program, and safety audit data so SQLite trade record is complete from creation time.
        // This ensures crash recovery, chunked-seller ATA lookup, sell ladder source checks, and safety audit all work.
        const checksDetail = JSON.stringify({
          tier1: result.tier1.map(r => ({ source: r.source, pass: r.pass, detail: r.detail })),
          tier2: result.tier2.map(r => ({ source: r.source, pass: r.pass, score: r.score, detail: r.detail })),
          tier3: result.tier3.map(r => ({ source: r.source, pass: r.pass, score: r.score, detail: r.detail })),
        });
        tradeStore.createBuyingRecord(
          event.mint,
          event.source,
          result.programId,
          getRuntimeConfig().dryRun,
          result.aggregateScore,
          result.rejectionReasons,
          checksDetail,
        );
        // Execute buy -- routes to PumpPortal (bonding curve) or Jupiter (migrated) based on event.source
        void executionEngine.buy(event);
      }
      // Rejections already logged by SafetyPipeline with full detail
    } catch (err) {
      log.error({ err, mint: event.mint }, 'Safety pipeline error');
    }
  });

  // 15. Register shutdown handlers (WebSocket and onLogs keep event loop alive -- no keepalive needed)
  const handler = (signal: string) => { void shutdown(signal, rpcManager, detectionManager, tradeStore, positionManager, dashboardServer); };
  process.on('SIGTERM', () => handler('SIGTERM'));
  process.on('SIGINT', () => handler('SIGINT'));
}

main().catch((err) => {
  log.fatal({ err }, 'Fatal startup error');
  process.exit(1);
});
