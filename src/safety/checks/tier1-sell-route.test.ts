import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CheckResult } from '../../types/index.js';

// ---------------------------------------------------------------------------
// Hoist mock functions before vi.mock() factories run.
// ---------------------------------------------------------------------------
const { mockQuote } = vi.hoisted(() => ({
  mockQuote: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock the jupiter-client module so importing tier1-sell-route doesn't trigger
// env.ts validation (which calls process.exit(1) without SOLSNIPER_JUPITER_API_KEY).
// ---------------------------------------------------------------------------
vi.mock('../../execution/jupiter-client.js', () => ({
  jupiterClient: { quote: mockQuote },
}));

// Import after mocks are set up
import { checkSellRoute } from './tier1-sell-route.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MOCK_MINT = 'So11111111111111111111111111111111111111112';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('checkSellRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns pass=true when Jupiter returns 200', async () => {
    mockQuote.mockResolvedValueOnce({ outAmount: '1000000', routePlan: [] });

    const result: CheckResult = await checkSellRoute(MOCK_MINT);

    expect(result.pass).toBe(true);
    expect(result.source).toBe('jupiter_sell_route');
    expect(result.detail).toBe('route exists');
  });

  it('returns pass=false when Jupiter returns 400 (no route)', async () => {
    mockQuote.mockRejectedValueOnce(new Error('Jupiter quote HTTP 400'));

    const result: CheckResult = await checkSellRoute(MOCK_MINT);

    expect(result.pass).toBe(false);
    expect(result.source).toBe('jupiter_sell_route');
    expect(result.detail).toContain('400');
  });

  it('returns pass=false when Jupiter returns 500 (server error, pessimistic)', async () => {
    mockQuote.mockRejectedValueOnce(new Error('Jupiter quote HTTP 500'));

    const result: CheckResult = await checkSellRoute(MOCK_MINT);

    expect(result.pass).toBe(false);
    expect(result.source).toBe('jupiter_sell_route');
    expect(result.detail).toContain('500');
  });

  it('returns pass=false when fetch throws (network error, pessimistic)', async () => {
    mockQuote.mockRejectedValueOnce(new Error('network error'));

    const result: CheckResult = await checkSellRoute(MOCK_MINT);

    expect(result.pass).toBe(false);
    expect(result.source).toBe('jupiter_sell_route');
    expect(result.detail).toBe('network error');
  });

  it('returns pass=false when Jupiter is rate limited (429 cooldown)', async () => {
    mockQuote.mockRejectedValueOnce(new Error('Jupiter rate limited — cooldown active'));

    const result: CheckResult = await checkSellRoute(MOCK_MINT);

    expect(result.pass).toBe(false);
    expect(result.source).toBe('jupiter_sell_route');
    expect(result.detail).toContain('rate limited');
  });

  it('passes AbortSignal to jupiterClient.quote() when provided', async () => {
    mockQuote.mockResolvedValueOnce({ outAmount: '1000000' });

    const signal = AbortSignal.timeout(5000);
    await checkSellRoute(MOCK_MINT, signal);

    expect(mockQuote).toHaveBeenCalledWith(expect.any(URLSearchParams), signal);
  });

  it('includes the correct params with mint as inputMint and SOL as outputMint', async () => {
    mockQuote.mockResolvedValueOnce({ outAmount: '1000000' });

    await checkSellRoute(MOCK_MINT);

    const [params] = mockQuote.mock.calls[0] as [URLSearchParams, AbortSignal | undefined];
    expect(params.get('inputMint')).toBe(MOCK_MINT);
    expect(params.get('outputMint')).toBe('So11111111111111111111111111111111111111112');
  });
});
