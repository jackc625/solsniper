import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import { env } from '../config/env.js';
import { createModuleLogger } from '../core/logger.js';

const log = createModuleLogger('wallet');

// Private cached keypair — never exposed directly
let _keypair: Keypair | null = null;

/**
 * Loads and caches the wallet keypair from SOLSNIPER_PRIVATE_KEY env var.
 * Only the public key is ever logged — the secret key is never exposed.
 * Throws if the private key is invalid, without including the key value in the error.
 */
export function getWallet(): Keypair {
  if (_keypair === null) {
    try {
      const secretKeyBytes = bs58.decode(env.SOLSNIPER_PRIVATE_KEY);
      _keypair = Keypair.fromSecretKey(secretKeyBytes);
      log.info({ publicKey: _keypair.publicKey.toBase58() }, 'Wallet loaded');
    } catch {
      // NEVER include the actual key value in the error message
      throw new Error('Failed to load wallet keypair: invalid private key format');
    }
  }
  return _keypair;
}

/**
 * Returns the wallet public key as a base58 string.
 * Safe to log — only exposes the public key.
 */
export function getWalletPublicKey(): string {
  return getWallet().publicKey.toBase58();
}
