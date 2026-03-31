import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Connection } from '@solana/web3.js';
import { PublicKey } from '@solana/web3.js';
import type { TradingConfig } from '../config/trading.js';
import type { Env } from '../config/env.js';
import type { TokenEvent, CheckResult, SafetyResult } from '../types/index.js';

// --- Hoist shared spies (required for vi.mock factories to reference them) ---
const mockCacheGet = vi.hoisted(() => vi.fn().mockReturnValue(null));
const mockCacheSet = vi.hoisted(() => vi.fn());
const mockBlocklistLoad = vi.hoisted(() => vi.fn());
const mockBlocklistHas = vi.hoisted(() => vi.fn().mockReturnValue(false));
const mockBlocklistAdd = vi.hoisted(() => vi.fn());
const mockGetRuntimeConfig = vi.hoisted(() => vi.fn());

// --- Module mocks ---

vi.mock('./safety-cache.js', () => ({
  SafetyCache: vi.fn(function () {
    return { get: mockCacheGet, set: mockCacheSet };
  }),
}));

vi.mock('./blocklist.js', () => ({
  Blocklist: vi.fn(function () {
    return { load: mockBlocklistLoad, has: mockBlocklistHas, add: mockBlocklistAdd, size: 0 };
  }),
}));

vi.mock('./checks/tier1-authority.js', () => ({
  checkAuthorities: vi.fn(),
}));

vi.mock('./checks/tier1-sell-route.js', () => ({
  checkSellRoute: vi.fn(),
}));

vi.mock('./checks/tier1-liquidity.js', () => ({
  checkLiquidityDepth: vi.fn(),
}));

vi.mock('./checks/tier2-rugcheck.js', () => ({
  checkRugCheck: vi.fn(),
}));

vi.mock('./checks/tier2-holder.js', () => ({
  checkHolderConcentration: vi.fn(),
}));

vi.mock('./checks/tier2-lp-lock.js', () => ({
  checkLpLock: vi.fn(),
}));

vi.mock('./checks/tier2-metadata.js', () => ({
  checkMetadataMutability: vi.fn(),
}));

vi.mock('./checks/tier3-creator.js', () => ({
  checkCreatorHistory: vi.fn(),
}));

vi.mock('../config/trading.js', () => ({
  getRuntimeConfig: mockGetRuntimeConfig,
}));

// --- Import module under test AFTER mocks ---
import { SafetyPipeline } from './safety-pipeline.js';

// --- Import mocked check functions to get typed references ---
import { checkAuthorities } from './checks/tier1-authority.js';
import { checkSellRoute } from './checks/tier1-sell-route.js';
import { checkLiquidityDepth } from './checks/tier1-liquidity.js';
import { checkRugCheck } from './checks/tier2-rugcheck.js';
import { checkHolderConcentration } from './checks/tier2-holder.js';
import { checkLpLock } from './checks/tier2-lp-lock.js';
import { checkMetadataMutability } from './checks/tier2-metadata.js';
import { checkCreatorHistory } from './checks/tier3-creator.js';

// --- Test fixtures ---

const MOCK_MINT = 'So11111111111111111111111111111111111111112';
const MOCK_CREATOR = 'GThUX1Atko4tqhN2NaiTazFAcaPNtRDiMSCLDZPeHmKS';

const mockConnection = {} as Connection;

const mockTradingConfig: TradingConfig = {
  buyAmountSol: 0.1,
  maxSlippageBps: 300,
  maxConcurrentPositions: 3,
  stopLossPct: -0.15,
  takeProfitPct: 0.5,
  minSafetyScore: 60,
  dryRun: false,
  minBalanceBufferSol: 0.01,
  detection: {
    wsHeartbeatIntervalMs: 30000,
    wsBaseBackoffMs: 3000,
    wsMaxBackoffMs: 60000,
    wsExcessiveReconnectThreshold: 5,
    wsExcessiveReconnectWindowMs: 600000,
    statsIntervalMs: 900000,
    dedupWindowMs: 3600000,
  },
  safety: {
    tier2TimeoutMs: 2000,
    tier3TimeoutMs: 5000,
    cacheTtlMs: 300000,
    weights: { rugCheck: 40, holder: 30, creator: 30 },
    holder: { top1SoftBlockThreshold: 0.25, top10SoftBlockThreshold: 0.5, minUserHolders: 2 },
    rugCheckScoreInverted: true,
    blocklistPath: './data/creator-blocklist.json',
    minLiquiditySol: 1.0,
    lpLockScorePenalty: 30,
    metadataMutablePenalty: 15,
  },
  execution: {
    buy: { slippageBps: 1000, priorityFeeBaseLamports: 100000, priorityFeeMultiplier: 1, maxPriorityFeeCapLamports: 500000 },
    sell: {
      standardSlippageBps: 500,
      emergencySlippageBps: 4900,
      standardTimeoutMs: 30000,
      highFeeTimeoutMs: 20000,
      highFeeMultiplier: 3,
      jitoTimeoutMs: 30000,
      jitoTipLamports: 100000,
      chunkedTimeoutMs: 60000,
      emergencyTimeoutMs: 30000,
      emergencyPriorityMultiplier: 10,
    },
  },
  positionManagement: {
    pollIntervalMs: 5000,
    stopLossPct: -50,
    tieredTp: [{ at: 2, pct: 33 }, { at: 5, pct: 33 }, { at: 10, pct: 34 }],
    trailingStopPct: 0,
    maxHoldTimeMs: 120000,
  },
};

const mockEnv = {
  RUGCHECK_API_KEY: 'test-rugcheck-key',
  HELIUS_API_KEY: 'test-helius-key',
} as Env;

function makeTokenEvent(overrides: Partial<TokenEvent> = {}): TokenEvent {
  return {
    mint: MOCK_MINT,
    source: 'pumpportal',
    detectedAt: Date.now(),
    creator: MOCK_CREATOR,
    ...overrides,
  };
}

const TOKEN_PROGRAM_ID_PK = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const TOKEN_2022_PROGRAM_ID_PK = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');

/** Tier 1 check results: both pass (mints revoked, sell route exists)
 *  checkAuthorities now returns [CheckResult, CheckResult, PublicKey] (3-tuple)
 */
function makeTier1Pass(): [[CheckResult, CheckResult, PublicKey], CheckResult] {
  const mintAuthPass: CheckResult = { pass: true, source: 'mint_authority', detail: 'revoked' };
  const freezeAuthPass: CheckResult = { pass: true, source: 'freeze_authority', detail: 'revoked' };
  const sellRoutePass: CheckResult = { pass: true, source: 'jupiter_sell_route', detail: 'route exists' };
  return [[mintAuthPass, freezeAuthPass, TOKEN_PROGRAM_ID_PK], sellRoutePass];
}

/** Tier 2/3 check results: all pass with high scores (tuple format for rugCheck) */
function makeTier2Tier3Pass(): {
  rugCheck: [CheckResult, { lpLockedPct: number; risks: Array<{ name: string }> }];
  holder: CheckResult;
  creator: CheckResult;
} {
  const rugPass: CheckResult = { pass: true, score: 80, source: 'rugcheck', detail: 'score_normalised=20' };
  const holderPass: CheckResult = { pass: true, score: 65, source: 'holder_concentration', detail: 'top1=10.0% top10=35.0%' };
  const creatorPass: CheckResult = { pass: true, score: 80, source: 'creator_history', detail: '0 prior mints over 0h' };
  return {
    rugCheck: [rugPass, { lpLockedPct: 95, risks: [] }],
    holder: holderPass,
    creator: creatorPass,
  };
}

/** Set up all mocks for a fully-passing pipeline evaluation */
function setupAllPassingMocks() {
  const [tier1AuthResult, tier1SellResult] = makeTier1Pass();
  vi.mocked(checkAuthorities).mockResolvedValue(tier1AuthResult);
  vi.mocked(checkSellRoute).mockResolvedValue(tier1SellResult);
  vi.mocked(checkLiquidityDepth).mockResolvedValue({ pass: true, source: 'liquidity_depth', detail: 'ok' });

  const tier2Tier3 = makeTier2Tier3Pass();
  vi.mocked(checkRugCheck).mockResolvedValue(tier2Tier3.rugCheck);
  vi.mocked(checkHolderConcentration).mockResolvedValue(tier2Tier3.holder);
  vi.mocked(checkCreatorHistory).mockResolvedValue(tier2Tier3.creator);
  vi.mocked(checkLpLock).mockResolvedValue({ pass: true, score: 100, source: 'lp_lock', detail: 'locked' });
  vi.mocked(checkMetadataMutability).mockResolvedValue({ pass: true, score: 100, source: 'metadata_mutability', detail: 'immutable' });
}

describe('SafetyPipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset defaults after clearAllMocks
    mockCacheGet.mockReturnValue(null);
    mockBlocklistHas.mockReturnValue(false);
    mockGetRuntimeConfig.mockReturnValue(mockTradingConfig);
  });

  it('returns cached result on cache hit (second call for same mint)', async () => {
    const cachedResult: SafetyResult = {
      pass: true,
      mint: MOCK_MINT,
      aggregateScore: 75,
      tier1: [],
      tier2: [],
      tier3: [],
      rejectionReasons: [],
      durationMs: 50,
    };
    mockCacheGet.mockReturnValue(cachedResult);

    const pipeline = new SafetyPipeline(mockConnection, mockTradingConfig, mockEnv);
    const event = makeTokenEvent();
    const result = await pipeline.evaluate(event);

    expect(result).toBe(cachedResult);
    // No checks should be called when cache hit
    expect(checkAuthorities).not.toHaveBeenCalled();
    expect(checkSellRoute).not.toHaveBeenCalled();
    expect(checkLiquidityDepth).not.toHaveBeenCalled();
    expect(checkRugCheck).not.toHaveBeenCalled();
    expect(checkHolderConcentration).not.toHaveBeenCalled();
    expect(checkLpLock).not.toHaveBeenCalled();
    expect(checkMetadataMutability).not.toHaveBeenCalled();
    expect(checkCreatorHistory).not.toHaveBeenCalled();
  });

  it('rejects with aggregateScore=0 when mint authority is active (Tier 1 hard block)', async () => {
    const mintAuthFail: CheckResult = { pass: false, source: 'mint_authority', detail: 'mint authority: TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' };
    const freezeAuthPass: CheckResult = { pass: true, source: 'freeze_authority', detail: 'revoked' };
    const sellRoutePass: CheckResult = { pass: true, source: 'jupiter_sell_route', detail: 'route exists' };

    vi.mocked(checkAuthorities).mockResolvedValue([mintAuthFail, freezeAuthPass, TOKEN_PROGRAM_ID_PK]);
    vi.mocked(checkSellRoute).mockResolvedValue(sellRoutePass);
    vi.mocked(checkLiquidityDepth).mockResolvedValue({ pass: true, source: 'liquidity_depth', detail: 'ok' });

    const pipeline = new SafetyPipeline(mockConnection, mockTradingConfig, mockEnv);
    const result = await pipeline.evaluate(makeTokenEvent());

    expect(result.pass).toBe(false);
    expect(result.aggregateScore).toBe(0);
    expect(result.rejectionReasons.length).toBeGreaterThan(0);
    expect(result.rejectionReasons.some(r => r.includes('mint_authority'))).toBe(true);
    // Tier 2/3 checks must NOT be called (short-circuit)
    expect(checkRugCheck).not.toHaveBeenCalled();
    expect(checkHolderConcentration).not.toHaveBeenCalled();
    expect(checkCreatorHistory).not.toHaveBeenCalled();
    expect(checkLpLock).not.toHaveBeenCalled();
    expect(checkMetadataMutability).not.toHaveBeenCalled();
    // Result must be cached
    expect(mockCacheSet).toHaveBeenCalledWith(MOCK_MINT, result);
  });

  it('rejects with aggregateScore=0 when freeze authority is active (Tier 1 hard block)', async () => {
    const mintAuthPass: CheckResult = { pass: true, source: 'mint_authority', detail: 'revoked' };
    const freezeAuthFail: CheckResult = { pass: false, source: 'freeze_authority', detail: 'freeze authority: TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' };
    const sellRoutePass: CheckResult = { pass: true, source: 'jupiter_sell_route', detail: 'route exists' };

    vi.mocked(checkAuthorities).mockResolvedValue([mintAuthPass, freezeAuthFail, TOKEN_PROGRAM_ID_PK]);
    vi.mocked(checkSellRoute).mockResolvedValue(sellRoutePass);
    vi.mocked(checkLiquidityDepth).mockResolvedValue({ pass: true, source: 'liquidity_depth', detail: 'ok' });

    const pipeline = new SafetyPipeline(mockConnection, mockTradingConfig, mockEnv);
    const result = await pipeline.evaluate(makeTokenEvent());

    expect(result.pass).toBe(false);
    expect(result.aggregateScore).toBe(0);
    expect(result.rejectionReasons.some(r => r.includes('freeze_authority'))).toBe(true);
    expect(checkRugCheck).not.toHaveBeenCalled();
  });

  it('rejects with aggregateScore=0 when no sell route (Tier 1 hard block)', async () => {
    const mintAuthPass: CheckResult = { pass: true, source: 'mint_authority', detail: 'revoked' };
    const freezeAuthPass: CheckResult = { pass: true, source: 'freeze_authority', detail: 'revoked' };
    const sellRouteFail: CheckResult = { pass: false, source: 'jupiter_sell_route', detail: 'no route: {}' };

    vi.mocked(checkAuthorities).mockResolvedValue([mintAuthPass, freezeAuthPass, TOKEN_PROGRAM_ID_PK]);
    vi.mocked(checkSellRoute).mockResolvedValue(sellRouteFail);
    vi.mocked(checkLiquidityDepth).mockResolvedValue({ pass: true, source: 'liquidity_depth', detail: 'ok' });

    const pipeline = new SafetyPipeline(mockConnection, mockTradingConfig, mockEnv);
    const result = await pipeline.evaluate(makeTokenEvent());

    expect(result.pass).toBe(false);
    expect(result.aggregateScore).toBe(0);
    expect(result.rejectionReasons.some(r => r.includes('jupiter_sell_route'))).toBe(true);
    expect(checkRugCheck).not.toHaveBeenCalled();
  });

  it('rejects via soft block when holder concentration exceeds threshold (even if aggregate would pass)', async () => {
    setupAllPassingMocks();

    // Holder soft block triggered
    const holderFail: CheckResult = { pass: false, score: 10, source: 'holder_concentration', detail: 'top1=35.0% exceeds threshold=25%' };
    vi.mocked(checkHolderConcentration).mockResolvedValue(holderFail);

    const pipeline = new SafetyPipeline(mockConnection, mockTradingConfig, mockEnv);
    const result = await pipeline.evaluate(makeTokenEvent());

    expect(result.pass).toBe(false);
    expect(result.rejectionReasons.some(r => r.includes('holder_concentration'))).toBe(true);
    expect(mockCacheSet).toHaveBeenCalledWith(MOCK_MINT, result);
  });

  it('rejects via soft block when creator is blocklisted', async () => {
    setupAllPassingMocks();

    // Creator history soft block (blocklist hit in tier3)
    const creatorFail: CheckResult = { pass: false, score: 0, source: 'creator_history', detail: 'creator_blocklisted' };
    vi.mocked(checkCreatorHistory).mockResolvedValue(creatorFail);

    const pipeline = new SafetyPipeline(mockConnection, mockTradingConfig, mockEnv);
    const result = await pipeline.evaluate(makeTokenEvent());

    expect(result.pass).toBe(false);
    expect(result.rejectionReasons.some(r => r.includes('creator_history'))).toBe(true);
    expect(mockCacheSet).toHaveBeenCalledWith(MOCK_MINT, result);
  });

  it('passes with aggregate score above minSafetyScore threshold', async () => {
    setupAllPassingMocks();

    const pipeline = new SafetyPipeline(mockConnection, mockTradingConfig, mockEnv);
    const result = await pipeline.evaluate(makeTokenEvent());

    expect(result.pass).toBe(true);
    expect(result.aggregateScore).toBeGreaterThanOrEqual(mockTradingConfig.minSafetyScore);
    expect(result.rejectionReasons).toHaveLength(0);
    expect(mockCacheSet).toHaveBeenCalledWith(MOCK_MINT, result);
  });

  it('rejects with aggregate score below minSafetyScore threshold', async () => {
    setupAllPassingMocks();

    // Low scores -- aggregate will be below 60
    const rugLow: CheckResult = { pass: true, score: 20, source: 'rugcheck', detail: 'score_normalised=80' };
    const holderLow: CheckResult = { pass: true, score: 15, source: 'holder_concentration', detail: 'top1=22.0% top10=45.0%' };
    const creatorLow: CheckResult = { pass: true, score: 10, source: 'creator_history', detail: '8 prior mints over 24h' };

    vi.mocked(checkRugCheck).mockResolvedValue([rugLow, { lpLockedPct: 95, risks: [] }]);
    vi.mocked(checkHolderConcentration).mockResolvedValue(holderLow);
    vi.mocked(checkCreatorHistory).mockResolvedValue(creatorLow);

    const pipeline = new SafetyPipeline(mockConnection, mockTradingConfig, mockEnv);
    const result = await pipeline.evaluate(makeTokenEvent());

    expect(result.pass).toBe(false);
    expect(result.aggregateScore).toBeLessThan(mockTradingConfig.minSafetyScore);
    expect(result.rejectionReasons.some(r => r.includes('aggregate_score'))).toBe(true);
    expect(mockCacheSet).toHaveBeenCalledWith(MOCK_MINT, result);
  });

  it('uses pessimistic score (0) when Tier 2/3 checks reject (Promise.allSettled)', async () => {
    const [tier1AuthResult, tier1SellResult] = makeTier1Pass();
    vi.mocked(checkAuthorities).mockResolvedValue(tier1AuthResult);
    vi.mocked(checkSellRoute).mockResolvedValue(tier1SellResult);
    vi.mocked(checkLiquidityDepth).mockResolvedValue({ pass: true, source: 'liquidity_depth', detail: 'ok' });

    // Simulate Promise.allSettled rejections (the pipeline should handle these)
    vi.mocked(checkRugCheck).mockRejectedValue(new Error('timeout'));
    vi.mocked(checkHolderConcentration).mockRejectedValue(new Error('RPC error'));
    vi.mocked(checkCreatorHistory).mockRejectedValue(new Error('network error'));
    vi.mocked(checkLpLock).mockRejectedValue(new Error('timeout'));
    vi.mocked(checkMetadataMutability).mockRejectedValue(new Error('timeout'));

    const pipeline = new SafetyPipeline(mockConnection, mockTradingConfig, mockEnv);
    const result = await pipeline.evaluate(makeTokenEvent());

    // With all scores at 0, aggregate will be 0 (well below 60 threshold)
    // Plus penalties for lp_lock score=0 and metadata score=0
    expect(result.pass).toBe(false);
    expect(result.aggregateScore).toBe(0);
    expect(result.rejectionReasons.some(r => r.includes('aggregate_score'))).toBe(true);
  });

  it('evaluate() with source=pumpportal passes source to checkSellRoute', async () => {
    setupAllPassingMocks();

    const pipeline = new SafetyPipeline(mockConnection, mockTradingConfig, mockEnv);
    const event = makeTokenEvent({ source: 'pumpportal' });
    await pipeline.evaluate(event);

    // checkSellRoute must be called with source='pumpportal' as third argument
    expect(checkSellRoute).toHaveBeenCalledWith(
      MOCK_MINT,
      undefined,
      'pumpportal',
    );
  });

  it('passes detectedProgramId to checkHolderConcentration', async () => {
    const mintAuthPass: CheckResult = { pass: true, source: 'mint_authority', detail: 'revoked' };
    const freezeAuthPass: CheckResult = { pass: true, source: 'freeze_authority', detail: 'revoked' };
    const sellRoutePass: CheckResult = { pass: true, source: 'jupiter_sell_route', detail: 'route exists' };
    vi.mocked(checkAuthorities).mockResolvedValue([mintAuthPass, freezeAuthPass, TOKEN_2022_PROGRAM_ID_PK]);
    vi.mocked(checkSellRoute).mockResolvedValue(sellRoutePass);
    vi.mocked(checkLiquidityDepth).mockResolvedValue({ pass: true, source: 'liquidity_depth', detail: 'ok' });

    const tier2Tier3 = makeTier2Tier3Pass();
    vi.mocked(checkRugCheck).mockResolvedValue(tier2Tier3.rugCheck);
    vi.mocked(checkHolderConcentration).mockResolvedValue(tier2Tier3.holder);
    vi.mocked(checkCreatorHistory).mockResolvedValue(tier2Tier3.creator);
    vi.mocked(checkLpLock).mockResolvedValue({ pass: true, score: 100, source: 'lp_lock', detail: 'locked' });
    vi.mocked(checkMetadataMutability).mockResolvedValue({ pass: true, score: 100, source: 'metadata_mutability', detail: 'immutable' });

    const pipeline = new SafetyPipeline(mockConnection, mockTradingConfig, mockEnv);
    await pipeline.evaluate(makeTokenEvent());

    // checkHolderConcentration must receive the detected programId as 4th argument and source as 5th
    expect(checkHolderConcentration).toHaveBeenCalledWith(
      MOCK_MINT,
      mockConnection,
      mockTradingConfig.safety.holder,
      TOKEN_2022_PROGRAM_ID_PK,
      'pumpportal',  // makeTokenEvent() defaults source to 'pumpportal'
    );
  });

  it('evaluate() returns programId from checkAuthorities in SafetyResult', async () => {
    // checkAuthorities returns TOKEN_2022_PROGRAM_ID_PK
    const mintAuthPass: CheckResult = { pass: true, source: 'mint_authority', detail: 'revoked' };
    const freezeAuthPass: CheckResult = { pass: true, source: 'freeze_authority', detail: 'revoked' };
    const sellRoutePass: CheckResult = { pass: true, source: 'jupiter_sell_route', detail: 'route exists' };
    vi.mocked(checkAuthorities).mockResolvedValue([mintAuthPass, freezeAuthPass, TOKEN_2022_PROGRAM_ID_PK]);
    vi.mocked(checkSellRoute).mockResolvedValue(sellRoutePass);
    vi.mocked(checkLiquidityDepth).mockResolvedValue({ pass: true, source: 'liquidity_depth', detail: 'ok' });

    const tier2Tier3 = makeTier2Tier3Pass();
    vi.mocked(checkRugCheck).mockResolvedValue(tier2Tier3.rugCheck);
    vi.mocked(checkHolderConcentration).mockResolvedValue(tier2Tier3.holder);
    vi.mocked(checkCreatorHistory).mockResolvedValue(tier2Tier3.creator);
    vi.mocked(checkLpLock).mockResolvedValue({ pass: true, score: 100, source: 'lp_lock', detail: 'locked' });
    vi.mocked(checkMetadataMutability).mockResolvedValue({ pass: true, score: 100, source: 'metadata_mutability', detail: 'immutable' });

    const pipeline = new SafetyPipeline(mockConnection, mockTradingConfig, mockEnv);
    const result = await pipeline.evaluate(makeTokenEvent());

    expect(result.pass).toBe(true);
    expect(result.programId).toBe('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
  });

  // --- NEW: Tier 1 liquidity depth check tests ---

  describe('Tier 1: liquidity depth check', () => {
    it('rejects when liquidity depth check fails (pass=false)', async () => {
      const [tier1AuthResult, tier1SellResult] = makeTier1Pass();
      vi.mocked(checkAuthorities).mockResolvedValue(tier1AuthResult);
      vi.mocked(checkSellRoute).mockResolvedValue(tier1SellResult);
      vi.mocked(checkLiquidityDepth).mockResolvedValue({
        pass: false,
        source: 'liquidity_depth',
        detail: 'bonding_curve_sol=0.5000',
      });

      const pipeline = new SafetyPipeline(mockConnection, mockTradingConfig, mockEnv);
      const result = await pipeline.evaluate(makeTokenEvent());

      expect(result.pass).toBe(false);
      expect(result.aggregateScore).toBe(0);
      expect(result.rejectionReasons.some(r => r.includes('liquidity_depth'))).toBe(true);
      // Tier 2/3 checks must NOT be called (short-circuit)
      expect(checkRugCheck).not.toHaveBeenCalled();
      expect(checkHolderConcentration).not.toHaveBeenCalled();
      expect(checkLpLock).not.toHaveBeenCalled();
      expect(checkMetadataMutability).not.toHaveBeenCalled();
      expect(checkCreatorHistory).not.toHaveBeenCalled();
    });

    it('continues to Tier 2 when liquidity depth passes', async () => {
      setupAllPassingMocks();

      const pipeline = new SafetyPipeline(mockConnection, mockTradingConfig, mockEnv);
      const result = await pipeline.evaluate(makeTokenEvent());

      expect(result.pass).toBe(true);
      // Tier 2/3 checks should be called
      expect(checkRugCheck).toHaveBeenCalled();
      expect(checkHolderConcentration).toHaveBeenCalled();
      expect(checkLpLock).toHaveBeenCalled();
      expect(checkMetadataMutability).toHaveBeenCalled();
      expect(checkCreatorHistory).toHaveBeenCalled();
    });

    it('passes source and poolQuoteVault to checkLiquidityDepth', async () => {
      setupAllPassingMocks();

      const pipeline = new SafetyPipeline(mockConnection, mockTradingConfig, mockEnv);
      const event = makeTokenEvent({ source: 'raydium', poolQuoteVault: 'VaultAddr123' });
      await pipeline.evaluate(event);

      expect(checkLiquidityDepth).toHaveBeenCalledWith(
        MOCK_MINT,
        mockConnection,
        mockTradingConfig.safety.minLiquiditySol,
        'raydium',
        'VaultAddr123',
        undefined,
      );
    });
  });

  // --- NEW: Tier 2 LP lock penalty tests ---

  describe('Tier 2: LP lock penalty', () => {
    it('reduces aggregate score by lpLockScorePenalty when LP is unlocked (score=0)', async () => {
      setupAllPassingMocks();
      vi.mocked(checkLpLock).mockResolvedValue({ pass: true, score: 0, source: 'lp_lock', detail: 'unlocked' });
      // rugCheck returns lpLockedPct=0 with no risks, so lpLock on-chain fallback is kept
      vi.mocked(checkRugCheck).mockResolvedValue([
        { pass: true, score: 80, source: 'rugcheck', detail: 'ok' },
        { lpLockedPct: 0, risks: [] },
      ]);

      const pipeline = new SafetyPipeline(mockConnection, mockTradingConfig, mockEnv);
      const result = await pipeline.evaluate(makeTokenEvent());

      // Weighted avg: (80/100)*40 + (65/100)*30 + (80/100)*30 = 32 + 19.5 + 24 = 75.5 -> 76
      // LP penalty: -30 -> 46
      // Metadata score=100, no penalty
      expect(result.aggregateScore).toBe(46);
    });

    it('does not reduce aggregate score when LP is locked (score=100)', async () => {
      setupAllPassingMocks();
      vi.mocked(checkLpLock).mockResolvedValue({ pass: true, score: 100, source: 'lp_lock', detail: 'locked' });

      const pipeline = new SafetyPipeline(mockConnection, mockTradingConfig, mockEnv);
      const result = await pipeline.evaluate(makeTokenEvent());

      // Weighted avg: (80/100)*40 + (65/100)*30 + (80/100)*30 = 32 + 19.5 + 24 = 75.5 -> 76
      // No penalties (lpLock=100, metadata=100)
      expect(result.aggregateScore).toBe(76);
    });

    it('LP lock penalty cannot reduce aggregate score below 0', async () => {
      setupAllPassingMocks();
      vi.mocked(checkLpLock).mockResolvedValue({ pass: true, score: 0, source: 'lp_lock', detail: 'unlocked' });
      // rugCheck returns lpLockedPct=0 with no risks, so lpLock on-chain fallback is kept
      vi.mocked(checkRugCheck).mockResolvedValue([
        { pass: true, score: 10, source: 'rugcheck', detail: 'high risk' },
        { lpLockedPct: 0, risks: [] },
      ]);
      vi.mocked(checkHolderConcentration).mockResolvedValue({ pass: true, score: 10, source: 'holder_concentration', detail: 'ok' });
      vi.mocked(checkCreatorHistory).mockResolvedValue({ pass: true, score: 10, source: 'creator_history', detail: 'ok' });
      vi.mocked(checkMetadataMutability).mockResolvedValue({ pass: true, score: 0, source: 'metadata_mutability', detail: 'mutable' });

      const pipeline = new SafetyPipeline(mockConnection, mockTradingConfig, mockEnv);
      const result = await pipeline.evaluate(makeTokenEvent());

      // Weighted avg: (10/100)*40 + (10/100)*30 + (10/100)*30 = 4 + 3 + 3 = 10
      // LP penalty: -30 -> max(0, -20) = 0
      // Metadata penalty would reduce further but already at 0
      expect(result.aggregateScore).toBe(0);
    });
  });

  // --- NEW: Tier 2 metadata mutability penalty tests ---

  describe('Tier 2: metadata mutability penalty', () => {
    it('reduces aggregate score by metadataMutablePenalty when metadata is mutable (score=0)', async () => {
      setupAllPassingMocks();
      vi.mocked(checkMetadataMutability).mockResolvedValue({ pass: true, score: 0, source: 'metadata_mutability', detail: 'isMutable=true' });

      const pipeline = new SafetyPipeline(mockConnection, mockTradingConfig, mockEnv);
      const result = await pipeline.evaluate(makeTokenEvent());

      // Weighted avg: (80/100)*40 + (65/100)*30 + (80/100)*30 = 32 + 19.5 + 24 = 75.5 -> 76
      // LP lock score=100 from rugCheck lpLockedPct=95 override, no LP penalty
      // Metadata penalty: -15 -> 61
      expect(result.aggregateScore).toBe(61);
    });

    it('does not reduce aggregate score when metadata is immutable (score=100)', async () => {
      setupAllPassingMocks();

      const pipeline = new SafetyPipeline(mockConnection, mockTradingConfig, mockEnv);
      const result = await pipeline.evaluate(makeTokenEvent());

      // Weighted avg: 76 (same as above), no penalties
      expect(result.aggregateScore).toBe(76);
    });
  });

  // --- NEW: Combined penalties tests ---

  describe('combined penalties', () => {
    it('stacks both LP lock and metadata penalties', async () => {
      setupAllPassingMocks();
      vi.mocked(checkLpLock).mockResolvedValue({ pass: true, score: 0, source: 'lp_lock', detail: 'unlocked' });
      vi.mocked(checkMetadataMutability).mockResolvedValue({ pass: true, score: 0, source: 'metadata_mutability', detail: 'isMutable=true' });
      // rugCheck returns lpLockedPct=0 with no risks, so lpLock on-chain fallback is kept
      vi.mocked(checkRugCheck).mockResolvedValue([
        { pass: true, score: 80, source: 'rugcheck', detail: 'ok' },
        { lpLockedPct: 0, risks: [] },
      ]);

      const pipeline = new SafetyPipeline(mockConnection, mockTradingConfig, mockEnv);
      const result = await pipeline.evaluate(makeTokenEvent());

      // Weighted avg: (80/100)*40 + (65/100)*30 + (80/100)*30 = 32 + 19.5 + 24 = 75.5 -> 76
      // LP penalty: -30 -> 46
      // Metadata penalty: -15 -> 31
      expect(result.aggregateScore).toBe(31);
    });

    it('penalties push aggregate below threshold causing rejection', async () => {
      setupAllPassingMocks();
      vi.mocked(checkLpLock).mockResolvedValue({ pass: true, score: 0, source: 'lp_lock', detail: 'unlocked' });
      vi.mocked(checkMetadataMutability).mockResolvedValue({ pass: true, score: 0, source: 'metadata_mutability', detail: 'isMutable=true' });
      // rugCheck returns lpLockedPct=0 with no risks, so lpLock on-chain fallback is kept
      vi.mocked(checkRugCheck).mockResolvedValue([
        { pass: true, score: 80, source: 'rugcheck', detail: 'ok' },
        { lpLockedPct: 0, risks: [] },
      ]);

      const pipeline = new SafetyPipeline(mockConnection, mockTradingConfig, mockEnv);
      const result = await pipeline.evaluate(makeTokenEvent());

      // Aggregate = 31 (from stacked penalties), threshold = 60
      expect(result.pass).toBe(false);
      expect(result.aggregateScore).toBe(31);
      expect(result.rejectionReasons.some(r => r.includes('aggregate_score'))).toBe(true);
    });

    it('penalties cannot reduce aggregate below 0', async () => {
      setupAllPassingMocks();
      vi.mocked(checkLpLock).mockResolvedValue({ pass: true, score: 0, source: 'lp_lock', detail: 'unlocked' });
      vi.mocked(checkMetadataMutability).mockResolvedValue({ pass: true, score: 0, source: 'metadata_mutability', detail: 'mutable' });
      // Low base scores
      vi.mocked(checkRugCheck).mockResolvedValue([
        { pass: true, score: 20, source: 'rugcheck', detail: 'high risk' },
        { lpLockedPct: 0, risks: [] },
      ]);
      vi.mocked(checkHolderConcentration).mockResolvedValue({ pass: true, score: 20, source: 'holder_concentration', detail: 'ok' });
      vi.mocked(checkCreatorHistory).mockResolvedValue({ pass: true, score: 20, source: 'creator_history', detail: 'ok' });

      const pipeline = new SafetyPipeline(mockConnection, mockTradingConfig, mockEnv);
      const result = await pipeline.evaluate(makeTokenEvent());

      // Weighted avg: (20/100)*40 + (20/100)*30 + (20/100)*30 = 8 + 6 + 6 = 20
      // LP penalty: -30 -> max(0, -10) = 0
      // Metadata penalty: -15 -> max(0, 0-15) = 0 (already at 0)
      expect(result.aggregateScore).toBe(0);
    });
  });

  // --- NEW: RugCheck lpLockedPct override tests ---

  describe('RugCheck lpLockedPct override', () => {
    it('overrides lpLock on-chain fallback with rugCheck lpLockedPct when available', async () => {
      setupAllPassingMocks();
      // On-chain fallback returned score=0 (unlocked)
      vi.mocked(checkLpLock).mockResolvedValue({ pass: true, score: 0, source: 'lp_lock', detail: 'no LP mint data' });
      // But rugCheck returned lpLockedPct=95 (locked) -- should override
      vi.mocked(checkRugCheck).mockResolvedValue([
        { pass: true, score: 80, source: 'rugcheck', detail: 'ok' },
        { lpLockedPct: 95, risks: [] },
      ]);

      const pipeline = new SafetyPipeline(mockConnection, mockTradingConfig, mockEnv);
      const result = await pipeline.evaluate(makeTokenEvent());

      // lpLock score is overridden to 100 (>=90), so no LP penalty
      // Weighted avg: (80/100)*40 + (65/100)*30 + (80/100)*30 = 76
      // No penalties
      expect(result.aggregateScore).toBe(76);
      // Verify lpLock result is in tier2 with rugcheck override detail
      expect(result.tier2.some(r => r.source === 'lp_lock' && r.detail.includes('rugcheck lpLockedPct=95'))).toBe(true);
    });

    it('confirms unlocked when rugCheck returns lpLockedPct=0 with risks', async () => {
      setupAllPassingMocks();
      // On-chain fallback returned score=50 (neutral)
      vi.mocked(checkLpLock).mockResolvedValue({ pass: true, score: 50, source: 'lp_lock', detail: 'neutral' });
      // RugCheck confirms unlocked: lpLockedPct=0 with risks present
      vi.mocked(checkRugCheck).mockResolvedValue([
        { pass: true, score: 80, source: 'rugcheck', detail: 'ok' },
        { lpLockedPct: 0, risks: [{ name: 'Mutable metadata' }] },
      ]);

      const pipeline = new SafetyPipeline(mockConnection, mockTradingConfig, mockEnv);
      const result = await pipeline.evaluate(makeTokenEvent());

      // lpLock overridden to score=0 (confirmed unlocked)
      // Weighted avg: 76
      // LP penalty: -30 -> 46
      expect(result.aggregateScore).toBe(46);
    });

    it('keeps on-chain fallback when rugCheck data is null (error/timeout)', async () => {
      setupAllPassingMocks();
      // On-chain fallback returned score=50
      vi.mocked(checkLpLock).mockResolvedValue({ pass: true, score: 50, source: 'lp_lock', detail: 'on-chain: neutral' });
      // RugCheck failed
      vi.mocked(checkRugCheck).mockRejectedValue(new Error('timeout'));

      const pipeline = new SafetyPipeline(mockConnection, mockTradingConfig, mockEnv);
      const result = await pipeline.evaluate(makeTokenEvent());

      // rugCheck score=0 (pessimistic), lpLock score=50 (on-chain fallback kept)
      // No LP penalty (score=50 != 0)
      // Weighted avg: (0/100)*40 + (65/100)*30 + (80/100)*30 = 0 + 19.5 + 24 = 43.5 -> 44
      // No metadata penalty (score=100)
      expect(result.aggregateScore).toBe(44);
    });

    it('uses partial lpLockedPct score when between 0 and 90', async () => {
      setupAllPassingMocks();
      vi.mocked(checkLpLock).mockResolvedValue({ pass: true, score: 0, source: 'lp_lock', detail: 'no data' });
      // rugCheck returns lpLockedPct=50 (partial lock)
      vi.mocked(checkRugCheck).mockResolvedValue([
        { pass: true, score: 80, source: 'rugcheck', detail: 'ok' },
        { lpLockedPct: 50, risks: [] },
      ]);

      const pipeline = new SafetyPipeline(mockConnection, mockTradingConfig, mockEnv);
      const result = await pipeline.evaluate(makeTokenEvent());

      // lpLock overridden to score=50 (Math.round(50))
      // No LP penalty (score=50 != 0)
      // Weighted avg: 76, no penalties
      expect(result.aggregateScore).toBe(76);
    });
  });

  // --- NEW: Pipeline with all checks passing ---

  describe('full pipeline integration', () => {
    it('includes all new checks in tier1 and tier2 result arrays', async () => {
      setupAllPassingMocks();

      const pipeline = new SafetyPipeline(mockConnection, mockTradingConfig, mockEnv);
      const result = await pipeline.evaluate(makeTokenEvent());

      expect(result.pass).toBe(true);
      // Tier 1 should have 4 results: mint_authority, freeze_authority, sell_route, liquidity_depth
      expect(result.tier1).toHaveLength(4);
      expect(result.tier1.some(r => r.source === 'liquidity_depth')).toBe(true);
      // Tier 2 should have 4 results: rugcheck, holder, lp_lock, metadata
      expect(result.tier2).toHaveLength(4);
      expect(result.tier2.some(r => r.source === 'lp_lock')).toBe(true);
      expect(result.tier2.some(r => r.source === 'metadata_mutability')).toBe(true);
      // Tier 3 should have 1 result: creator_history
      expect(result.tier3).toHaveLength(1);
    });
  });
});
