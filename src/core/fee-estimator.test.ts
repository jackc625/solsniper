import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock env.js first — logger.ts imports env for LOG_LEVEL/NODE_ENV
// ---------------------------------------------------------------------------
vi.mock('../config/env.js', () => ({
  env: {
    LOG_LEVEL: 'error',
    NODE_ENV: 'development',
  },
}));

// ---------------------------------------------------------------------------
// Mock config/trading.js — avoid loading real config.jsonc during tests
// ---------------------------------------------------------------------------
vi.mock('../config/trading.js', () => ({
  getRuntimeConfig: vi.fn(),
  tradingConfig: {},
}));

import { FeeEstimator } from './fee-estimator.js';
import type { TradingConfig } from '../config/trading.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const ESTIMATED_CU = 200_000;

function makeConfig(overrides?: {
  baseLamports?: number;
  multiplier?: number;
  cap?: number;
}): TradingConfig {
  return {
    execution: {
      buy: {
        slippageBps: 1000,
        priorityFeeBaseLamports: overrides?.baseLamports ?? 100_000,
        priorityFeeMultiplier: overrides?.multiplier ?? 1,
        maxPriorityFeeCapLamports: overrides?.cap ?? 500_000,
      },
      sell: {
        standardSlippageBps: 500,
        emergencySlippageBps: 4900,
        standardTimeoutMs: 30_000,
        highFeeTimeoutMs: 20_000,
        highFeeMultiplier: 3,
        jitoTimeoutMs: 30_000,
        jitoTipLamports: 100_000,
        chunkedTimeoutMs: 60_000,
        emergencyTimeoutMs: 30_000,
        emergencyPriorityMultiplier: 10,
      },
    },
  } as TradingConfig;
}

describe('FeeEstimator', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('fetches from Helius and converts microlamports/CU to total lamports', async () => {
    // 1000 microlamports/CU * 200_000 CU / 1_000_000 = 200 lamports
    const microlamportsPerCU = 1000;
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        jsonrpc: '2.0',
        result: { priorityFeeEstimate: microlamportsPerCU },
      }),
    });

    const estimator = new FeeEstimator('https://rpc.example.com', 5000);
    const config = makeConfig();
    const result = await estimator.getEstimate(config);

    // Verify fetch was called with correct Helius method
    expect(fetchSpy).toHaveBeenCalledOnce();
    const fetchCall = fetchSpy.mock.calls[0];
    expect(fetchCall[0]).toBe('https://rpc.example.com');
    const body = JSON.parse(fetchCall[1].body);
    expect(body.method).toBe('getPriorityFeeEstimate');
    expect(body.params[0].options.priorityLevel).toBe('VeryHigh');

    // Verify conversion
    const expectedLamports = Math.ceil(microlamportsPerCU * ESTIMATED_CU / 1_000_000);
    expect(result.maxLamports).toBe(expectedLamports);
    expect(result.source).toBe('helius');
  });

  it('falls back to static config values when fetch fails', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('Network error'));

    const estimator = new FeeEstimator('https://rpc.example.com', 5000);
    const config = makeConfig({ baseLamports: 100_000, multiplier: 2 });
    const result = await estimator.getEstimate(config);

    expect(result.maxLamports).toBe(200_000); // 100_000 * 2
    expect(result.source).toBe('fallback');
  });

  it('falls back when Helius returns non-ok status', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 500,
    });

    const estimator = new FeeEstimator('https://rpc.example.com', 5000);
    const config = makeConfig({ baseLamports: 50_000, multiplier: 3 });
    const result = await estimator.getEstimate(config);

    expect(result.maxLamports).toBe(150_000); // 50_000 * 3
    expect(result.source).toBe('fallback');
  });

  it('caches estimate within TTL (does not call fetch again)', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({
        jsonrpc: '2.0',
        result: { priorityFeeEstimate: 5000 },
      }),
    });

    const estimator = new FeeEstimator('https://rpc.example.com', 5000);
    const config = makeConfig();

    // First call — should fetch
    await estimator.getEstimate(config);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Second call within TTL — should NOT fetch
    await estimator.getEstimate(config);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('refetches after cache TTL expires', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({
        jsonrpc: '2.0',
        result: { priorityFeeEstimate: 5000 },
      }),
    });

    const estimator = new FeeEstimator('https://rpc.example.com', 5000);
    const config = makeConfig();

    // First call
    await estimator.getEstimate(config);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Advance past TTL
    vi.advanceTimersByTime(5001);

    // Second call — should fetch again
    await estimator.getEstimate(config);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('caps estimate at maxPriorityFeeCapLamports', async () => {
    // 50_000 microlamports/CU * 200_000 CU / 1_000_000 = 10_000 lamports
    // But cap is 5_000 — should clamp
    const hugeEstimate = 50_000;
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        jsonrpc: '2.0',
        result: { priorityFeeEstimate: hugeEstimate },
      }),
    });

    const estimator = new FeeEstimator('https://rpc.example.com', 5000);
    const config = makeConfig({ cap: 5_000 });
    const result = await estimator.getEstimate(config);

    expect(result.maxLamports).toBe(5_000);
    expect(result.source).toBe('helius');
  });

  it('priorityFeeSol equals maxLamports / 1e9', async () => {
    // 2500 microlamports/CU * 200_000 CU / 1_000_000 = 500 lamports
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        jsonrpc: '2.0',
        result: { priorityFeeEstimate: 2500 },
      }),
    });

    const estimator = new FeeEstimator('https://rpc.example.com', 5000);
    const config = makeConfig();
    const result = await estimator.getEstimate(config);

    expect(result.priorityFeeSol).toBe(result.maxLamports / 1e9);
  });
});
