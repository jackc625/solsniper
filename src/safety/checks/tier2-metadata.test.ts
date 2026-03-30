import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Connection } from '@solana/web3.js';

// ---------------------------------------------------------------------------
// Mock @solana/web3.js Connection
// ---------------------------------------------------------------------------
const { mockGetAccountInfo } = vi.hoisted(() => {
  const mockGetAccountInfo = vi.fn();
  return { mockGetAccountInfo };
});

const mockConnection = {
  getAccountInfo: mockGetAccountInfo,
} as unknown as Connection;

import { checkMetadataMutability } from './tier2-metadata.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MOCK_MINT = 'So11111111111111111111111111111111111111112';

/**
 * Build a mock Metaplex metadata account buffer with the sequential Borsh layout.
 */
function makeMetadataBuffer(opts: {
  name: string;
  symbol: string;
  uri: string;
  isMutable: boolean;
  creators?: number;
}): Buffer {
  const parts: Buffer[] = [];
  // key = MetadataV1 (4)
  parts.push(Buffer.from([4]));
  // updateAuthority (32 bytes)
  parts.push(Buffer.alloc(32));
  // mint (32 bytes)
  parts.push(Buffer.alloc(32));
  // name (4-byte length prefix + string)
  const nameBuf = Buffer.from(opts.name);
  const nameLen = Buffer.alloc(4);
  nameLen.writeUInt32LE(nameBuf.length);
  parts.push(nameLen, nameBuf);
  // symbol (4-byte length prefix + string)
  const symBuf = Buffer.from(opts.symbol);
  const symLen = Buffer.alloc(4);
  symLen.writeUInt32LE(symBuf.length);
  parts.push(symLen, symBuf);
  // uri (4-byte length prefix + string)
  const uriBuf = Buffer.from(opts.uri);
  const uriLen = Buffer.alloc(4);
  uriLen.writeUInt32LE(uriBuf.length);
  parts.push(uriLen, uriBuf);
  // sellerFeeBasisPoints (2 bytes)
  const fee = Buffer.alloc(2);
  fee.writeUInt16LE(500);
  parts.push(fee);
  // creators Option<Vec<Creator>>
  if (opts.creators !== undefined && opts.creators > 0) {
    parts.push(Buffer.from([1])); // Some
    const cLen = Buffer.alloc(4);
    cLen.writeUInt32LE(opts.creators);
    parts.push(cLen);
    parts.push(Buffer.alloc(opts.creators * 34)); // Each Creator: 32 + 1 + 1 = 34 bytes
  } else {
    parts.push(Buffer.from([0])); // None
  }
  // primarySaleHappened (1 byte)
  parts.push(Buffer.from([0]));
  // isMutable (1 byte)
  parts.push(Buffer.from([opts.isMutable ? 1 : 0]));
  return Buffer.concat(parts);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('checkMetadataMutability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('isMutable=true returns score=0 (penalty)', async () => {
    const data = makeMetadataBuffer({
      name: 'TestToken',
      symbol: 'TEST',
      uri: 'https://example.com/meta.json',
      isMutable: true,
    });
    mockGetAccountInfo.mockResolvedValueOnce({ data });

    const result = await checkMetadataMutability(MOCK_MINT, mockConnection);

    expect(result.pass).toBe(true);
    expect(result.score).toBe(0);
    expect(result.source).toBe('metadata_mutability');
    expect(result.detail).toContain('isMutable=true');
  });

  it('isMutable=false returns score=100 (no penalty)', async () => {
    const data = makeMetadataBuffer({
      name: 'TestToken',
      symbol: 'TEST',
      uri: 'https://example.com/meta.json',
      isMutable: false,
    });
    mockGetAccountInfo.mockResolvedValueOnce({ data });

    const result = await checkMetadataMutability(MOCK_MINT, mockConnection);

    expect(result.pass).toBe(true);
    expect(result.score).toBe(100);
    expect(result.source).toBe('metadata_mutability');
    expect(result.detail).toContain('isMutable=false');
  });

  it('account not found returns score=0 (pessimistic)', async () => {
    mockGetAccountInfo.mockResolvedValueOnce(null);

    const result = await checkMetadataMutability(MOCK_MINT, mockConnection);

    expect(result.pass).toBe(true);
    expect(result.score).toBe(0);
    expect(result.source).toBe('metadata_mutability');
    expect(result.detail).toContain('account not found');
  });

  it('malformed metadata (too short) returns score=0', async () => {
    // Buffer too short for metadata parsing
    const data = Buffer.alloc(30);
    mockGetAccountInfo.mockResolvedValueOnce({ data });

    const result = await checkMetadataMutability(MOCK_MINT, mockConnection);

    expect(result.pass).toBe(true);
    expect(result.score).toBe(0);
    expect(result.source).toBe('metadata_mutability');
    expect(result.detail).toContain('parse error');
  });

  it('works for all sources including pumpportal (no source skip)', async () => {
    const data = makeMetadataBuffer({
      name: 'PumpToken',
      symbol: 'PUMP',
      uri: 'https://pump.fun/meta.json',
      isMutable: false,
      creators: 1,
    });
    mockGetAccountInfo.mockResolvedValueOnce({ data });

    // No source-specific skip -- metadata check applies to all sources
    const result = await checkMetadataMutability(MOCK_MINT, mockConnection);

    expect(result.pass).toBe(true);
    expect(result.score).toBe(100);
    expect(result.source).toBe('metadata_mutability');
  });

  it('timeout/error returns pass=true, score=0', async () => {
    mockGetAccountInfo.mockRejectedValueOnce(new Error('timeout'));

    const result = await checkMetadataMutability(MOCK_MINT, mockConnection);

    expect(result.pass).toBe(true);
    expect(result.score).toBe(0);
    expect(result.source).toBe('metadata_mutability');
    expect(result.detail).toBe('timeout_or_error');
  });

  it('handles metadata with creators array correctly', async () => {
    const data = makeMetadataBuffer({
      name: 'CreatorToken',
      symbol: 'CRT',
      uri: 'https://example.com/creator.json',
      isMutable: true,
      creators: 2,
    });
    mockGetAccountInfo.mockResolvedValueOnce({ data });

    const result = await checkMetadataMutability(MOCK_MINT, mockConnection);

    expect(result.pass).toBe(true);
    expect(result.score).toBe(0);
    expect(result.detail).toContain('isMutable=true');
  });
});
