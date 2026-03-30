// Shared TypeScript types for SolSniper

// Plan 02: RPC manager event types
export interface RpcManagerEvents {
  failover: (data: { from: string; to: string; reason: string; consecutiveFailures: number }) => void;
  recovered: (data: { endpoint: string }) => void;
  degraded: (data: { endpoint: string; consecutiveFailures: number }) => void;
}

// Plan 02-01: Token detection types
export type DetectionSource = 'pumpportal' | 'raydium' | 'pumpswap';

export interface TokenEvent {
  mint: string;
  source: DetectionSource;
  detectedAt: number;
  signature?: string;
  // PumpPortal-specific (populated when source === 'pumpportal')
  name?: string;
  symbol?: string;
  uri?: string;
  creator?: string;
  bondingCurveKey?: string;
  initialBuyAmount?: number;
  marketCapSol?: number;
  vSolInBondingCurve?: number;
  vTokensInBondingCurve?: number;
  // Raydium-specific: SOL vault address for liquidity depth check
  poolQuoteVault?: string;
}

export interface DetectorEvents {
  token: (event: TokenEvent) => void;
}

export interface ResilientWsConfig {
  url: string;
  name: string;
  baseBackoffMs: number;
  maxBackoffMs: number;
  heartbeatIntervalMs: number;
  excessiveReconnectThreshold: number;
  excessiveReconnectWindowMs: number;
}

// Phase 03: Safety pipeline types
export interface CheckResult {
  pass: boolean;
  source: string;
  score?: number;      // 0-100, higher = safer (only for scoring checks, not hard blocks)
  detail: string;
}

export interface SafetyResult {
  pass: boolean;
  mint: string;
  aggregateScore: number;   // 0-100
  tier1: CheckResult[];
  tier2: CheckResult[];
  tier3: CheckResult[];
  rejectionReasons: string[];
  durationMs: number;
  programId?: string;       // Detected token program from checkAuthorities (base58 pubkey)
}

// Plan 04+: Position, Trade types

export type TradeState =
  | 'DETECTED'
  | 'BUYING'
  | 'MONITORING'
  | 'SELLING'
  | 'COMPLETED'
  | 'FAILED'
  | 'ABANDONED';

export interface Trade {
  id: number;
  mint: string;
  state: TradeState;
  createdAt: number;      // Unix ms (INTEGER column)
  updatedAt: number;      // Unix ms
  buySignature?: string;
  sellSignature?: string;
  amountSol?: number;
  amountTokens?: number;
  buyPriceSol?: number;
  sellPriceSol?: number;
  errorMessage?: string;
  source?: string;          // Detection source: 'pumpportal' | 'raydium' | 'pumpswap'
  tokenProgramId?: string;  // Detected token program: TOKEN_PROGRAM_ID or TOKEN_2022_PROGRAM_ID base58
  dryRun?: boolean;         // True if trade was created in dry-run mode (no real SOL spent)
  safetyScore?: number;             // Aggregate safety score at time of buy (0-100)
  safetyRejectionReasons?: string;  // JSON array of rejection reasons (if any)
  safetyChecksDetail?: string;      // JSON object with tier1/tier2/tier3 check details
}

// Phase 05: Execution engine types

export type SellStep = 'STANDARD' | 'HIGH_FEE' | 'JITO_BUNDLE' | 'CHUNKED' | 'PUMPPORTAL' | 'EMERGENCY';

export interface BroadcastResult {
  signature: string;
  blockhash: string;
  lastValidBlockHeight: number;
}

export interface BuyResult {
  success: boolean;
  signature?: string;
  amountTokens?: number;   // token amount received (parsed from tx or estimated)
  errorMessage?: string;
}

export interface SellResult {
  success: boolean;
  step?: SellStep;         // which ladder step confirmed the sell
  signature?: string;
  errorMessage?: string;
}

/** Return type for Jupiter-based sellers (standard, high-fee, jito, emergency, pumpportal). */
export interface SellOutcome {
  signature: string;
  solReceived?: number;  // SOL received from sell (undefined only on true parse failure)
}

/** Return type for chunked seller (multiple tranches). */
export interface ChunkedSellOutcome {
  confirmedTranches: number;
  solReceived?: number;  // sum of outAmounts across confirmed tranches
}
