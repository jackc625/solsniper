import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock global fetch before importing module under test
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { checkRugCheck, _resetCircuitBreaker } from './tier2-rugcheck.js';
import type { RugCheckResultData } from './tier2-rugcheck.js';

const MOCK_MINT = 'So11111111111111111111111111111111111111112';
const MOCK_API_KEY = 'test-api-key-12345';

function makeSuccessResponse(scoreNormalised: number, riskCount: number, lpLockedPct = 0) {
  return {
    score: scoreNormalised * 1000, // raw score (not used directly)
    score_normalised: scoreNormalised,
    lpLockedPct,
    risks: Array.from({ length: riskCount }, (_, i) => ({
      name: `risk_${i}`,
      level: 'medium',
      description: 'Test risk',
      score: 10,
    })),
  };
}

function mockResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    headers: { get: () => null },
  };
}

describe('checkRugCheck', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetCircuitBreaker();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns inverted score (100 - score_normalised) on successful response', async () => {
    const scoreNormalised = 40; // 40% risk
    mockFetch.mockResolvedValueOnce(mockResponse(200, makeSuccessResponse(scoreNormalised, 3)));

    const signal = new AbortController().signal;
    const [result, data] = await checkRugCheck(MOCK_MINT, MOCK_API_KEY, signal);

    expect(result.pass).toBe(true);
    expect(result.score).toBe(100 - scoreNormalised); // 60 safety score
    expect(result.source).toBe('rugcheck');
    expect(result.detail).toContain(String(scoreNormalised));
    expect(data).not.toBeNull();
    expect(data!.risks).toHaveLength(3);
  });

  it('returns score=0 on non-200 response (pessimistic) after retry', async () => {
    // First call returns 500, retry also returns 500
    mockFetch
      .mockResolvedValueOnce(mockResponse(500, { error: 'internal server error' }))
      .mockResolvedValueOnce(mockResponse(500, { error: 'internal server error' }));

    const signal = new AbortController().signal;
    const [result, data] = await checkRugCheck(MOCK_MINT, MOCK_API_KEY, signal);

    expect(result.pass).toBe(true); // still pass=true (scoring signal, not hard block)
    expect(result.score).toBe(0);
    expect(result.source).toBe('rugcheck');
    expect(result.detail).toContain('500');
    expect(data).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(2); // original + 1 retry
  });

  it('returns score=0 on fetch error/timeout (pessimistic)', async () => {
    mockFetch.mockRejectedValueOnce(new Error('network failure'));

    const signal = new AbortController().signal;
    const [result, data] = await checkRugCheck(MOCK_MINT, MOCK_API_KEY, signal);

    expect(result.pass).toBe(true);
    expect(result.score).toBe(0);
    expect(result.source).toBe('rugcheck');
    expect(result.detail).toBe('timeout_or_error');
    expect(data).toBeNull();
  });

  it('sends key as ?key= query param when apiKey provided', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(200, makeSuccessResponse(20, 1)));

    const signal = new AbortController().signal;
    await checkRugCheck(MOCK_MINT, MOCK_API_KEY, signal);

    expect(mockFetch).toHaveBeenCalledOnce();
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain(`key=${MOCK_API_KEY}`);
    // No X-API-KEY header should be sent anymore
    const options = mockFetch.mock.calls[0][1] as RequestInit | undefined;
    const headers = (options?.headers ?? {}) as Record<string, string>;
    expect(headers['X-API-KEY']).toBeUndefined();
  });

  it('sends no key param in public mode when apiKey omitted', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(200, makeSuccessResponse(10, 0)));

    const signal = new AbortController().signal;
    const [result] = await checkRugCheck(MOCK_MINT, undefined, signal);

    expect(result.pass).toBe(true);
    expect(result.score).toBe(90);

    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).not.toContain('key=');
  });

  it('emits auth_failure alert and stays pass=true on HTTP 401', async () => {
    // 401 is NOT in the retry set, so fetch is called exactly once.
    mockFetch.mockResolvedValueOnce(mockResponse(401, { error: 'invalid api key' }));
    const mockAlert = vi.fn();

    const signal = new AbortController().signal;
    const [result, data] = await checkRugCheck(
      MOCK_MINT,
      MOCK_API_KEY,
      signal,
      undefined,
      mockAlert,
    );

    // Safety semantics unchanged: still pass=true, score=0 (diagnosability only).
    expect(result.pass).toBe(true);
    expect(result.score).toBe(0);
    expect(result.source).toBe('rugcheck');
    expect(result.detail).toBe('HTTP 401');
    expect(data).toBeNull();

    // Loud, diagnosable alert naming the env var.
    expect(mockAlert).toHaveBeenCalledWith(
      'rugcheck:report',
      'auth_failure',
      expect.stringContaining('RUGCHECK_API_KEY'),
    );

    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('clamps score to 0-100 range', async () => {
    // score_normalised of 0 -> safety score = 100
    mockFetch.mockResolvedValueOnce(mockResponse(200, makeSuccessResponse(0, 0)));

    const signal = new AbortController().signal;
    const [result] = await checkRugCheck(MOCK_MINT, MOCK_API_KEY, signal);

    expect(result.score).toBe(100);

    // score_normalised of 100 -> safety score = 0
    mockFetch.mockResolvedValueOnce(mockResponse(200, makeSuccessResponse(100, 10)));
    const [result2] = await checkRugCheck(MOCK_MINT, MOCK_API_KEY, signal);
    expect(result2.score).toBe(0);
  });

  it('returns lpLockedPct in RugCheckResultData on success', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(200, makeSuccessResponse(20, 2, 95)));

    const signal = new AbortController().signal;
    const [result, data] = await checkRugCheck(MOCK_MINT, MOCK_API_KEY, signal);

    expect(result.pass).toBe(true);
    expect(result.score).toBe(80);
    expect(data).not.toBeNull();
    expect(data!.lpLockedPct).toBe(95);
    expect(data!.risks).toHaveLength(2);
    expect(data!.risks[0].name).toBe('risk_0');
  });

  it('defaults lpLockedPct to 0 when API response omits it', async () => {
    const responseBody = {
      score: 20000,
      score_normalised: 20,
      risks: [{ name: 'test_risk', level: 'low', description: 'Test', score: 5 }],
      // lpLockedPct intentionally omitted
    };
    mockFetch.mockResolvedValueOnce(mockResponse(200, responseBody));

    const signal = new AbortController().signal;
    const [result, data] = await checkRugCheck(MOCK_MINT, MOCK_API_KEY, signal);

    expect(result.pass).toBe(true);
    expect(data).not.toBeNull();
    expect(data!.lpLockedPct).toBe(0);
  });
});
