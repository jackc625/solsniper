import 'dotenv/config';
import { z } from 'zod';

const EnvSchema = z.object({
  SOLSNIPER_RPC_URL: z.string().url('Must be a valid URL'),
  SOLSNIPER_RPC_BACKUP_URL: z.string().url('Must be a valid URL'),
  SOLSNIPER_PRIVATE_KEY: z.string().min(32, 'Private key too short — must be a valid base58 encoded key'),
  NODE_ENV: z.enum(['development', 'production']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('debug'),
  // Detection source toggles — deployment-time switches, not trading parameters
  PUMPPORTAL_ENABLED: z.coerce.boolean().default(true),
  RAYDIUM_ENABLED: z.coerce.boolean().default(true),
  // Safety pipeline API keys — optional, enable advanced checks when present
  RUGCHECK_API_KEY: z.string().optional(),
  HELIUS_API_KEY: z.string().optional(),
  // Dashboard HTTP server — deployment-time settings, not trading parameters
  DASHBOARD_PORT: z.coerce.number().int().min(1024).max(65535).default(3001),
  DASHBOARD_API_KEY: z.string().optional(),  // If absent, auth is disabled
});

export type Env = z.infer<typeof EnvSchema>;

const result = EnvSchema.safeParse(process.env);

if (!result.success) {
  console.error('Configuration validation failed:');
  result.error.issues.forEach((issue) => {
    console.error(`  [${issue.path.join('.')}] ${issue.message}`);
  });
  process.exit(1);
}

export const env: Env = result.data;
