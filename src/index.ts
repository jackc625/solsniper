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
import { HealthService } from './monitoring/health-service.js';
import { MetricsTracker } from './monitoring/metrics-tracker.js';
import { AlertStore } from './monitoring/alert-store.js';
import { setPumpPortalBuyMonitoring } from './execution/buy/pump-portal-buyer.js';
import { setJitoMonitoring } from './execution/sell/jito-seller.js';
import { setPumpPortalSellMonitoring } from './execution/sell/pump-portal-seller.js';
import { setRugCheckMonitoring } from './safety/checks/tier2-rugcheck.js';
import { setCreatorCheckMonitoring } from './safety/checks/tier3-creator.js';
import type { ApiAlertCallback } from './core/fee-estimator.js';
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
  metricsTracker: MetricsTracker,
  healthCheckInterval: ReturnType<typeof setInterval>,
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

    // 0.5. Stop periodic health check
    clearInterval(healthCheckInterval);

    // 0.6. Close MetricsTracker prune timer (REL-03 shutdown)
    metricsTracker.close();

    // 0.7. Close dashboard HTTP server (SSE clients get 503; drains in-flight API requests)
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

  // 6.5. Initialize monitoring services (REL-01, REL-02, REL-03)
  const alertStore = new AlertStore(tradeStore.getDb());
  const metricsTracker = new MetricsTracker(); // 5-min default window
  const healthService = new HealthService(botEventBus, alertStore, {
    alertCooldownMs: tradingConfig.monitoring.alertCooldownMs,
  });
  log.info('Monitoring services initialized (HealthService, MetricsTracker, AlertStore)');

  // 6.6. API failure/rate-limit alert callback (REL-02, D-10)
  const apiFailureThreshold = tradingConfig.monitoring.apiFailureThreshold;
  const onApiAlert: ApiAlertCallback = (endpoint, type, message) => {
    const severity = type === 'rate_limit' ? 'error' as const : 'warn' as const;
    const alertSource = type === 'rate_limit' ? 'rateLimit' as const : 'api' as const;
    botEventBus.emit('event', {
      type: 'SYSTEM_ALERT',
      mint: '',
      ts: Date.now(),
      detail: message,
      severity,
      alertSource,
    });
    alertStore.insert({
      timestamp: Date.now(),
      type,
      severity,
      source: endpoint,
      message,
    });
    log.warn({ endpoint, type }, message);
  };

  // 7. Load wallet keypair for execution
  const wallet = getWallet();

  // 7.5. Initialize FeeEstimator (Helius dynamic priority fees) with monitoring
  const feeEstimator = new FeeEstimator(
    env.SOLSNIPER_RPC_URL,
    5000,
    metricsTracker,
    onApiAlert,
    apiFailureThreshold,
  );

  // 7.6. Wire monitoring into all fetch-calling modules (D-10, REL-03)
  jupiterClient.setMetricsTracker(metricsTracker);
  jupiterClient.setApiAlertCallback(onApiAlert, apiFailureThreshold);
  setPumpPortalBuyMonitoring(metricsTracker, onApiAlert, apiFailureThreshold);
  setPumpPortalSellMonitoring(metricsTracker, onApiAlert, apiFailureThreshold);
  setJitoMonitoring(metricsTracker, onApiAlert, apiFailureThreshold);
  setRugCheckMonitoring(metricsTracker, onApiAlert, apiFailureThreshold);
  setCreatorCheckMonitoring(metricsTracker, onApiAlert, apiFailureThreshold);
  log.info('MetricsTracker and API alert callback wired into all fetch call sites');

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

  // 12.3. Register health providers (REL-01)
  const DETECTION_SILENCE_THRESHOLD_MS = 600_000; // 10 min
  let lastDetectionActivity = Date.now();

  healthService.register('detection', () => {
    const silenceMs = Date.now() - lastDetectionActivity;
    if (silenceMs > DETECTION_SILENCE_THRESHOLD_MS) {
      return { status: 'degraded' as const, detail: `No tokens detected for ${Math.round(silenceMs / 60000)}min` };
    }
    return { status: 'healthy' as const, detail: 'Receiving token events' };
  });

  // RPC health: from RpcManager state (D-07)
  let rpcDegraded = false;
  rpcManager.on('failover', () => { rpcDegraded = true; });
  rpcManager.on('recovered', () => { rpcDegraded = false; });

  healthService.register('rpc', () => {
    const state = rpcManager.getState();
    if (rpcDegraded || state === 'backup') {
      return { status: 'degraded' as const, detail: `Using ${state} RPC endpoint` };
    }
    return { status: 'healthy' as const, detail: 'Primary RPC active' };
  });

  // Safety pipeline health: last-activity based (D-06)
  const SAFETY_SILENCE_THRESHOLD_MS = 600_000; // 10 min
  let lastSafetyActivity = Date.now();

  healthService.register('safety', () => {
    const silenceMs = Date.now() - lastSafetyActivity;
    if (silenceMs > SAFETY_SILENCE_THRESHOLD_MS) {
      return { status: 'degraded' as const, detail: `No safety checks for ${Math.round(silenceMs / 60000)}min` };
    }
    return { status: 'healthy' as const, detail: 'Safety pipeline active' };
  });

  // Execution engine health: last-activity based (D-06)
  const EXECUTION_SILENCE_THRESHOLD_MS = 1_800_000; // 30 min (generous for execution)
  let lastExecutionActivity = Date.now();

  healthService.register('execution', () => {
    const silenceMs = Date.now() - lastExecutionActivity;
    if (silenceMs > EXECUTION_SILENCE_THRESHOLD_MS) {
      return { status: 'degraded' as const, detail: `No execution activity for ${Math.round(silenceMs / 60000)}min` };
    }
    return { status: 'healthy' as const, detail: 'Execution engine active' };
  });

  // API endpoint health: error-rate based from MetricsTracker (gap closure: UAT Test 5)
  const apiErrorRateDegraded = tradingConfig.monitoring.apiErrorRateDegraded;
  const apiErrorRateDown = tradingConfig.monitoring.apiErrorRateDown;

  healthService.register('apis', () => {
    const allStats = metricsTracker.getAllStats();
    const degraded: string[] = [];
    const down: string[] = [];

    for (const [endpoint, stats] of Object.entries(allStats)) {
      if (stats.count === 0) continue;
      if (stats.errorRate >= apiErrorRateDown) {
        down.push(endpoint);
      } else if (stats.errorRate >= apiErrorRateDegraded) {
        degraded.push(endpoint);
      }
    }

    if (down.length > 0) {
      return { status: 'down' as const, detail: `Down: ${down.join(', ')}${degraded.length ? `; Degraded: ${degraded.join(', ')}` : ''}` };
    }
    if (degraded.length > 0) {
      return { status: 'degraded' as const, detail: `Degraded: ${degraded.join(', ')}` };
    }
    return { status: 'healthy' as const, detail: 'All API endpoints nominal' };
  });

  log.info('Health providers registered: detection, rpc, safety, execution, apis');

  // 12.4. Start periodic health check to trigger alert transitions (REL-02)
  const healthCheckInterval = setInterval(() => {
    healthService.check();
  }, 30_000); // Every 30 seconds
  healthCheckInterval.unref(); // Don't prevent process exit

  // 12.5. Detection pause state for controls API (D-12, Pitfall 2)
  const detectionState = { paused: false };

  // 12.6. Start dashboard HTTP server (in-process, read-only observer)
  const dashboardServer = await createDashboardServer(tradeStore, healthService, alertStore, metricsTracker, {
    getDetectionPaused: () => detectionState.paused,
    setDetectionPaused: (paused: boolean) => { detectionState.paused = paused; },
    isSellInFlight: (mint: string) => positionManager.isSellInFlight(mint),
    triggerSell: (mint: string, tokenAmount: bigint) => {
      void sellLadder.sell(mint, tokenAmount);
    },
  });
  await dashboardServer.listen({ port: env.DASHBOARD_PORT, host: '127.0.0.1' });
  log.info({ port: env.DASHBOARD_PORT }, 'Dashboard HTTP server listening');

  // 13. Start detection (safe: recovery is done, duplicate guard populated)
  const detectionManager = new DetectionManager(env, tradingConfig, rpcManager.getConnection());
  detectionManager.start();
  log.info('Detection manager started');

  // 14. Wire token events through safety pipeline and trade persistence
  detectionManager.on('token', async (event) => {
    lastDetectionActivity = Date.now(); // Track detection health
    try {
      // D-12: Skip processing if detection is paused (must be first check -- Pitfall 2)
      if (detectionState.paused) {
        log.debug({ mint: event.mint }, 'Detection paused -- skipping token');
        return;
      }

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
      lastSafetyActivity = Date.now(); // Track safety health
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
        lastExecutionActivity = Date.now(); // Track execution health
        void executionEngine.buy(event);
      }
      // Rejections already logged by SafetyPipeline with full detail
    } catch (err) {
      log.error({ err, mint: event.mint }, 'Safety pipeline error');
    }
  });

  // 15. Register shutdown handlers (WebSocket and onLogs keep event loop alive -- no keepalive needed)
  const handler = (signal: string) => { void shutdown(signal, rpcManager, detectionManager, tradeStore, positionManager, dashboardServer, metricsTracker, healthCheckInterval); };
  process.on('SIGTERM', () => handler('SIGTERM'));
  process.on('SIGINT', () => handler('SIGINT'));
}

main().catch((err) => {
  log.fatal({ err }, 'Fatal startup error');
  process.exit(1);
});
