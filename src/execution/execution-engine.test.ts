import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Connection, Keypair } from '@solana/web3.js';
import type { TokenEvent } from '../types/index.js';
import type { TradingConfig } from '../config/trading.js';

// ---------------------------------------------------------------------------
// Hoisted mocks — declared before imports so vi.mock factories can reference them.
// ---------------------------------------------------------------------------
const { mockPumpPortalBuy, mockJupiterBuy } = vi.hoisted(() => {
  const mockPumpPortalBuy = vi.fn();
  const mockJupiterBuy = vi.fn();
  return { mockPumpPortalBuy, mockJupiterBuy };
});

vi.mock('./buy/pump-portal-buyer.js', () => ({
  pumpPortalBuy: mockPumpPortalBuy,
}));

vi.mock('./buy/jupiter-buyer.js', () => ({
  jupiterBuy: mockJupiterBuy,
}));

// ---------------------------------------------------------------------------
// Imports (after mocks are registered)
// ---------------------------------------------------------------------------
import { ExecutionEngine } from './execution-engine.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const mockWallet = {} as unknown as Keypair;
const mockConnections = [{} as unknown as Connection];

function makeTradingConfig(): TradingConfig {
  return {
    buyAmountSol: 0.1,
    maxSlippageBps: 1000,
    maxConcurrentPositions: 3,
    stopLossPct: -50,
    takeProfitPct: 300,
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
      holder: { top1SoftBlockThreshold: 0.25, top10SoftBlockThreshold: 0.50 },
      rugCheckScoreInverted: true,
      blocklistPath: './data/creator-blocklist.json',
    },
    execution: {
      buy: {
        slippageBps: 1000,
        priorityFeeBaseLamports: 100000,
        priorityFeeMultiplier: 1,
      },
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
}

function makeEvent(source: TokenEvent['source']): TokenEvent {
  return {
    mint: 'TestMint111111111111111',
    source,
    detectedAt: Date.now(),
  };
}

function makeTradeStore() {
  return { transition: vi.fn() };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ExecutionEngine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('routes to PumpPortal when source is pumpportal', async () => {
    mockPumpPortalBuy.mockResolvedValue({ success: true, signature: 'pump-sig' });

    const tradeStore = makeTradeStore();
    const engine = new ExecutionEngine(mockWallet, mockConnections, makeTradingConfig(), tradeStore as never);

    await engine.buy(makeEvent('pumpportal'));

    expect(mockPumpPortalBuy).toHaveBeenCalledOnce();
    expect(mockJupiterBuy).not.toHaveBeenCalled();
  });

  it('routes to Jupiter when source is raydium', async () => {
    mockJupiterBuy.mockResolvedValue({ success: true, signature: 'jup-sig' });

    const tradeStore = makeTradeStore();
    const engine = new ExecutionEngine(mockWallet, mockConnections, makeTradingConfig(), tradeStore as never);

    await engine.buy(makeEvent('raydium'));

    expect(mockJupiterBuy).toHaveBeenCalledOnce();
    expect(mockPumpPortalBuy).not.toHaveBeenCalled();
  });

  it('routes to Jupiter when source is pumpswap', async () => {
    mockJupiterBuy.mockResolvedValue({ success: true, signature: 'jup-sig' });

    const tradeStore = makeTradeStore();
    const engine = new ExecutionEngine(mockWallet, mockConnections, makeTradingConfig(), tradeStore as never);

    await engine.buy(makeEvent('pumpswap'));

    expect(mockJupiterBuy).toHaveBeenCalledOnce();
    expect(mockPumpPortalBuy).not.toHaveBeenCalled();
  });

  it('success path — transitions BUYING → MONITORING with buySignature', async () => {
    mockPumpPortalBuy.mockResolvedValue({
      success: true,
      signature: 'sig123',
      amountTokens: 5000000,
    });

    const tradeStore = makeTradeStore();
    const engine = new ExecutionEngine(mockWallet, mockConnections, makeTradingConfig(), tradeStore as never);

    await engine.buy(makeEvent('pumpportal'));

    expect(tradeStore.transition).toHaveBeenCalledOnce();
    expect(tradeStore.transition).toHaveBeenCalledWith(
      'TestMint111111111111111',
      'BUYING',
      'MONITORING',
      expect.objectContaining({ buySignature: 'sig123' })
    );
  });

  it('failure path (buy returns false) — transitions BUYING → FAILED with BUY_FAILED message', async () => {
    mockPumpPortalBuy.mockResolvedValue({
      success: false,
      errorMessage: 'PumpPortal HTTP 400',
    });

    const tradeStore = makeTradeStore();
    const engine = new ExecutionEngine(mockWallet, mockConnections, makeTradingConfig(), tradeStore as never);

    await engine.buy(makeEvent('pumpportal'));

    expect(tradeStore.transition).toHaveBeenCalledOnce();
    expect(tradeStore.transition).toHaveBeenCalledWith(
      'TestMint111111111111111',
      'BUYING',
      'FAILED',
      expect.objectContaining({ errorMessage: 'BUY_FAILED: PumpPortal HTTP 400' })
    );
  });

  it('failure path (buy throws) — transitions BUYING → FAILED with BUY_FAILED message', async () => {
    mockPumpPortalBuy.mockRejectedValue(new Error('Network timeout'));

    const tradeStore = makeTradeStore();
    const engine = new ExecutionEngine(mockWallet, mockConnections, makeTradingConfig(), tradeStore as never);

    await engine.buy(makeEvent('pumpportal'));

    expect(tradeStore.transition).toHaveBeenCalledOnce();
    expect(tradeStore.transition).toHaveBeenCalledWith(
      'TestMint111111111111111',
      'BUYING',
      'FAILED',
      expect.objectContaining({ errorMessage: 'BUY_FAILED: Network timeout' })
    );
  });
});
