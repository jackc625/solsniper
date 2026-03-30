import type { Connection } from '@solana/web3.js';
import type { TradingConfig } from '../config/trading.js';
import { getRuntimeConfig } from '../config/trading.js';
import type { Env } from '../config/env.js';
import type { TokenEvent, CheckResult, SafetyResult } from '../types/index.js';
import { SafetyCache } from './safety-cache.js';
import { Blocklist } from './blocklist.js';
import { checkAuthorities } from './checks/tier1-authority.js';
import { checkSellRoute } from './checks/tier1-sell-route.js';
import { checkLiquidityDepth } from './checks/tier1-liquidity.js';
import { checkRugCheck } from './checks/tier2-rugcheck.js';
import type { RugCheckResultData } from './checks/tier2-rugcheck.js';
import { checkHolderConcentration } from './checks/tier2-holder.js';
import { checkLpLock } from './checks/tier2-lp-lock.js';
import { checkMetadataMutability } from './checks/tier2-metadata.js';
import { checkCreatorHistory } from './checks/tier3-creator.js';
import { createModuleLogger } from '../core/logger.js';
import { botEventBus } from '../dashboard/bot-event-bus.js';

/**
 * Orchestrates the three-tier safety pipeline:
 *
 * Tier 1 (hard blocks, parallel via Promise.all):
 *   - checkAuthorities()     -- mint + freeze authority revocation (SAF-01, SAF-02)
 *   - checkSellRoute()       -- Jupiter sell route existence (SAF-03)
 *   - checkLiquidityDepth()  -- minimum pool SOL reserves (SAF-12)
 *
 * Tier 2 (scoring signals, parallel via Promise.allSettled with timeout):
 *   - checkRugCheck()            -- RugCheck API risk score inversion (SAF-05)
 *   - checkHolderConcentration() -- whale dominance soft block (SAF-06)
 *   - checkLpLock()              -- LP lock/burn status scoring (SAF-13)
 *   - checkMetadataMutability()  -- metadata immutability scoring (SAF-14)
 *
 * Tier 3 (scoring signals, parallel with Tier 2 via Promise.allSettled):
 *   - checkCreatorHistory() -- serial deployer detection (SAF-07)
 *
 * Aggregate score (SAF-08): weighted average of Tier 2+3 scores.
 * Penalty adjustments (SAF-11): LP lock and metadata penalties subtracted from aggregate.
 * Threshold rejection (SAF-09): tokens below minSafetyScore rejected.
 * Cache: results cached per mint for cacheTtlMs to prevent re-running checks.
 * Soft blocks: holder concentration and creator history can independently reject.
 */
export class SafetyPipeline {
  private readonly connection: Connection;
  private readonly tradingConfig: TradingConfig;
  private readonly env: Env;
  private readonly cache: SafetyCache;
  private readonly blocklist: Blocklist;
  private readonly log = createModuleLogger('safety-pipeline');

  constructor(connection: Connection, tradingConfig: TradingConfig, env: Env) {
    this.connection = connection;
    this.tradingConfig = tradingConfig;
    this.env = env;
    this.cache = new SafetyCache(tradingConfig.safety.cacheTtlMs);
    this.blocklist = new Blocklist(tradingConfig.safety.blocklistPath);
    this.blocklist.load();
  }

  /**
   * Evaluates a token event through the full safety pipeline.
   * Returns a SafetyResult with pass/fail decision, aggregate score, and detailed logging.
   */
  async evaluate(event: TokenEvent): Promise<SafetyResult> {
    // 1. Cache check -- skip all checks for recently evaluated mints
    const cached = this.cache.get(event.mint);
    if (cached !== null) {
      this.log.debug({ mint: event.mint }, 'Cache hit -- returning cached safety result');
      return cached;
    }

    const startTime = Date.now();
    const cfg = getRuntimeConfig();

    try {

    // 2. Tier 1: Hard blocks in parallel via Promise.all (SAF-04, SAF-12)
    // checkAuthorities returns [CheckResult, CheckResult, PublicKey] -- third element is detected programId
    // checkSellRoute receives event.source so pumpportal tokens skip the Jupiter indexing check
    // checkLiquidityDepth checks minimum SOL reserves in pool/bonding curve
    const [authResults, sellRouteResult, liquidityResult] = await Promise.all([
      checkAuthorities(event.mint, this.connection),
      checkSellRoute(event.mint, undefined, event.source),
      checkLiquidityDepth(event.mint, this.connection, cfg.safety.minLiquiditySol, event.source, event.poolQuoteVault),
    ]);

    const [mintAuthResult, freezeAuthResult, detectedProgramId] = authResults;
    const tier1Results: CheckResult[] = [mintAuthResult, freezeAuthResult, sellRouteResult, liquidityResult];

    // 3. Short-circuit: any Tier 1 failure = immediate hard reject
    const tier1Failures = tier1Results.filter(r => !r.pass);
    if (tier1Failures.length > 0) {
      const rejectionReasons = tier1Failures.map(r => `${r.source}: ${r.detail}`);
      const result = this.buildSafetyResult(false, event.mint, 0, tier1Results, [], [], rejectionReasons, startTime, detectedProgramId?.toBase58());
      this.log.info({
        mint: event.mint,
        source: event.source,
        decision: 'REJECTED',
        aggregateScore: 0,
        minSafetyScore: cfg.minSafetyScore,
        rejectionReasons,
        tier1: tier1Results.map(r => ({ source: r.source, pass: r.pass, detail: r.detail })),
        tier2: [],
        tier3: [],
        durationMs: Date.now() - startTime,
      }, 'Token rejected by safety pipeline');
      this.cache.set(event.mint, result);
      return result;
    }

    // 4. Tier 2 + Tier 3: Scoring signals in parallel via Promise.allSettled with timeouts
    // All 5 scoring checks run concurrently for maximum parallelism.
    // checkLpLock receives null for rugCheckData (uses on-chain fallback); after allSettled,
    // RugCheck lpLockedPct data overrides the LP lock result if available.
    const tier2Signal = AbortSignal.timeout(cfg.safety.tier2TimeoutMs);
    const tier3Signal = AbortSignal.timeout(cfg.safety.tier3TimeoutMs);

    const [rugCheckSettled, holderSettled, creatorSettled, lpLockSettled, metadataSettled] = await Promise.allSettled([
      checkRugCheck(event.mint, this.env.RUGCHECK_API_KEY, tier2Signal),
      checkHolderConcentration(event.mint, this.connection, cfg.safety.holder, detectedProgramId, event.source),
      checkCreatorHistory(event.creator, this.env.HELIUS_API_KEY, this.blocklist, tier3Signal),
      checkLpLock(event.mint, this.connection, null, event.source, tier2Signal),
      checkMetadataMutability(event.mint, this.connection, tier2Signal),
    ]);

    // Resolve rugCheck tuple -- extract CheckResult and RugCheckResultData separately
    let rugCheckResult: CheckResult;
    let rugCheckData: RugCheckResultData | null = null;
    if (rugCheckSettled.status === 'fulfilled') {
      [rugCheckResult, rugCheckData] = rugCheckSettled.value;
    } else {
      rugCheckResult = { pass: true, score: 0, source: 'rugcheck', detail: 'timeout_or_error' };
    }

    const holderResult = this.resolveSettled(holderSettled, 'holder_concentration');
    const creatorResult = this.resolveSettled(creatorSettled, 'creator_history');
    let lpLockResult = this.resolveSettled(lpLockSettled, 'lp_lock');
    const metadataResult = this.resolveSettled(metadataSettled, 'metadata_mutability');

    // Override lpLock result with RugCheck lpLockedPct data when available (more accurate than on-chain fallback)
    if (rugCheckData && rugCheckData.lpLockedPct > 0) {
      const pct = rugCheckData.lpLockedPct;
      lpLockResult = {
        pass: true,
        score: pct >= 90 ? 100 : Math.round(pct),
        source: 'lp_lock',
        detail: `rugcheck lpLockedPct=${pct}`,
      };
    } else if (rugCheckData && rugCheckData.lpLockedPct === 0 && rugCheckData.risks.length > 0) {
      // Confirmed unlocked per Pitfall 4
      lpLockResult = { pass: true, score: 0, source: 'lp_lock', detail: 'rugcheck lpLockedPct=0 (confirmed unlocked)' };
    }
    // If rugCheckData is null or lpLockedPct=0 with no risks, keep the on-chain fallback result from checkLpLock

    const tier2Results: CheckResult[] = [rugCheckResult, holderResult, lpLockResult, metadataResult];
    const tier3Results: CheckResult[] = [creatorResult];

    // 5. Soft block check: per-check rejections independent of aggregate score
    const softBlockFailures: CheckResult[] = [];
    if (!holderResult.pass) softBlockFailures.push(holderResult);
    if (!creatorResult.pass) softBlockFailures.push(creatorResult);

    if (softBlockFailures.length > 0) {
      const rejectionReasons = softBlockFailures.map(r => `${r.source}: ${r.detail}`);
      const result = this.buildSafetyResult(false, event.mint, 0, tier1Results, tier2Results, tier3Results, rejectionReasons, startTime, detectedProgramId?.toBase58());
      this.log.info({
        mint: event.mint,
        source: event.source,
        decision: 'REJECTED',
        aggregateScore: 0,
        minSafetyScore: cfg.minSafetyScore,
        rejectionReasons,
        tier1: tier1Results.map(r => ({ source: r.source, pass: r.pass, detail: r.detail })),
        tier2: tier2Results.map(r => ({ source: r.source, pass: r.pass, score: r.score, detail: r.detail })),
        tier3: tier3Results.map(r => ({ source: r.source, pass: r.pass, score: r.score, detail: r.detail })),
        durationMs: Date.now() - startTime,
      }, 'Token rejected by safety pipeline');
      this.cache.set(event.mint, result);
      return result;
    }

    // 6. Aggregate score computation (SAF-08): weighted average of Tier 2/3 scores
    const weights = cfg.safety.weights;
    const rugScore = rugCheckResult.score ?? 0;
    const holderScore = holderResult.score ?? 0;
    const creatorScore = creatorResult.score ?? 0;

    let aggregateScore = Math.round(
      (rugScore / 100) * weights.rugCheck +
      (holderScore / 100) * weights.holder +
      (creatorScore / 100) * weights.creator,
    );

    // 6a. Apply flat penalties for LP lock and metadata mutability (SAF-11)
    // Penalties are subtracted from the weighted average (not included in it).
    const lpLockScore = lpLockResult.score ?? 0;
    const metadataScore = metadataResult.score ?? 0;

    if (lpLockScore === 0) {
      aggregateScore = Math.max(0, aggregateScore - cfg.safety.lpLockScorePenalty);
    }
    if (metadataScore === 0) {
      aggregateScore = Math.max(0, aggregateScore - cfg.safety.metadataMutablePenalty);
    }

    // 7. Threshold check: reject tokens below minSafetyScore (SAF-09)
    if (aggregateScore < cfg.minSafetyScore) {
      const rejectionReasons = [
        `aggregate_score=${aggregateScore} below threshold=${cfg.minSafetyScore}`,
      ];
      const result = this.buildSafetyResult(false, event.mint, aggregateScore, tier1Results, tier2Results, tier3Results, rejectionReasons, startTime, detectedProgramId?.toBase58());
      this.log.info({
        mint: event.mint,
        source: event.source,
        decision: 'REJECTED',
        aggregateScore,
        minSafetyScore: cfg.minSafetyScore,
        rejectionReasons,
        tier1: tier1Results.map(r => ({ source: r.source, pass: r.pass, detail: r.detail })),
        tier2: tier2Results.map(r => ({ source: r.source, pass: r.pass, score: r.score, detail: r.detail })),
        tier3: tier3Results.map(r => ({ source: r.source, pass: r.pass, score: r.score, detail: r.detail })),
        durationMs: Date.now() - startTime,
      }, 'Token rejected by safety pipeline');
      this.cache.set(event.mint, result);
      return result;
    }

    // 8. Passed: aggregate score meets threshold
    const result = this.buildSafetyResult(true, event.mint, aggregateScore, tier1Results, tier2Results, tier3Results, [], startTime, detectedProgramId?.toBase58());
    this.log.info({
      mint: event.mint,
      source: event.source,
      decision: 'PASSED',
      aggregateScore,
      minSafetyScore: cfg.minSafetyScore,
      rejectionReasons: [],
      tier1: tier1Results.map(r => ({ source: r.source, pass: r.pass, detail: r.detail })),
      tier2: tier2Results.map(r => ({ source: r.source, pass: r.pass, score: r.score, detail: r.detail })),
      tier3: tier3Results.map(r => ({ source: r.source, pass: r.pass, score: r.score, detail: r.detail })),
      durationMs: Date.now() - startTime,
    }, 'Token passed safety pipeline');
    this.cache.set(event.mint, result);
    return result;

    } catch (err) {
      // Unexpected error in safety pipeline -- emit ERROR event for dashboard visibility
      botEventBus.emit('event', {
        type: 'ERROR',
        mint: event.mint,
        ts: Date.now(),
        detail: err instanceof Error ? err.message : 'Safety check error',
      });
      throw err;
    }
  }

  /**
   * Resolves a Promise.allSettled result into a CheckResult.
   * On rejection (error/timeout), returns a pessimistic result with pass=true, score=0.
   * (Soft blocks are checked separately; passing here avoids treating errors as hard blocks.)
   */
  private resolveSettled(
    settled: PromiseSettledResult<CheckResult>,
    source: string,
  ): CheckResult {
    if (settled.status === 'fulfilled') {
      return settled.value;
    }
    // Rejected: timeout or unexpected error -- pessimistic score=0
    return {
      pass: true,
      score: 0,
      source,
      detail: 'timeout_or_error',
    };
  }

  /**
   * Builds a SafetyResult from pipeline components.
   * programId is the detected token program from checkAuthorities (base58 pubkey string).
   */
  private buildSafetyResult(
    pass: boolean,
    mint: string,
    aggregateScore: number,
    tier1: CheckResult[],
    tier2: CheckResult[],
    tier3: CheckResult[],
    rejectionReasons: string[],
    startTime: number,
    programId?: string,
  ): SafetyResult {
    return {
      pass,
      mint,
      aggregateScore,
      tier1,
      tier2,
      tier3,
      rejectionReasons,
      durationMs: Date.now() - startTime,
      ...(programId !== undefined ? { programId } : {}),
    };
  }
}
