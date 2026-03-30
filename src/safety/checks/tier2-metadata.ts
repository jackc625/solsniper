import { PublicKey } from '@solana/web3.js';
import type { Connection } from '@solana/web3.js';
import type { CheckResult } from '../../types/index.js';

/**
 * Metaplex Token Metadata program ID.
 */
const METADATA_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');

/**
 * Scores token metadata mutability as a soft rug signal.
 *
 * Mutable metadata means the token creator can change name, symbol, URI
 * after launch -- a common pre-rug pattern where the token is rebranded
 * or the metadata URI is swapped to a different image/description.
 *
 * Applies to all sources (pumpportal, raydium, pumpswap) per D-18, D-24.
 * This is a scoring signal (pass is always true) -- penalty applied by pipeline orchestrator.
 *
 * Satisfies: SAF-14
 */
export async function checkMetadataMutability(
  mint: string,
  connection: Connection,
  signal?: AbortSignal,
): Promise<CheckResult> {
  try {
    // Derive Metaplex metadata PDA
    const mintPubkey = new PublicKey(mint);
    const [metadataPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('metadata'), METADATA_PROGRAM_ID.toBuffer(), mintPubkey.toBuffer()],
      METADATA_PROGRAM_ID,
    );

    const accountInfo = await connection.getAccountInfo(metadataPda);

    if (!accountInfo) {
      return {
        pass: true,
        score: 0,
        source: 'metadata_mutability',
        detail: 'account not found',
      };
    }

    const data = accountInfo.data as Buffer;
    const isMutable = parseIsMutable(data);

    if (isMutable === null) {
      return {
        pass: true,
        score: 0,
        source: 'metadata_mutability',
        detail: 'parse error',
      };
    }

    return {
      pass: true,
      score: isMutable ? 0 : 100,
      source: 'metadata_mutability',
      detail: `isMutable=${isMutable}`,
    };
  } catch (err: unknown) {
    return {
      pass: true,
      score: 0,
      source: 'metadata_mutability',
      detail: 'timeout_or_error',
    };
  }
}

/**
 * Parses the isMutable flag from Metaplex metadata account data using
 * sequential Borsh deserialization.
 *
 * Layout (per RESEARCH.md / Pitfall 2):
 *   key(1) + updateAuthority(32) + mint(32) + Data{
 *     name(4+len) + symbol(4+len) + uri(4+len) +
 *     sellerFeeBasisPoints(2) + creators(Option<Vec<Creator>>)
 *   } + primarySaleHappened(1) + isMutable(1)
 *
 * Each Creator = pubkey(32) + verified(1) + share(1) = 34 bytes.
 *
 * Returns null if the data is malformed or too short to parse.
 */
function parseIsMutable(data: Buffer): boolean | null {
  let offset = 0;

  // Minimum: key(1) + updateAuth(32) + mint(32) = 65 bytes before variable fields
  if (data.length < 66) return null;

  offset += 1;   // key
  offset += 32;  // updateAuthority
  offset += 32;  // mint

  // name (4-byte length prefix + variable string)
  if (offset + 4 > data.length) return null;
  const nameLen = data.readUInt32LE(offset);
  offset += 4 + nameLen;

  // symbol (4-byte length prefix + variable string)
  if (offset + 4 > data.length) return null;
  const symbolLen = data.readUInt32LE(offset);
  offset += 4 + symbolLen;

  // uri (4-byte length prefix + variable string)
  if (offset + 4 > data.length) return null;
  const uriLen = data.readUInt32LE(offset);
  offset += 4 + uriLen;

  // sellerFeeBasisPoints (2 bytes)
  if (offset + 2 > data.length) return null;
  offset += 2;

  // creators Option<Vec<Creator>>
  if (offset >= data.length) return null;
  const hasCreators = data.readUInt8(offset);
  offset += 1;

  if (hasCreators === 1) {
    if (offset + 4 > data.length) return null;
    const creatorsLen = data.readUInt32LE(offset);
    offset += 4;
    offset += creatorsLen * 34;  // Each Creator: 32 + 1 + 1 = 34 bytes
  }

  // primarySaleHappened (1 byte)
  if (offset >= data.length) return null;
  offset += 1;

  // isMutable (1 byte)
  if (offset >= data.length) return null;
  return data.readUInt8(offset) === 1;
}
