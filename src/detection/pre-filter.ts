import type { TokenEvent } from '../types/index.js';

export interface PreFilterResult {
  pass: boolean;
  reason?: string;
}

// Well-known token names that scammers impersonate (case-insensitive exact match against name/symbol)
const IMPERSONATION_TARGETS = new Set(['SOL', 'USDC', 'USDT', 'BONK', 'WIF', 'JUP', 'RAY', 'PYTH', 'JTO', 'MSOLANA', 'MSOL']);

// Spam/scam keywords that appear in names/symbols -- checked as substring (case-insensitive)
const SPAM_KEYWORDS = ['FREE', 'AIRDROP', 'GIVEAWAY', 'CLAIM', 'REWARD'];

/**
 * Basic junk token pre-filter. Drops obvious scam/spam tokens before they reach
 * the full safety pipeline in Phase 3.
 *
 * Design decisions:
 * - Returns pass:true for events with no name/symbol -- PumpPortal fields are medium-confidence
 *   and we should not filter tokens we can't evaluate (Phase 3 handles deep analysis).
 * - Minimal checks only -- the safety pipeline in Phase 3 does comprehensive analysis.
 *   This is junk rejection only, not safety analysis.
 */
export function preFilter(event: TokenEvent): PreFilterResult {
  const { name, symbol } = event;

  // If neither name nor symbol is present, pass through -- can't evaluate
  if (!name && !symbol) {
    return { pass: true };
  }

  // Check name if present
  if (name !== undefined) {
    // Name length check
    if (name.length < 2) {
      return { pass: false, reason: 'name too short (< 2 chars)' };
    }
    if (name.length > 30) {
      return { pass: false, reason: 'name too long (> 30 chars)' };
    }

    const nameUpper = name.toUpperCase();

    // Spam keyword check (substring match in name)
    for (const keyword of SPAM_KEYWORDS) {
      if (nameUpper.includes(keyword)) {
        return { pass: false, reason: `name contains spam keyword "${keyword}"` };
      }
    }

    // Impersonation check (exact match against well-known names -- case-insensitive)
    if (IMPERSONATION_TARGETS.has(nameUpper)) {
      return { pass: false, reason: `name impersonates well-known token "${nameUpper}"` };
    }
  }

  // Check symbol if present
  if (symbol !== undefined) {
    const symbolUpper = symbol.toUpperCase();

    // Symbol length check
    if (symbol.length < 1) {
      return { pass: false, reason: 'symbol too short (< 1 char)' };
    }
    if (symbol.length > 12) {
      return { pass: false, reason: 'symbol too long (> 12 chars)' };
    }

    // Spam keyword check (substring match in symbol)
    for (const keyword of SPAM_KEYWORDS) {
      if (symbolUpper.includes(keyword)) {
        return { pass: false, reason: `symbol contains spam keyword "${keyword}"` };
      }
    }

    // Impersonation check (exact match in symbol)
    if (IMPERSONATION_TARGETS.has(symbolUpper)) {
      return { pass: false, reason: `symbol impersonates well-known token "${symbolUpper}"` };
    }
  }

  return { pass: true };
}
