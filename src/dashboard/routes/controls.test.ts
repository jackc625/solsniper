import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

// Mock env.js to prevent process.exit(1) on missing env vars in worktree
vi.mock('../../config/env.js', () => ({
  env: {
    SOLSNIPER_RPC_URL: 'http://localhost:8899',
    SOLSNIPER_RPC_BACKUP_URL: 'http://localhost:8899',
    SOLSNIPER_PRIVATE_KEY: 'test-key',
    SOLSNIPER_JUPITER_API_KEY: 'test-api-key',
    LOG_LEVEL: 'error',
    NODE_ENV: 'development',
  },
}));

import { controlsRoute } from './controls.js';
import type { Trade } from '../../types/index.js';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function makeTrade(overrides: Partial<Trade> = {}): Trade {
  return {
    id: 1,
    mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    state: 'MONITORING',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    amountSol: 1.0,
    amountTokens: 1_000_000,
    ...overrides,
  };
}

describe('controls route', () => {
  let fastify: FastifyInstance;
  let mockGetDetectionPaused: ReturnType<typeof vi.fn>;
  let mockSetDetectionPaused: ReturnType<typeof vi.fn>;
  let mockIsSellInFlight: ReturnType<typeof vi.fn>;
  let mockTriggerSell: ReturnType<typeof vi.fn>;
  let mockGetTradeById: ReturnType<typeof vi.fn>;
  let mockGetMonitoringTrades: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    mockGetDetectionPaused = vi.fn().mockReturnValue(false);
    mockSetDetectionPaused = vi.fn();
    mockIsSellInFlight = vi.fn().mockReturnValue(false);
    mockTriggerSell = vi.fn();
    mockGetTradeById = vi.fn();
    mockGetMonitoringTrades = vi.fn().mockReturnValue([]);

    fastify = Fastify();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await fastify.register(controlsRoute, {
      tradeStore: {
        getTradeById: mockGetTradeById,
        getMonitoringTrades: mockGetMonitoringTrades,
      },
      getDetectionPaused: mockGetDetectionPaused,
      setDetectionPaused: mockSetDetectionPaused,
      isSellInFlight: mockIsSellInFlight,
      triggerSell: mockTriggerSell,
      prefix: '/api',
    } as any);
    await fastify.ready();
  });

  afterEach(async () => {
    await fastify.close();
  });

  // --- Test 1: POST /api/controls/detection pause ---
  it('POST /api/controls/detection with paused=true sets paused flag', async () => {
    const res = await fastify.inject({
      method: 'POST',
      url: '/api/controls/detection',
      payload: { paused: true },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body).toEqual({ ok: true, paused: true });
    expect(mockSetDetectionPaused).toHaveBeenCalledWith(true);
  });

  // --- Test 2: POST /api/controls/detection resume ---
  it('POST /api/controls/detection with paused=false clears paused flag', async () => {
    mockGetDetectionPaused.mockReturnValue(true);

    const res = await fastify.inject({
      method: 'POST',
      url: '/api/controls/detection',
      payload: { paused: false },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body).toEqual({ ok: true, paused: false });
    expect(mockSetDetectionPaused).toHaveBeenCalledWith(false);
  });

  // --- Test 3: GET /api/controls/status ---
  it('GET /api/controls/status returns current paused state', async () => {
    mockGetDetectionPaused.mockReturnValue(true);

    const res = await fastify.inject({
      method: 'GET',
      url: '/api/controls/status',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body).toEqual({ paused: true });
  });

  // --- Test 4: POST /api/trades/:id/force-sell with valid MONITORING trade ---
  it('POST /api/trades/:id/force-sell triggers sell for MONITORING trade', async () => {
    const trade = makeTrade({ id: 42 });
    mockGetTradeById.mockReturnValue(trade);

    const res = await fastify.inject({
      method: 'POST',
      url: '/api/trades/42/force-sell',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.ok).toBe(true);
    expect(body.tradeId).toBe(42);
    expect(mockTriggerSell).toHaveBeenCalledWith(trade.mint, BigInt(trade.amountTokens!));
  });

  // --- Test 5: POST /api/trades/:id/force-sell when sellInFlight returns 409 ---
  it('POST /api/trades/:id/force-sell returns 409 when sell is in flight', async () => {
    const trade = makeTrade({ id: 42 });
    mockGetTradeById.mockReturnValue(trade);
    mockIsSellInFlight.mockReturnValue(true);

    const res = await fastify.inject({
      method: 'POST',
      url: '/api/trades/42/force-sell',
    });

    expect(res.statusCode).toBe(409);
    const body = JSON.parse(res.payload);
    expect(body.error).toBe('Position is already being sold');
  });

  // --- Test 6: POST /api/trades/:id/force-sell with non-existent trade returns 404 ---
  it('POST /api/trades/:id/force-sell returns 404 for non-existent trade', async () => {
    mockGetTradeById.mockReturnValue(undefined);

    const res = await fastify.inject({
      method: 'POST',
      url: '/api/trades/999/force-sell',
    });

    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.payload);
    expect(body.error).toBe('Trade not found');
  });

  // --- Test 7: POST /api/trades/:id/force-sell with COMPLETED trade returns 400 ---
  it('POST /api/trades/:id/force-sell returns 400 for non-MONITORING trade', async () => {
    const trade = makeTrade({ id: 42, state: 'COMPLETED' });
    mockGetTradeById.mockReturnValue(trade);

    const res = await fastify.inject({
      method: 'POST',
      url: '/api/trades/42/force-sell',
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.payload);
    expect(body.error).toBe('Trade is not in MONITORING state');
  });

  // --- Test 8: POST /api/controls/emergency-stop ---
  it('POST /api/controls/emergency-stop pauses and sells all MONITORING trades', async () => {
    const trade1 = makeTrade({ id: 1, mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', amountTokens: 1_000_000 });
    const trade2 = makeTrade({ id: 2, mint: '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs', amountTokens: 2_000_000 });
    mockGetMonitoringTrades.mockReturnValue([trade1, trade2]);

    const res = await fastify.inject({
      method: 'POST',
      url: '/api/controls/emergency-stop',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);

    // Detection must be paused
    expect(body.paused).toBe(true);
    expect(mockSetDetectionPaused).toHaveBeenCalledWith(true);

    // Both trades should have sell triggered
    expect(body.sellResults).toHaveLength(2);
    expect(body.sellResults[0].status).toBe('triggered');
    expect(body.sellResults[1].status).toBe('triggered');
    expect(mockTriggerSell).toHaveBeenCalledTimes(2);
  });

  // --- Test 9 (idempotency): POST /api/controls/detection when already paused ---
  it('POST /api/controls/detection with paused=true when already paused returns same success response', async () => {
    // Arrange: detection is already paused
    mockGetDetectionPaused.mockReturnValue(true);

    // Act: request to pause again
    const res = await fastify.inject({
      method: 'POST',
      url: '/api/controls/detection',
      payload: { paused: true },
    });

    // Assert: idempotent success — same response, no error
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body).toEqual({ ok: true, paused: true });
    expect(mockSetDetectionPaused).toHaveBeenCalledWith(true);
  });

  // --- Test 10 (idempotency): POST /api/controls/emergency-stop when already paused ---
  it('POST /api/controls/emergency-stop when detection is already paused still processes sells and returns summary', async () => {
    // Arrange: detection already paused, one MONITORING trade exists
    mockGetDetectionPaused.mockReturnValue(true);
    const trade = makeTrade({ id: 5, mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', amountTokens: 500_000 });
    mockGetMonitoringTrades.mockReturnValue([trade]);

    // Act: emergency-stop called again
    const res = await fastify.inject({
      method: 'POST',
      url: '/api/controls/emergency-stop',
    });

    // Assert: still returns paused=true and sellResults for existing positions
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.paused).toBe(true);
    expect(mockSetDetectionPaused).toHaveBeenCalledWith(true);
    expect(body.sellResults).toHaveLength(1);
    expect(body.sellResults[0].status).toBe('triggered');
    expect(mockTriggerSell).toHaveBeenCalledTimes(1);
  });

  // --- Test 11 (partial failure): POST /api/controls/emergency-stop with one sell throwing ---
  it('POST /api/controls/emergency-stop returns mixed sellResults when one triggerSell throws', async () => {
    // Arrange: two MONITORING trades, first sell will throw, second will succeed
    const trade1 = makeTrade({ id: 10, mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', amountTokens: 1_000_000 });
    const trade2 = makeTrade({ id: 11, mint: '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs', amountTokens: 2_000_000 });
    mockGetMonitoringTrades.mockReturnValue([trade1, trade2]);
    mockTriggerSell
      .mockImplementationOnce(() => { throw new Error('RPC error on first sell'); })
      .mockImplementationOnce(() => { /* success, no-op */ });

    // Act
    const res = await fastify.inject({
      method: 'POST',
      url: '/api/controls/emergency-stop',
    });

    // Assert: response is 200 with mixed statuses (partial failure does not fail the whole request)
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.paused).toBe(true);
    expect(body.sellResults).toHaveLength(2);

    const statuses = body.sellResults.map((r: { status: string }) => r.status);
    expect(statuses).toContain('failed');
    expect(statuses).toContain('triggered');
  });
});
