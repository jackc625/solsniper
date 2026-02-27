import type { CheckResult } from '../../types/index.js';
import type { Blocklist } from '../../safety/blocklist.js';
import { createModuleLogger } from '../../core/logger.js';

const log = createModuleLogger('tier3-creator');
const HELIUS_TX_URL = 'https://api-mainnet.helius-rpc.com/v0/addresses';
const SERIAL_DEPLOYER_THRESHOLD = 10;

interface HeliusTx {
  type: string;
  timestamp: number;
  signature: string;
}

/**
 * Analyzes the mint count to determine creator risk score.
 *
 * Heuristic (per plan spec):
 * - 0-1 mints: score=80 (new creator, moderate trust)
 * - 2-3 mints: score=50 (some history)
 * - 4-9 mints: score=20 (likely serial deployer, suspicious)
 * - 10+ mints: score=0, pass=false (confirmed serial deployer — hard reject)
 */
function analyzeCreatorHistory(
  mintCount: number,
  timestamps: number[],
  creator: string,
): { pass: boolean; score: number; detail: string; shouldBlocklist: boolean } {
  const sortedTs = [...timestamps].sort((a, b) => a - b);
  const timeSpanSeconds =
    sortedTs.length >= 2 ? sortedTs[sortedTs.length - 1]! - sortedTs[0]! : 0;
  const timeSpanHours = Math.round(timeSpanSeconds / 3600);

  const detail = `${mintCount} prior mints over ${timeSpanHours}h`;

  if (mintCount >= SERIAL_DEPLOYER_THRESHOLD) {
    return {
      pass: false,
      score: 0,
      detail: `serial deployer: ${detail}`,
      shouldBlocklist: true,
    };
  }

  if (mintCount >= 4) {
    return { pass: true, score: 20, detail, shouldBlocklist: false };
  }

  if (mintCount >= 2) {
    return { pass: true, score: 50, detail, shouldBlocklist: false };
  }

  // 0-1 mints
  return { pass: true, score: 80, detail: detail || `${mintCount} prior mints`, shouldBlocklist: false };
}

/**
 * Checks creator wallet history for serial token deployment.
 *
 * Fast path — blocklist check first (no API call needed for known-bad creators).
 * API path — requires HELIUS_API_KEY; skips if not configured.
 *
 * Behavior:
 * - creator === undefined: neutral (Raydium events don't include creator address)
 * - creator in blocklist: hard reject (pass=false, score=0)
 * - heliusApiKey not configured: neutral (pass=true, score=50)
 * - 0-1 mints: pass=true, score=80
 * - 2-3 mints: pass=true, score=50
 * - 4-9 mints: pass=true, score=20
 * - 10+ mints: pass=false, score=0 + adds to blocklist
 * - API error/timeout: pessimistic (pass=true, score=0)
 *
 * Satisfies: SAF-07
 */
export async function checkCreatorHistory(
  creator: string | undefined,
  heliusApiKey: string | undefined,
  blocklist: Blocklist,
  signal: AbortSignal,
): Promise<CheckResult> {
  // Fast path 1: No creator in event (Raydium events)
  if (!creator) {
    return {
      pass: true,
      score: 50,
      source: 'creator_history',
      detail: 'no_creator_in_event',
    };
  }

  // Fast path 2: Blocklist check (instant rejection without API call)
  if (blocklist.has(creator)) {
    return {
      pass: false,
      score: 0,
      source: 'creator_history',
      detail: 'creator_blocklisted',
    };
  }

  // Skip API check if Helius key not configured
  if (!heliusApiKey) {
    log.debug({ creator }, 'Helius API key not configured, skipping Tier 3 creator check');
    return {
      pass: true,
      score: 50,
      source: 'creator_history',
      detail: 'helius_key_not_configured',
    };
  }

  const url = `${HELIUS_TX_URL}/${creator}/transactions?api-key=${heliusApiKey}&type=TOKEN_MINT&limit=50`;

  try {
    const response = await fetch(url, { signal });

    if (!response.ok) {
      log.warn({ creator, status: response.status }, 'Helius API returned non-200 status');
      return {
        pass: true,
        score: 0,
        source: 'creator_history',
        detail: `helius_error_${response.status}`,
      };
    }

    const transactions = (await response.json()) as HeliusTx[];
    const mintTxs = transactions.filter((tx) => tx.type === 'TOKEN_MINT');
    const timestamps = mintTxs.map((tx) => tx.timestamp);

    const analysis = analyzeCreatorHistory(mintTxs.length, timestamps, creator);

    if (analysis.shouldBlocklist) {
      log.warn({ creator, mintCount: mintTxs.length }, 'Serial deployer detected — adding to blocklist');
      blocklist.add(creator);
    }

    return {
      pass: analysis.pass,
      score: analysis.score,
      source: 'creator_history',
      detail: analysis.detail,
    };
  } catch (err: unknown) {
    log.warn({ creator, err }, 'Helius API fetch error or timeout');
    return {
      pass: true,
      score: 0,
      source: 'creator_history',
      detail: 'timeout_or_error',
    };
  }
}
