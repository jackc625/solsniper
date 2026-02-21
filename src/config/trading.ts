import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';

const DetectionConfigSchema = z.object({
  wsHeartbeatIntervalMs: z.number().int().positive().default(30000),
  wsBaseBackoffMs: z.number().int().positive().default(3000),
  wsMaxBackoffMs: z.number().int().positive().default(60000),
  wsExcessiveReconnectThreshold: z.number().int().positive().default(5),
  wsExcessiveReconnectWindowMs: z.number().int().positive().default(600000),
  statsIntervalMs: z.number().int().positive().default(900000),
  dedupWindowMs: z.number().int().positive().default(3600000),
});

const TradingConfigSchema = z.object({
  buyAmountSol: z.number().positive().max(10),
  maxSlippageBps: z.number().int().min(50).max(4900),
  maxConcurrentPositions: z.number().int().min(1).max(50),
  stopLossPct: z.number().negative(),
  takeProfitPct: z.number().positive(),
  minSafetyScore: z.number().int().min(0).max(100),
  detection: DetectionConfigSchema,
});

export type TradingConfig = z.infer<typeof TradingConfigSchema>;

let rawConfig: unknown;

try {
  const configPath = path.resolve('config.json');
  const raw = fs.readFileSync(configPath, 'utf-8');
  rawConfig = JSON.parse(raw);
} catch (err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`Failed to load config.json: ${message}`);
  process.exit(1);
}

const configResult = TradingConfigSchema.safeParse(rawConfig);

if (!configResult.success) {
  console.error('config.json validation failed:');
  configResult.error.issues.forEach((issue) => {
    console.error(`  [${issue.path.join('.')}] ${issue.message}`);
  });
  process.exit(1);
}

export const tradingConfig: TradingConfig = configResult.data;
