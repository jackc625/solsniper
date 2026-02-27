import type { SafetyResult } from '../types/index.js';

interface CacheEntry {
  result: SafetyResult;
  expiresAt: number;
}

/**
 * TTL-based in-memory cache for SafetyResult objects, keyed by mint address.
 * Prevents re-running safety checks on duplicate token detections within the TTL window.
 */
export class SafetyCache {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly ttlMs: number;

  constructor(ttlMs: number) {
    this.ttlMs = ttlMs;
  }

  /**
   * Returns the cached SafetyResult for the given mint if it has not expired.
   * Deletes the entry and returns null if expired.
   */
  get(mint: string): SafetyResult | null {
    const entry = this.cache.get(mint);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(mint);
      return null;
    }
    return entry.result;
  }

  /**
   * Stores a SafetyResult for the given mint with an expiry of now + ttlMs.
   */
  set(mint: string, result: SafetyResult): void {
    this.cache.set(mint, { result, expiresAt: Date.now() + this.ttlMs });
  }

  /**
   * Clears all cache entries.
   */
  clear(): void {
    this.cache.clear();
  }

  /** Number of entries currently in cache (including potentially expired ones). */
  get size(): number {
    return this.cache.size;
  }
}
