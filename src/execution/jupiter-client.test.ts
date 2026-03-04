import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock the env module BEFORE importing anything that touches it.
// env.ts calls process.exit(1) on validation failure — mock prevents that.
// logger.ts also imports env (for LOG_LEVEL/NODE_ENV), so include those too.
// ---------------------------------------------------------------------------
vi.mock('../config/env.js', () => ({
  env: {
    SOLSNIPER_JUPITER_API_KEY: 'test-api-key',
    LOG_LEVEL: 'error',
    NODE_ENV: 'development',
  },
}));

// ---------------------------------------------------------------------------
// Mock global fetch before importing the module under test.
// ---------------------------------------------------------------------------
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Import after mocks are set up
import { JupiterClient } from './jupiter-client.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFetchResponse(
  status: number,
  body: unknown = {},
  headers: Record<string, string> = {},
): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {
      get: (name: string) => headers[name.toLowerCase()] ?? null,
    },
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('JupiterClient', () => {
  let client: JupiterClient;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    client = new JupiterClient();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // --- quote() auth header ---------------------------------------------------

  it('quote() includes x-api-key header in fetch call', async () => {
    mockFetch.mockResolvedValueOnce(
      makeFetchResponse(200, { outAmount: '1000000' }),
    );

    const params = new URLSearchParams({ inputMint: 'ABC', outputMint: 'DEF', amount: '1000' });
    await client.quote(params);

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['x-api-key']).toBe('test-api-key');
  });

  it('quote() returns parsed JSON on 200', async () => {
    const body = { outAmount: '1000000', routePlan: [] };
    mockFetch.mockResolvedValueOnce(makeFetchResponse(200, body));

    const params = new URLSearchParams({ inputMint: 'ABC', outputMint: 'DEF', amount: '1000' });
    const result = await client.quote(params);

    expect(result).toEqual(body);
  });

  it('quote() throws on non-2xx (400)', async () => {
    mockFetch.mockResolvedValueOnce(makeFetchResponse(400));

    const params = new URLSearchParams({ inputMint: 'ABC', outputMint: 'DEF', amount: '1000' });

    await expect(client.quote(params)).rejects.toThrow('Jupiter quote HTTP 400');
  });

  it('quote() throws on non-2xx (500)', async () => {
    mockFetch.mockResolvedValueOnce(makeFetchResponse(500));

    const params = new URLSearchParams({ inputMint: 'ABC', outputMint: 'DEF', amount: '1000' });

    await expect(client.quote(params)).rejects.toThrow('Jupiter quote HTTP 500');
  });

  // --- quote() 429 / cooldown -----------------------------------------------

  it('quote() triggers cooldown on 429 and subsequent calls throw without fetching', async () => {
    mockFetch.mockResolvedValueOnce(makeFetchResponse(429));

    const params = new URLSearchParams({ inputMint: 'ABC', outputMint: 'DEF', amount: '1000' });

    await expect(client.quote(params)).rejects.toThrow('Jupiter rate limited (429)');

    // Second call should throw immediately WITHOUT calling fetch
    await expect(client.quote(params)).rejects.toThrow('Jupiter rate limited -- cooldown active');
    expect(mockFetch).toHaveBeenCalledTimes(1); // Only the first call hit the network
  });

  it('quote() respects Retry-After header (converts seconds to ms)', async () => {
    mockFetch.mockResolvedValueOnce(
      makeFetchResponse(429, {}, { 'retry-after': '30' }),
    );

    const params = new URLSearchParams({ inputMint: 'ABC', outputMint: 'DEF', amount: '1000' });
    await expect(client.quote(params)).rejects.toThrow('Jupiter rate limited (429)');

    // Should still be in cooldown 29s later
    vi.advanceTimersByTime(29_000);
    expect(client.isRateLimited()).toBe(true);
    expect(client.cooldownRemainingMs()).toBeGreaterThan(0);

    // Should be clear after 30s
    vi.advanceTimersByTime(1_001);
    expect(client.isRateLimited()).toBe(false);
    expect(client.cooldownRemainingMs()).toBe(0);
  });

  it('quote() falls back to 10s cooldown when no Retry-After header', async () => {
    mockFetch.mockResolvedValueOnce(makeFetchResponse(429));

    const params = new URLSearchParams({ inputMint: 'ABC', outputMint: 'DEF', amount: '1000' });
    await expect(client.quote(params)).rejects.toThrow('Jupiter rate limited (429)');

    vi.advanceTimersByTime(9_000);
    expect(client.isRateLimited()).toBe(true);

    vi.advanceTimersByTime(1_001);
    expect(client.isRateLimited()).toBe(false);
  });

  // --- quote() AbortSignal --------------------------------------------------

  it('quote() passes AbortSignal to fetch when provided', async () => {
    mockFetch.mockResolvedValueOnce(makeFetchResponse(200, { outAmount: '999' }));

    const signal = AbortSignal.timeout(5000);
    const params = new URLSearchParams({ inputMint: 'ABC', outputMint: 'DEF', amount: '1000' });
    await client.quote(params, signal);

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBe(signal);
  });

  // --- swap() ---------------------------------------------------------------

  it('swap() includes x-api-key and Content-Type headers', async () => {
    const body = { swapTransaction: 'base64encodedtx==' };
    mockFetch.mockResolvedValueOnce(makeFetchResponse(200, body));

    await client.swap({ quoteResponse: {} });

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('test-api-key');
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('swap() returns { swapTransaction } on 200', async () => {
    const body = { swapTransaction: 'base64encodedtx==' };
    mockFetch.mockResolvedValueOnce(makeFetchResponse(200, body));

    const result = await client.swap({ quoteResponse: {} });

    expect(result).toEqual(body);
    expect(result.swapTransaction).toBe('base64encodedtx==');
  });

  it('swap() triggers cooldown on 429', async () => {
    mockFetch.mockResolvedValueOnce(makeFetchResponse(429));

    await expect(client.swap({ quoteResponse: {} })).rejects.toThrow('Jupiter rate limited (429)');
    expect(client.isRateLimited()).toBe(true);
  });

  it('swap() throws when in cooldown', async () => {
    // Trigger cooldown via quote()
    mockFetch.mockResolvedValueOnce(makeFetchResponse(429));
    const params = new URLSearchParams({ inputMint: 'ABC', outputMint: 'DEF', amount: '1000' });
    await expect(client.quote(params)).rejects.toThrow('Jupiter rate limited (429)');

    // swap() should throw without fetching
    await expect(client.swap({ quoteResponse: {} })).rejects.toThrow(
      'Jupiter rate limited -- cooldown active',
    );
    expect(mockFetch).toHaveBeenCalledTimes(1); // Only the initial 429 hit the network
  });

  // --- isRateLimited / cooldownRemainingMs ----------------------------------

  it('isRateLimited() returns false when not in cooldown', () => {
    expect(client.isRateLimited()).toBe(false);
  });

  it('isRateLimited() returns true during cooldown, false after it expires', async () => {
    mockFetch.mockResolvedValueOnce(makeFetchResponse(429));
    const params = new URLSearchParams({ inputMint: 'ABC', outputMint: 'DEF', amount: '1000' });
    await expect(client.quote(params)).rejects.toThrow();

    expect(client.isRateLimited()).toBe(true);

    vi.advanceTimersByTime(10_001);
    expect(client.isRateLimited()).toBe(false);
  });

  it('cooldownRemainingMs() returns 0 when not in cooldown', () => {
    expect(client.cooldownRemainingMs()).toBe(0);
  });

  it('cooldownRemainingMs() returns positive value during cooldown', async () => {
    mockFetch.mockResolvedValueOnce(makeFetchResponse(429));
    const params = new URLSearchParams({ inputMint: 'ABC', outputMint: 'DEF', amount: '1000' });
    await expect(client.quote(params)).rejects.toThrow();

    expect(client.cooldownRemainingMs()).toBeGreaterThan(0);
  });

  // --- quote() 400 — JupiterRouteError --------------------------------------

  it('quote() on 400 with { errorCode } throws JupiterRouteError with parsed code', async () => {
    mockFetch.mockResolvedValueOnce(
      makeFetchResponse(400, { errorCode: 'TOKEN_NOT_TRADABLE' }),
    );

    const params = new URLSearchParams({ inputMint: 'ABC', outputMint: 'DEF', amount: '1000' });
    const { JupiterRouteError } = await import('./jupiter-client.js');

    await expect(client.quote(params)).rejects.toThrow(JupiterRouteError);

    try {
      mockFetch.mockResolvedValueOnce(makeFetchResponse(400, { errorCode: 'TOKEN_NOT_TRADABLE' }));
      await client.quote(params);
    } catch (err) {
      const { JupiterRouteError: RouteErr } = await import('./jupiter-client.js');
      expect(err).toBeInstanceOf(RouteErr);
      expect((err as InstanceType<typeof RouteErr>).code).toBe('TOKEN_NOT_TRADABLE');
    }
  });

  it('quote() on 400 with non-JSON body throws JupiterRouteError with code=undefined', async () => {
    const response = {
      status: 400,
      ok: false,
      headers: { get: () => null },
      json: vi.fn().mockRejectedValue(new Error('not JSON')),
    } as unknown as Response;
    mockFetch.mockResolvedValueOnce(response);

    const { JupiterRouteError } = await import('./jupiter-client.js');
    const params = new URLSearchParams({ inputMint: 'ABC', outputMint: 'DEF', amount: '1000' });

    try {
      await client.quote(params);
    } catch (err) {
      expect(err).toBeInstanceOf(JupiterRouteError);
      expect((err as InstanceType<typeof JupiterRouteError>).code).toBeUndefined();
    }
  });

  it('quote() on 500 throws generic Error (not JupiterRouteError)', async () => {
    mockFetch.mockResolvedValueOnce(makeFetchResponse(500));

    const params = new URLSearchParams({ inputMint: 'ABC', outputMint: 'DEF', amount: '1000' });
    const { JupiterRouteError } = await import('./jupiter-client.js');

    try {
      await client.quote(params);
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).not.toBeInstanceOf(JupiterRouteError);
      expect(err).toBeInstanceOf(Error);
    }
  });

  it('JupiterRouteError has name JupiterRouteError and is instanceof works', async () => {
    const { JupiterRouteError } = await import('./jupiter-client.js');
    const err = new JupiterRouteError('test message', 'NO_ROUTES_FOUND');
    expect(err.name).toBe('JupiterRouteError');
    expect(err).toBeInstanceOf(JupiterRouteError);
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('NO_ROUTES_FOUND');
  });

  // --- Cross-method global state --------------------------------------------

  it('cooldown from quote() blocks swap() (global state)', async () => {
    // quote() 429 triggers cooldown
    mockFetch.mockResolvedValueOnce(makeFetchResponse(429));
    const params = new URLSearchParams({ inputMint: 'ABC', outputMint: 'DEF', amount: '1000' });
    await expect(client.quote(params)).rejects.toThrow('Jupiter rate limited (429)');

    // swap() must also be blocked
    await expect(client.swap({ quoteResponse: {} })).rejects.toThrow(
      'Jupiter rate limited -- cooldown active',
    );
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('cooldown expires after duration', async () => {
    mockFetch.mockResolvedValueOnce(makeFetchResponse(429));
    const body = { outAmount: '500' };
    mockFetch.mockResolvedValueOnce(makeFetchResponse(200, body));

    const params = new URLSearchParams({ inputMint: 'ABC', outputMint: 'DEF', amount: '1000' });
    await expect(client.quote(params)).rejects.toThrow('Jupiter rate limited (429)');

    // Advance past the 10s default cooldown
    vi.advanceTimersByTime(10_001);

    // Now quote should succeed
    const result = await client.quote(params);
    expect(result).toEqual(body);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
