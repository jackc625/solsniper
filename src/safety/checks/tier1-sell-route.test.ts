import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CheckResult } from '../../types/index.js';

// ---------------------------------------------------------------------------
// Mock global fetch before importing the module under test.
// ---------------------------------------------------------------------------
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Import after global mock is set up
import { checkSellRoute } from './tier1-sell-route.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFetchResponse(status: number, body: unknown = {}): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

const MOCK_MINT = 'So11111111111111111111111111111111111111112';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('checkSellRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns pass=true when Jupiter returns 200', async () => {
    mockFetch.mockResolvedValueOnce(
      makeFetchResponse(200, { outAmount: '1000000', routePlan: [] }),
    );

    const result: CheckResult = await checkSellRoute(MOCK_MINT);

    expect(result.pass).toBe(true);
    expect(result.source).toBe('jupiter_sell_route');
    expect(result.detail).toBe('route exists');
  });

  it('returns pass=false when Jupiter returns 400 (no route)', async () => {
    mockFetch.mockResolvedValueOnce(
      makeFetchResponse(400, { error: 'COULD_NOT_FIND_ANY_ROUTE' }),
    );

    const result: CheckResult = await checkSellRoute(MOCK_MINT);

    expect(result.pass).toBe(false);
    expect(result.source).toBe('jupiter_sell_route');
    expect(result.detail).toContain('no route');
  });

  it('returns pass=false when Jupiter returns 500 (server error, pessimistic)', async () => {
    mockFetch.mockResolvedValueOnce(makeFetchResponse(500));

    const result: CheckResult = await checkSellRoute(MOCK_MINT);

    expect(result.pass).toBe(false);
    expect(result.source).toBe('jupiter_sell_route');
    expect(result.detail).toContain('500');
  });

  it('returns pass=false when fetch throws (network error, pessimistic)', async () => {
    mockFetch.mockRejectedValueOnce(new Error('network error'));

    const result: CheckResult = await checkSellRoute(MOCK_MINT);

    expect(result.pass).toBe(false);
    expect(result.source).toBe('jupiter_sell_route');
    expect(result.detail).toBe('fetch_error');
  });

  it('passes AbortSignal to fetch when provided', async () => {
    mockFetch.mockResolvedValueOnce(makeFetchResponse(200));

    const signal = AbortSignal.timeout(5000);
    await checkSellRoute(MOCK_MINT, signal);

    const callArgs = mockFetch.mock.calls[0];
    expect(callArgs[1]).toHaveProperty('signal', signal);
  });

  it('includes the correct Jupiter API URL with mint as inputMint', async () => {
    mockFetch.mockResolvedValueOnce(makeFetchResponse(200));

    await checkSellRoute(MOCK_MINT);

    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(`inputMint=${MOCK_MINT}`);
    expect(url).toContain('api.jup.ag');
    expect(url).toContain('outputMint=So11111111111111111111111111111111111111112');
  });
});
