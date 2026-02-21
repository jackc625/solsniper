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

// Plan 03+: TokenInfo, SafetyScore
// Plan 04+: Position, Trade types
