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

vi.mock('./checks/tier2-rugcheck.js', () => ({
  checkRugCheck: vi.fn(),
}));

vi.mock('./checks/tier2-holder.js', () => ({
  checkHolderConcentration: vi.fn(),
}));

vi.mock('./checks/tier3-creator.js', () => ({
  checkCreatorHistory: vi.fn(),
}));

// --- Import module under test AFTER mocks ---
import { SafetyPipeline } from './safety-pipeline.js';

// --- Import mocked check functions to get typed references ---
import { checkAuthorities } from './checks/tier1-authority.js';
import { checkSellRoute } from './checks/tier1-sell-route.js';
import { checkRugCheck } from './checks/tier2-rugcheck.js';
import { checkHolderConcentration } from './checks/tier2-holder.js';
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
    holder: { top1SoftBlockThreshold: 0.25, top10SoftBlockThreshold: 0.5 },
    rugCheckScoreInverted: true,
    blocklistPath: './data/creator-blocklist.json',
  },
  execution: {
    buy: { slippageBps: 1000, priorityFeeBaseLamports: 100000, priorityFeeMultiplier: 1 },
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

/** Tier 2/3 check results: all pass with high scores */
function makeTier2Tier3Pass(): [CheckResult, CheckResult, CheckResult] {
  const rugPass: CheckResult = { pass: true, score: 80, source: 'rugcheck', detail: 'score_normalised=20' };
  const holderPass: CheckResult = { pass: true, score: 65, source: 'holder_concentration', detail: 'top1=10.0% top10=35.0%' };
  const creatorPass: CheckResult = { pass: true, score: 80, source: 'creator_history', detail: '0 prior mints over 0h' };
  return [rugPass, holderPass, creatorPass];
}

describe('SafetyPipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset defaults after clearAllMocks
    mockCacheGet.mockReturnValue(null);
    mockBlocklistHas.mockReturnValue(false);
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
    expect(checkRugCheck).not.toHaveBeenCalled();
    expect(checkHolderConcentration).not.toHaveBeenCalled();
    expect(checkCreatorHistory).not.toHaveBeenCalled();
  });

  it('rejects with aggregateScore=0 when mint authority is active (Tier 1 hard block)', async () => {
    const mintAuthFail: CheckResult = { pass: false, source: 'mint_authority', detail: 'mint authority: TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' };
    const freezeAuthPass: CheckResult = { pass: true, source: 'freeze_authority', detail: 'revoked' };
    const sellRoutePass: CheckResult = { pass: true, source: 'jupiter_sell_route', detail: 'route exists' };

    vi.mocked(checkAuthorities).mockResolvedValue([mintAuthFail, freezeAuthPass, TOKEN_PROGRAM_ID_PK]);
    vi.mocked(checkSellRoute).mockResolvedValue(sellRoutePass);

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
    // Result must be cached
    expect(mockCacheSet).toHaveBeenCalledWith(MOCK_MINT, result);
  });

  it('rejects with aggregateScore=0 when freeze authority is active (Tier 1 hard block)', async () => {
    const mintAuthPass: CheckResult = { pass: true, source: 'mint_authority', detail: 'revoked' };
    const freezeAuthFail: CheckResult = { pass: false, source: 'freeze_authority', detail: 'freeze authority: TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' };
    const sellRoutePass: CheckResult = { pass: true, source: 'jupiter_sell_route', detail: 'route exists' };

    vi.mocked(checkAuthorities).mockResolvedValue([mintAuthPass, freezeAuthFail, TOKEN_PROGRAM_ID_PK]);
    vi.mocked(checkSellRoute).mockResolvedValue(sellRoutePass);

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

    const pipeline = new SafetyPipeline(mockConnection, mockTradingConfig, mockEnv);
    const result = await pipeline.evaluate(makeTokenEvent());

    expect(result.pass).toBe(false);
    expect(result.aggregateScore).toBe(0);
    expect(result.rejectionReasons.some(r => r.includes('jupiter_sell_route'))).toBe(true);
    expect(checkRugCheck).not.toHaveBeenCalled();
  });

  it('rejects via soft block when holder concentration exceeds threshold (even if aggregate would pass)', async () => {
    const [tier1AuthResult, tier1SellResult] = makeTier1Pass();
    vi.mocked(checkAuthorities).mockResolvedValue(tier1AuthResult);
    vi.mocked(checkSellRoute).mockResolvedValue(tier1SellResult);

    // Holder soft block triggered
    const holderFail: CheckResult = { pass: false, score: 10, source: 'holder_concentration', detail: 'top1=35.0% exceeds threshold=25%' };
    const rugPass: CheckResult = { pass: true, score: 90, source: 'rugcheck', detail: 'score_normalised=10' };
    const creatorPass: CheckResult = { pass: true, score: 80, source: 'creator_history', detail: '0 prior mints over 0h' };

    vi.mocked(checkRugCheck).mockResolvedValue(rugPass);
    vi.mocked(checkHolderConcentration).mockResolvedValue(holderFail);
    vi.mocked(checkCreatorHistory).mockResolvedValue(creatorPass);

    const pipeline = new SafetyPipeline(mockConnection, mockTradingConfig, mockEnv);
    const result = await pipeline.evaluate(makeTokenEvent());

    expect(result.pass).toBe(false);
    expect(result.rejectionReasons.some(r => r.includes('holder_concentration'))).toBe(true);
    expect(mockCacheSet).toHaveBeenCalledWith(MOCK_MINT, result);
  });

  it('rejects via soft block when creator is blocklisted', async () => {
    const [tier1AuthResult, tier1SellResult] = makeTier1Pass();
    vi.mocked(checkAuthorities).mockResolvedValue(tier1AuthResult);
    vi.mocked(checkSellRoute).mockResolvedValue(tier1SellResult);

    // Creator history soft block (blocklist hit in tier3)
    const creatorFail: CheckResult = { pass: false, score: 0, source: 'creator_history', detail: 'creator_blocklisted' };
    const rugPass: CheckResult = { pass: true, score: 80, source: 'rugcheck', detail: 'score_normalised=20' };
    const holderPass: CheckResult = { pass: true, score: 65, source: 'holder_concentration', detail: 'top1=10.0% top10=35.0%' };

    vi.mocked(checkRugCheck).mockResolvedValue(rugPass);
    vi.mocked(checkHolderConcentration).mockResolvedValue(holderPass);
    vi.mocked(checkCreatorHistory).mockResolvedValue(creatorFail);

    const pipeline = new SafetyPipeline(mockConnection, mockTradingConfig, mockEnv);
    const result = await pipeline.evaluate(makeTokenEvent());

    expect(result.pass).toBe(false);
    expect(result.rejectionReasons.some(r => r.includes('creator_history'))).toBe(true);
    expect(mockCacheSet).toHaveBeenCalledWith(MOCK_MINT, result);
  });

  it('passes with aggregate score above minSafetyScore threshold', async () => {
    const [tier1AuthResult, tier1SellResult] = makeTier1Pass();
    vi.mocked(checkAuthorities).mockResolvedValue(tier1AuthResult);
    vi.mocked(checkSellRoute).mockResolvedValue(tier1SellResult);

    const [rugPass, holderPass, creatorPass] = makeTier2Tier3Pass();
    vi.mocked(checkRugCheck).mockResolvedValue(rugPass);
    vi.mocked(checkHolderConcentration).mockResolvedValue(holderPass);
    vi.mocked(checkCreatorHistory).mockResolvedValue(creatorPass);

    const pipeline = new SafetyPipeline(mockConnection, mockTradingConfig, mockEnv);
    const result = await pipeline.evaluate(makeTokenEvent());

    expect(result.pass).toBe(true);
    expect(result.aggregateScore).toBeGreaterThanOrEqual(mockTradingConfig.minSafetyScore);
    expect(result.rejectionReasons).toHaveLength(0);
    expect(mockCacheSet).toHaveBeenCalledWith(MOCK_MINT, result);
  });

  it('rejects with aggregate score below minSafetyScore threshold', async () => {
    const [tier1AuthResult, tier1SellResult] = makeTier1Pass();
    vi.mocked(checkAuthorities).mockResolvedValue(tier1AuthResult);
    vi.mocked(checkSellRoute).mockResolvedValue(tier1SellResult);

    // Low scores — aggregate will be below 60
    const rugLow: CheckResult = { pass: true, score: 20, source: 'rugcheck', detail: 'score_normalised=80' };
    const holderLow: CheckResult = { pass: true, score: 15, source: 'holder_concentration', detail: 'top1=22.0% top10=45.0%' };
    const creatorLow: CheckResult = { pass: true, score: 10, source: 'creator_history', detail: '8 prior mints over 24h' };

    vi.mocked(checkRugCheck).mockResolvedValue(rugLow);
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

    // Simulate Promise.allSettled rejections (the pipeline should handle these)
    vi.mocked(checkRugCheck).mockRejectedValue(new Error('timeout'));
    vi.mocked(checkHolderConcentration).mockRejectedValue(new Error('RPC error'));
    vi.mocked(checkCreatorHistory).mockRejectedValue(new Error('network error'));

    const pipeline = new SafetyPipeline(mockConnection, mockTradingConfig, mockEnv);
    const result = await pipeline.evaluate(makeTokenEvent());

    // With all scores at 0, aggregate will be 0 (well below 60 threshold)
    expect(result.pass).toBe(false);
    expect(result.aggregateScore).toBe(0);
    expect(result.rejectionReasons.some(r => r.includes('aggregate_score'))).toBe(true);
  });

  it('evaluate() with source=pumpportal passes source to checkSellRoute', async () => {
    const [tier1AuthResult, tier1SellResult] = makeTier1Pass();
    vi.mocked(checkAuthorities).mockResolvedValue(tier1AuthResult);
    vi.mocked(checkSellRoute).mockResolvedValue(tier1SellResult);

    const [rugPass, holderPass, creatorPass] = makeTier2Tier3Pass();
    vi.mocked(checkRugCheck).mockResolvedValue(rugPass);
    vi.mocked(checkHolderConcentration).mockResolvedValue(holderPass);
    vi.mocked(checkCreatorHistory).mockResolvedValue(creatorPass);

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

  it('evaluate() returns programId from checkAuthorities in SafetyResult', async () => {
    // checkAuthorities returns TOKEN_2022_PROGRAM_ID_PK
    const mintAuthPass: CheckResult = { pass: true, source: 'mint_authority', detail: 'revoked' };
    const freezeAuthPass: CheckResult = { pass: true, source: 'freeze_authority', detail: 'revoked' };
    const sellRoutePass: CheckResult = { pass: true, source: 'jupiter_sell_route', detail: 'route exists' };
    vi.mocked(checkAuthorities).mockResolvedValue([mintAuthPass, freezeAuthPass, TOKEN_2022_PROGRAM_ID_PK]);
    vi.mocked(checkSellRoute).mockResolvedValue(sellRoutePass);

    const [rugPass, holderPass, creatorPass] = makeTier2Tier3Pass();
    vi.mocked(checkRugCheck).mockResolvedValue(rugPass);
    vi.mocked(checkHolderConcentration).mockResolvedValue(holderPass);
    vi.mocked(checkCreatorHistory).mockResolvedValue(creatorPass);

    const pipeline = new SafetyPipeline(mockConnection, mockTradingConfig, mockEnv);
    const result = await pipeline.evaluate(makeTokenEvent());

    expect(result.pass).toBe(true);
    expect(result.programId).toBe('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
  });
});
