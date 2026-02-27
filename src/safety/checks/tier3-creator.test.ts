import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Blocklist } from '../../safety/blocklist.js';

// Mock global fetch before importing module under test
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { checkCreatorHistory } from './tier3-creator.js';

const MOCK_CREATOR = 'GThUX1Atko4tqhN2NaiTazFAcaPNtRDiMSCLDZPeHmKS';
const MOCK_HELIUS_KEY = 'test-helius-api-key';

/** Creates a mock Blocklist instance */
function makeMockBlocklist(hasResult = false): Blocklist {
  return {
    has: vi.fn().mockReturnValue(hasResult),
    add: vi.fn(),
    load: vi.fn(),
    size: 0,
  } as unknown as Blocklist;
}

/** Creates a mock TOKEN_MINT transaction with a given timestamp */
function makeMintTx(timestamp: number) {
  return {
    type: 'TOKEN_MINT',
    timestamp,
    signature: `sig_${timestamp}`,
  };
}

function mockJsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  };
}

describe('checkCreatorHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns neutral score (50) when creator is undefined (Raydium events)', async () => {
    const blocklist = makeMockBlocklist(false);
    const signal = new AbortController().signal;

    const result = await checkCreatorHistory(undefined, MOCK_HELIUS_KEY, blocklist, signal);

    expect(result.pass).toBe(true);
    expect(result.score).toBe(50);
    expect(result.source).toBe('creator_history');
    expect(result.detail).toBe('no_creator_in_event');
    // Should not call blocklist.has or fetch
    expect(blocklist.has).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns hard reject (pass=false, score=0) when creator is in blocklist', async () => {
    const blocklist = makeMockBlocklist(true); // creator IS in blocklist
    const signal = new AbortController().signal;

    const result = await checkCreatorHistory(MOCK_CREATOR, MOCK_HELIUS_KEY, blocklist, signal);

    expect(result.pass).toBe(false);
    expect(result.score).toBe(0);
    expect(result.source).toBe('creator_history');
    expect(result.detail).toBe('creator_blocklisted');
    expect(blocklist.has).toHaveBeenCalledWith(MOCK_CREATOR);
    // Should not call fetch (fast path)
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns neutral score (50) when HELIUS_API_KEY is not configured', async () => {
    const blocklist = makeMockBlocklist(false);
    const signal = new AbortController().signal;

    const result = await checkCreatorHistory(MOCK_CREATOR, undefined, blocklist, signal);

    expect(result.pass).toBe(true);
    expect(result.score).toBe(50);
    expect(result.source).toBe('creator_history');
    expect(result.detail).toBe('helius_key_not_configured');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns high score (80) for new creator with 0-1 prior mints', async () => {
    const blocklist = makeMockBlocklist(false);
    const signal = new AbortController().signal;
    const now = Math.floor(Date.now() / 1000);

    // Only 1 mint transaction
    mockFetch.mockResolvedValueOnce(mockJsonResponse(200, [makeMintTx(now - 3600)]));

    const result = await checkCreatorHistory(MOCK_CREATOR, MOCK_HELIUS_KEY, blocklist, signal);

    expect(result.pass).toBe(true);
    expect(result.score).toBe(80);
    expect(result.source).toBe('creator_history');
    expect(result.detail).toContain('1');
  });

  it('returns low score (20) for serial deployer with 4-9 prior mints', async () => {
    const blocklist = makeMockBlocklist(false);
    const signal = new AbortController().signal;
    const now = Math.floor(Date.now() / 1000);

    // 5 mint transactions
    const mints = Array.from({ length: 5 }, (_, i) => makeMintTx(now - (i + 1) * 3600));
    mockFetch.mockResolvedValueOnce(mockJsonResponse(200, mints));

    const result = await checkCreatorHistory(MOCK_CREATOR, MOCK_HELIUS_KEY, blocklist, signal);

    expect(result.pass).toBe(true);
    expect(result.score).toBe(20);
    expect(result.source).toBe('creator_history');
    expect(result.detail).toContain('5');
  });

  it('returns pass=false and adds creator to blocklist for 10+ prior mints (hard reject)', async () => {
    const blocklist = makeMockBlocklist(false);
    const signal = new AbortController().signal;
    const now = Math.floor(Date.now() / 1000);

    // 12 mint transactions — confirmed serial deployer
    const mints = Array.from({ length: 12 }, (_, i) => makeMintTx(now - (i + 1) * 3600));
    mockFetch.mockResolvedValueOnce(mockJsonResponse(200, mints));

    const result = await checkCreatorHistory(MOCK_CREATOR, MOCK_HELIUS_KEY, blocklist, signal);

    expect(result.pass).toBe(false);
    expect(result.score).toBe(0);
    expect(result.source).toBe('creator_history');
    expect(result.detail).toContain('12');
    // Must add creator to blocklist for future instant rejection
    expect(blocklist.add).toHaveBeenCalledWith(MOCK_CREATOR);
  });

  it('returns score=0 on API error (pessimistic)', async () => {
    const blocklist = makeMockBlocklist(false);
    const signal = new AbortController().signal;

    mockFetch.mockResolvedValueOnce(mockJsonResponse(403, { error: 'Forbidden' }));

    const result = await checkCreatorHistory(MOCK_CREATOR, MOCK_HELIUS_KEY, blocklist, signal);

    expect(result.pass).toBe(true);
    expect(result.score).toBe(0);
    expect(result.source).toBe('creator_history');
    expect(result.detail).toContain('403');
  });

  it('returns score=0 on timeout/network error (pessimistic)', async () => {
    const blocklist = makeMockBlocklist(false);
    const signal = new AbortController().signal;

    mockFetch.mockRejectedValueOnce(new Error('AbortError: signal aborted'));

    const result = await checkCreatorHistory(MOCK_CREATOR, MOCK_HELIUS_KEY, blocklist, signal);

    expect(result.pass).toBe(true);
    expect(result.score).toBe(0);
    expect(result.source).toBe('creator_history');
    expect(result.detail).toBe('timeout_or_error');
  });

  it('returns neutral score (50) when helius key is empty string', async () => {
    const blocklist = makeMockBlocklist(false);
    const signal = new AbortController().signal;

    const result = await checkCreatorHistory(MOCK_CREATOR, '', blocklist, signal);

    expect(result.pass).toBe(true);
    expect(result.score).toBe(50);
    expect(result.detail).toBe('helius_key_not_configured');
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
