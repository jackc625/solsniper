import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import stripJsonComments from 'strip-json-comments';

const HolderConfigSchema = z.object({
  top1SoftBlockThreshold: z.number().min(0).max(1).default(0.25),
  top10SoftBlockThreshold: z.number().min(0).max(1).default(0.50),
  minUserHolders: z.number().int().min(0).default(2),
});

const SafetyWeightsSchema = z.object({
  rugCheck: z.number().int().min(0).max(100).default(40),
  holder: z.number().int().min(0).max(100).default(30),
  creator: z.number().int().min(0).max(100).default(30),
});

const SafetyConfigSchema = z.object({
  tier2TimeoutMs: z.number().int().positive().default(2000),
  tier3TimeoutMs: z.number().int().positive().default(5000),
  cacheTtlMs: z.number().int().positive().default(300000),  // 5 minutes
  weights: SafetyWeightsSchema,
  holder: HolderConfigSchema,
  rugCheckScoreInverted: z.boolean().default(true),  // true = RugCheck score is risk (higher=worse), invert for safety
  blocklistPath: z.string().default('./data/creator-blocklist.json'),
  minLiquiditySol: z.number().positive().default(1.0),                  // Minimum pool SOL reserves required before buying
  lpLockScorePenalty: z.number().int().min(0).max(100).default(30),     // Score penalty when LP tokens not locked/burned
  metadataMutablePenalty: z.number().int().min(0).max(100).default(15), // Score penalty when token metadata is mutable
});

export type SafetyConfig = z.infer<typeof SafetyConfigSchema>;

const DetectionConfigSchema = z.object({
  wsHeartbeatIntervalMs: z.number().int().positive().default(30000),
  wsBaseBackoffMs: z.number().int().positive().default(3000),
  wsMaxBackoffMs: z.number().int().positive().default(60000),
  wsExcessiveReconnectThreshold: z.number().int().positive().default(5),
  wsExcessiveReconnectWindowMs: z.number().int().positive().default(600000),
  statsIntervalMs: z.number().int().positive().default(900000),
  dedupWindowMs: z.number().int().positive().default(3600000),
});

const ExecutionBuyConfigSchema = z.object({
  slippageBps: z.number().int().min(50).max(4900).default(1000),            // 10% default
  priorityFeeBaseLamports: z.number().int().positive().default(100000),     // 0.0001 SOL base
  priorityFeeMultiplier: z.number().positive().default(1),
  maxPriorityFeeCapLamports: z.number().int().positive().default(500000),   // 0.0005 SOL absolute ceiling
});

const ExecutionSellConfigSchema = z.object({
  standardSlippageBps: z.number().int().min(50).max(4900).default(500),     // 5% default
  emergencySlippageBps: z.number().int().min(50).max(4900).default(4900),   // 49% default
  standardTimeoutMs: z.number().int().positive().default(30000),
  highFeeTimeoutMs: z.number().int().positive().default(20000),
  highFeeMultiplier: z.number().positive().default(3),
  jitoTimeoutMs: z.number().int().positive().default(30000),
  jitoTipLamports: z.number().int().positive().default(100000),             // 0.0001 SOL default
  chunkedTimeoutMs: z.number().int().positive().default(60000),
  emergencyTimeoutMs: z.number().int().positive().default(30000),
  emergencyPriorityMultiplier: z.number().positive().default(10),
});

const ExecutionConfigSchema = z.object({
  buy: ExecutionBuyConfigSchema,
  sell: ExecutionSellConfigSchema,
});

export type ExecutionConfig = z.infer<typeof ExecutionConfigSchema>;

const TierSchema = z.object({
  at: z.number().positive(),             // multiplier (e.g. 2 = 2x entry price)
  pct: z.number().int().min(1).max(100), // percent of tokens to sell at this tier
});

const PositionManagementConfigSchema = z.object({
  pollIntervalMs: z.number().int().positive().default(5000),
  stopLossPct: z.number().negative().default(-50),
  tieredTp: z.array(TierSchema).default([
    { at: 2, pct: 33 },
    { at: 5, pct: 33 },
    { at: 10, pct: 34 },
  ]),
  trailingStopPct: z.number().min(0).max(100).default(0), // 0 = disabled
  maxHoldTimeMs: z.number().int().min(0).default(120000), // 0 = disabled, default 2 min
});

export type PositionManagementConfig = z.infer<typeof PositionManagementConfigSchema>;

// Phase 20: Monitoring configuration for alerts and log rotation (REL-02, REL-04)
const LogRotationConfigSchema = z.object({
  sizeMb: z.number().int().positive().default(50),
  retentionDays: z.number().int().positive().default(7),
});

export const MonitoringConfigSchema = z.object({
  alertCooldownMs: z.number().int().positive().default(60_000),
  apiFailureThreshold: z.number().int().positive().default(5),
  logRotation: LogRotationConfigSchema.default({ sizeMb: 50, retentionDays: 7 }),
});

export type MonitoringConfig = z.infer<typeof MonitoringConfigSchema>;

export const TradingConfigSchema = z.object({
  buyAmountSol: z.number().positive().max(10),
  maxSlippageBps: z.number().int().min(50).max(4900),
  maxConcurrentPositions: z.number().int().min(1).max(50),
  stopLossPct: z.number().negative(),
  takeProfitPct: z.number().positive(),
  minSafetyScore: z.number().int().min(0).max(100),
  dryRun: z.boolean().default(false),
  minBalanceBufferSol: z.number().positive().default(0.01), // Min SOL buffer beyond buy amount
  detection: DetectionConfigSchema,
  safety: SafetyConfigSchema,
  execution: ExecutionConfigSchema,
  positionManagement: PositionManagementConfigSchema,
  monitoring: MonitoringConfigSchema.default({ alertCooldownMs: 60_000, apiFailureThreshold: 5, logRotation: { sizeMb: 50, retentionDays: 7 } }),
});

export type TradingConfig = z.infer<typeof TradingConfigSchema>;

let rawConfig: unknown;

try {
  const configPath = path.resolve('config.jsonc');
  const raw = fs.readFileSync(configPath, 'utf-8');
  rawConfig = JSON.parse(stripJsonComments(raw));
} catch (err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`Failed to load config.jsonc: ${message}`);
  process.exit(1);
}

const configResult = TradingConfigSchema.safeParse(rawConfig);

if (!configResult.success) {
  console.error('config.jsonc validation failed:');
  configResult.error.issues.forEach((issue) => {
    console.error(`  [${issue.path.join('.')}] ${issue.message}`);
  });
  process.exit(1);
}

export const tradingConfig: TradingConfig = configResult.data;

// Runtime mutable shadow -- dashboard can patch at runtime.
// Existing callers continue using tradingConfig for the static initial value.
// New dashboard-aware code calls getRuntimeConfig() to get live values.
let _runtimeConfig: TradingConfig = configResult.data;

export function getRuntimeConfig(): TradingConfig {
  return _runtimeConfig;
}

export function restoreRuntimeConfig(config: TradingConfig): void {
  _runtimeConfig = config;
}

export function patchRuntimeConfig(updates: Partial<TradingConfig>): TradingConfig {
  const merged = { ..._runtimeConfig };

  for (const key of Object.keys(updates) as Array<keyof TradingConfig>) {
    const updateVal = updates[key];
    const currentVal = _runtimeConfig[key];

    // Deep merge plain objects (up to 2 levels); primitives and arrays overwrite directly
    if (
      updateVal != null &&
      typeof updateVal === 'object' &&
      !Array.isArray(updateVal) &&
      currentVal != null &&
      typeof currentVal === 'object' &&
      !Array.isArray(currentVal)
    ) {
      // Level 1 merge
      const mergedObj = { ...currentVal } as Record<string, unknown>;
      for (const subKey of Object.keys(updateVal as Record<string, unknown>)) {
        const subUpdate = (updateVal as Record<string, unknown>)[subKey];
        const subCurrent = (currentVal as Record<string, unknown>)[subKey];

        // Level 2 merge (safety.weights, safety.holder, execution.buy, execution.sell)
        if (
          subUpdate != null &&
          typeof subUpdate === 'object' &&
          !Array.isArray(subUpdate) &&
          subCurrent != null &&
          typeof subCurrent === 'object' &&
          !Array.isArray(subCurrent)
        ) {
          mergedObj[subKey] = { ...subCurrent, ...subUpdate };
        } else {
          mergedObj[subKey] = subUpdate;
        }
      }
      (merged as Record<string, unknown>)[key] = mergedObj;
    } else {
      (merged as Record<string, unknown>)[key] = updateVal;
    }
  }

  _runtimeConfig = merged as TradingConfig;
  return _runtimeConfig;
}
