// Shared TypeScript types for SolSniper

// Plan 02: RPC manager event types
export interface RpcManagerEvents {
  failover: (data: { from: string; to: string; reason: string; consecutiveFailures: number }) => void;
  recovered: (data: { endpoint: string }) => void;
  degraded: (data: { endpoint: string; consecutiveFailures: number }) => void;
}

// Plan 03+: TokenInfo, SafetyScore
// Plan 04+: Position, Trade types
