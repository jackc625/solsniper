# Phase 17: Security Fixes - Research

**Researched:** 2026-03-27
**Domain:** Security hardening -- SQL injection, API key exposure, config validation, dependency vulnerabilities
**Confidence:** HIGH

## Summary

Phase 17 covers four discrete security findings from BUGS.md. Research reveals: (1) the SQL injection finding is a false positive -- all SQL in the codebase already uses parameterized queries via better-sqlite3 prepared statements; the flagged line 100 in trade-store.ts generates `?` placeholders from a hardcoded array, never user input; (2) the Helius API key exposure on line 112 of tier3-creator.ts is real -- the key is embedded in a URL query parameter but Helius supports `X-Api-Key` header authentication as an alternative; (3) the config PATCH endpoint validates the incoming patch body but does NOT validate the merged result against the full TradingConfigSchema before applying it; (4) `pnpm audit` reveals 3 high and 4 moderate vulnerabilities across bigint-buffer, picomatch, fastify, and brace-expansion.

The project has no ESLint configuration today -- it needs to be set up from scratch (ESLint 10 with flat config + typescript-eslint 8.x). Zod 4 (already installed at 4.3.6) strips unknown keys by default on `.parse()`, so D-09 is effectively free. The spl-token 0.4.x chain to bigint-buffer has no patched version available (patched: `<0.0.0`), and spl-token has no 0.5.x -- 0.4.14 is the latest. This requires a document-and-accept strategy.

**Primary recommendation:** Fix the three real issues (Helius header migration, config merged validation, dependency updates), confirm the SQL finding as safe with an audit comment + ESLint guard, and add ESLint with two custom security rules for regression prevention.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Audit ALL SQL usage across the entire codebase, not just trade-store.ts -- confirm every query is parameterized
- **D-02:** Document findings in updated BUGS.md with per-finding resolution status
- **D-03:** Add an ESLint rule to guard against template literals in SQL-adjacent calls (`.prepare()`, `.run()`, `.exec()`) -- defense-in-depth prevention
- **D-04:** Audit ALL external API calls project-wide for key exposure in URLs (Helius, Jupiter, RPC endpoints, etc.), not just the known tier3-creator.ts instance
- **D-05:** Migrate Helius API key to `Authorization: Bearer` header format -- keys must never appear in URL query parameters
- **D-06:** Add an ESLint rule to flag patterns like `?api-key=` or `?api_key=` in source strings -- prevent regression
- **D-07:** Validate the patch body AND the merged result against full TradingConfigSchema -- both layers must pass
- **D-08:** Add cross-field semantic checks on merged result (e.g., stopLoss must be below takeProfit thresholds, min values can't exceed max values)
- **D-09:** Use Zod `.strip()` to silently remove unknown keys from patch body -- tolerant of future dashboard versions sending extra fields
- **D-10:** Transform Zod validation errors into human-friendly messages (e.g., "buyAmountSol must be between 0 and 10") instead of raw Zod flatten output
- **D-11:** Fix all high/critical vulnerabilities. Document any moderate vulns that can't be fixed with justification. Matches SEC-04 requirement exactly.
- **D-12:** For bigint-buffer HIGH vuln via spl-token 0.4.x -- Claude's discretion on approach (attempt upgrade, use overrides, or document-and-accept based on feasibility investigation)
- **D-13:** Update existing BUGS.md with audit results -- mark each finding as resolved/documented. Single source of truth for security findings.
- **D-14:** Audit log statements that might include API keys, RPC URLs with credentials, or full error objects that could leak secrets. Fix any found.
- **D-15:** Add ESLint + TypeScript parser to the project. Configure with the 2 security-focused custom rules (D-03 SQL guard, D-06 API key guard). Minimal config -- not a full lint pass.

### Claude's Discretion
- Dependency vuln resolution approach for bigint-buffer/spl-token (D-12) -- investigate and pick safest approach that doesn't break functionality
- ESLint rule implementation details (regex patterns, severity levels)
- Log sanitization scope beyond API keys (wallet addresses, RPC URLs, etc.)

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SEC-01 | SQL injection risk in trade-store.ts audited and either fixed or documented as safe | SQL audit findings (all parameterized); ESLint guard rule; full codebase audit results in Architecture Patterns section |
| SEC-02 | Helius API key passed via Authorization header instead of URL query parameter | Helius supports `X-Api-Key` header; migration pattern documented in Code Examples; full fetch() audit results |
| SEC-03 | Dashboard config PATCH endpoint validates merged result against full TradingConfigSchema before applying | TradingConfigSchema exists in trading.ts and is exported; Zod 4 strips unknown keys by default; merge-then-validate pattern in Code Examples |
| SEC-04 | All high/moderate dependency vulnerabilities resolved or documented with justification | Full pnpm audit results in Architecture Patterns; resolution strategy per-vuln; bigint-buffer accept rationale |
</phase_requirements>

## Standard Stack

### Core (already installed)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| zod | 4.3.6 | Schema validation for config merge validation | Already used throughout project; `.parse()` strips unknown keys by default in Zod 4 |
| better-sqlite3 | 12.6.2 | SQLite with synchronous parameterized queries | Already used; all queries already parameterized |
| fastify | 5.8.2 -> 5.8.4 | HTTP framework (moderate vuln fix) | Upgrade to 5.8.3+ fixes X-Forwarded-Proto/Host spoofing |
| pino | 10.3.1 | Structured logging | Already used; supports redact option for secret masking |

### New (to install)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| eslint | 10.1.0 | Linting engine for custom security rules | D-03, D-06: SQL template guard and API key guard |
| typescript-eslint | 8.57.2 | TypeScript parser and plugin for ESLint | Required for ESLint to parse .ts files |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Custom ESLint rules | eslint-plugin-security | Too broad, many false positives for this codebase; custom rules target exact patterns |
| Pino redact option | Manual log sanitization | Pino redact is global config but only works on known paths; manual audit is needed regardless for `err` objects |

**Installation:**
```bash
pnpm add -D eslint typescript-eslint
```

**Version verification:** eslint 10.1.0, typescript-eslint 8.57.2 -- confirmed via `npm view` on 2026-03-27. Fastify 5.8.4 available for security fix.

## Architecture Patterns

### SQL Audit Results (SEC-01)

**Finding: ALL SQL in the codebase is already parameterized. The BUGS.md finding is a false positive.**

Files with SQL usage (exhaustive audit):

| File | SQL Pattern | Safe? | Notes |
|------|-------------|-------|-------|
| `src/persistence/trade-store.ts` | 14 prepared statements with `@named` params | YES | All use `.prepare()` with named `@` params |
| `src/persistence/trade-store.ts:100` | Template literal in `.prepare()` | YES | Generates `?` placeholders from `NON_TERMINAL_STATES.map(() => '?')` -- hardcoded array, no user input. Already has `ship-safe-ignore` comment |
| `src/persistence/schema.ts` | `db.exec(SCHEMA_SQL)` and `MIGRATION_SQL` | YES | Static SQL strings, no interpolation |
| `src/dashboard/routes/trades.ts:42-52` | `db.prepare(...)` with inline SQL | YES | Static SQL, no template interpolation, no user input |
| `src/dashboard/routes/trades.ts:66-78` | `db.prepare(...)` with inline SQL | YES | Static SQL, hardcoded WHERE clause |

**Action:** Confirm as safe, add ESLint guard to prevent future regressions, update BUGS.md.

### API Key Exposure Audit (SEC-02)

**Full fetch() audit results:**

| File | API | Key in URL? | Key in Header? | Action |
|------|-----|-------------|----------------|--------|
| `src/safety/checks/tier3-creator.ts:112` | Helius Enhanced TX | YES `?api-key=` | NO | MIGRATE to `X-Api-Key` header |
| `src/execution/jupiter-client.ts:75,121` | Jupiter Swap v1 | NO | YES `x-api-key` | Already safe |
| `src/safety/checks/tier2-rugcheck.ts:34` | RugCheck | NO | YES `X-API-KEY` | Already safe |
| `src/execution/buy/pump-portal-buyer.ts:31` | PumpPortal | NO | NO (no auth) | N/A |
| `src/execution/sell/jito-seller.ts:118,163` | Jito Bundle | NO | NO (no auth) | N/A |
| `src/execution/sell/pump-portal-seller.ts:45` | PumpPortal | NO | NO (no auth) | N/A |
| `src/core/rpc-manager.ts:20-21` | Solana RPC | YES (in Connection URL) | N/A | Standard for @solana/web3.js Connection; URL masking already exists on line 26 |

**RPC URL note:** The Solana `Connection` constructor takes a URL with `?api-key=` for Helius RPC. This is the standard pattern for `@solana/web3.js` and cannot be changed to a header without wrapping the Connection class. The existing `maskUrl()` function on rpc-manager.ts:26 already sanitizes these URLs in logs. **This is acceptable -- the RPC URL is never logged raw.**

**Only tier3-creator.ts needs migration.**

### Helius API Key Migration Pattern (SEC-02, D-05)

**IMPORTANT CORRECTION TO D-05:** Helius does NOT document `Authorization: Bearer` format. Helius supports two authentication methods:
1. Query parameter: `?api-key=YOUR_KEY` (current, to be removed)
2. Header: `X-Api-Key: YOUR_KEY` (target migration)

The decision says "Authorization: Bearer" but the Helius API actually uses `X-Api-Key` header format. This is functionally equivalent for the security goal (key out of URL) but uses the vendor's actual supported format.

**Confidence:** HIGH -- verified via Helius official docs and multiple sources confirming `X-Api-Key` header support.

### Config Validation Architecture (SEC-03)

Current flow:
```
PATCH /api/config -> ConfigPatchSchema.safeParse(body) -> patchRuntimeConfig(data) -> return
```

Required flow:
```
PATCH /api/config -> ConfigPatchSchema.safeParse(body)
  -> patchRuntimeConfig(data)
  -> TradingConfigSchema.safeParse(mergedResult)
  -> cross-field semantic checks
  -> if invalid: ROLLBACK to previous config, return 400
  -> if valid: keep merged, return 200
```

Key implementation details:
- `TradingConfigSchema` is already exported from `src/config/trading.ts`
- `patchRuntimeConfig()` mutates `_runtimeConfig` directly -- need to snapshot before merge, restore on validation failure
- Zod 4 `.parse()` strips unknown keys by default (satisfies D-09 automatically)
- Cross-field checks (D-08) should use Zod `.refine()` on the merged result

**Zod 4 behavior note:** In Zod 4, `z.object().parse()` strips unknown keys by default. No explicit `.strip()` call is needed. The decision D-09 is satisfied automatically when we run `TradingConfigSchema.safeParse()` on the merged result.

### Dependency Vulnerability Resolution (SEC-04)

Full `pnpm audit` results from 2026-03-27:

| Package | Severity | Version | Path | Fix Available? | Strategy |
|---------|----------|---------|------|----------------|----------|
| bigint-buffer | HIGH | 1.1.5 | spl-token -> buffer-layout-utils -> bigint-buffer | NO (patched: `<0.0.0`) | Document-and-accept |
| picomatch | HIGH | 2.3.1 | @preact/preset-vite -> @prefresh/vite -> @rollup/pluginutils -> picomatch | YES (>=2.3.2) | pnpm override |
| picomatch | HIGH | 4.0.3 | @preact/preset-vite -> @rollup/pluginutils -> picomatch | YES (>=4.0.4) | pnpm override |
| fastify | MODERATE | 5.8.2 | direct dependency | YES (>=5.8.3) | Upgrade to 5.8.4 |
| picomatch | MODERATE | 2.3.1, 4.0.3 | (same as above) | YES | (covered by picomatch override) |
| brace-expansion | MODERATE | 5.0.4 | @fastify/static -> glob -> minimatch -> brace-expansion | YES (>=5.0.5) | pnpm override |

**Resolution plan:**

1. **fastify** -- Direct dependency upgrade: `pnpm update fastify` (5.8.2 -> 5.8.4). Fixes moderate X-Forwarded-Proto/Host spoofing.

2. **picomatch** -- pnpm overrides in package.json: force 2.3.2+ and 4.0.4+. These are devDependencies only (@preact/preset-vite), so zero runtime risk.

3. **brace-expansion** -- pnpm override: force 5.0.5+. Also only a devDependency path via @fastify/static (used in dev build serving).

4. **bigint-buffer** -- Document-and-accept. Rationale:
   - No patched version exists (`patched: <0.0.0` means maintainer has not released a fix)
   - spl-token 0.4.14 is the LATEST version -- there is no 0.5.x to upgrade to
   - The vulnerability is a buffer overflow in `toBigIntLE()` -- exploitable only if untrusted input is passed to bigint-buffer
   - In this codebase, bigint-buffer is used by `@solana/buffer-layout-utils` for deserialization of on-chain data -- the input comes from RPC responses, not user input
   - The real-world risk is LOW for this use case
   - No pnpm override possible (no fixed version exists)

**pnpm overrides format (package.json):**
```json
{
  "pnpm": {
    "overrides": {
      "picomatch@<2.3.2": "2.3.2",
      "picomatch@>=4.0.0 <4.0.4": "4.0.4",
      "brace-expansion@>=4.0.0 <5.0.5": "5.0.5"
    }
  }
}
```

### ESLint Setup (D-15)

The project has zero ESLint configuration today. Use ESLint 10 with flat config (eslint.config.js) and typescript-eslint for TypeScript parsing.

**Flat config structure:**
```
eslint.config.js     # Root config with custom rules
eslint-rules/        # Custom rule implementations
  no-sql-template-literals.js
  no-api-key-in-url.js
```

The two custom rules should be implemented as local ESLint plugin rules (not published packages). ESLint flat config supports inline plugin definitions.

### Log Sanitization Audit (D-14)

**Findings from log statement audit:**

| File | Line | Risk | Action |
|------|------|------|--------|
| `src/core/rpc-manager.ts:26-28` | Logs RPC URLs | SAFE | Already uses `maskUrl()` to redact `api-key=` |
| `src/safety/checks/tier3-creator.ts:147` | Logs `url` in error context | RISK | URL contains `api-key=` in query param -- but this is fixed by SEC-02 migration (key moves to header, URL becomes clean) |
| `src/index.ts:90` | Logs full `tradingConfig` object | SAFE | TradingConfig contains no secrets (validated by schema) |
| `src/index.ts:72` | Logs `nodeEnv`, `logLevel` | SAFE | Non-sensitive |
| `src/index.ts:76` | Logs wallet `publicKey` | SAFE | Public key is not a secret |
| Various error catches | Log `err` objects | LOW RISK | Error objects may contain URL fragments with keys in stack traces; SEC-02 fix removes key from URL, mitigating this |

**Recommendation:** The SEC-02 fix (moving Helius key to header) is the primary mitigation. After that fix, no log statements should contain API keys. A secondary check should verify no `err.message` or `err.stack` contains keys after the migration.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Schema validation | Custom validation functions | Zod refinements on TradingConfigSchema | Already has full schema; `.refine()` handles cross-field checks |
| ESLint rule engine | Regex-based source scanning scripts | ESLint AST-based custom rules | AST analysis catches template literals accurately; regex has false positives |
| Dependency vulnerability scanning | Manual npm/pnpm audit parsing | `pnpm audit` + pnpm overrides | Built-in tooling, maintained by pnpm team |
| URL masking in logs | Manual string replacement everywhere | Fix the source (move key to header) | Eliminating key from URL is better than masking after the fact |

**Key insight:** The best security fix is removing the vulnerability at the source (key in header, not URL) rather than adding layers of detection and masking. ESLint rules are defense-in-depth to prevent regression.

## Common Pitfalls

### Pitfall 1: patchRuntimeConfig Mutation Before Validation
**What goes wrong:** If you validate the merged result AFTER `patchRuntimeConfig()` has already mutated `_runtimeConfig`, and validation fails, the runtime config is now in an invalid state.
**Why it happens:** `patchRuntimeConfig()` directly mutates the module-level `_runtimeConfig` variable.
**How to avoid:** Snapshot the current config before calling `patchRuntimeConfig()`. If merged validation fails, restore from snapshot.
**Warning signs:** Any 400 response from PATCH /api/config that changes bot behavior.

### Pitfall 2: Helius Authorization: Bearer vs X-Api-Key
**What goes wrong:** Using `Authorization: Bearer <key>` when Helius expects `X-Api-Key: <key>` -- all API calls return 401.
**Why it happens:** D-05 says "Authorization: Bearer" but Helius docs only document `?api-key=` and `X-Api-Key` header.
**How to avoid:** Use `X-Api-Key` header format, matching the actual Helius API contract.
**Warning signs:** Creator check always returning `helius_error_401` after migration.

### Pitfall 3: ESLint Custom Rule Scope Creep
**What goes wrong:** Custom ESLint rules trigger false positives on non-SQL template literals (logging, error messages) or non-API-key URL parameters.
**Why it happens:** Over-broad regex patterns or AST matchers.
**How to avoid:** The SQL rule should ONLY flag template literals inside `.prepare()`, `.run()`, `.exec()`, and `.all()` method calls. The API key rule should only flag literal strings containing `api-key=` or `api_key=`.
**Warning signs:** The ESLint run reports dozens of violations in non-SQL code.

### Pitfall 4: pnpm Overrides Not Taking Effect
**What goes wrong:** Adding overrides to package.json but `pnpm audit` still shows vulnerabilities.
**Why it happens:** Need to run `pnpm install` after adding overrides to regenerate lockfile.
**How to avoid:** Always run `pnpm install` after modifying overrides, then re-run `pnpm audit` to confirm.
**Warning signs:** `pnpm audit` output unchanged after adding overrides.

### Pitfall 5: Config Rollback Race Condition
**What goes wrong:** If two PATCH requests arrive simultaneously, the snapshot/restore mechanism could restore stale config.
**Why it happens:** Fastify is single-threaded but async handlers can interleave at await points.
**How to avoid:** The validation happens synchronously (Zod `.safeParse()` is sync), and `patchRuntimeConfig()` is sync. As long as the entire patch-validate-rollback sequence has no `await`, there's no race. Current code has no await between patch and response.
**Warning signs:** Concurrent PATCH requests producing unexpected config states.

## Code Examples

### Helius API Key Migration (SEC-02)

Before:
```typescript
// tier3-creator.ts:112 -- INSECURE: key in URL
const url = `${HELIUS_TX_URL}/${creator}/transactions?api-key=${heliusApiKey}&type=TOKEN_MINT&limit=10`;
const response = await fetch(url, { signal });
```

After:
```typescript
// Key in header, not URL
const url = `${HELIUS_TX_URL}/${creator}/transactions?type=TOKEN_MINT&limit=10`;
const response = await fetch(url, {
  signal,
  headers: { 'X-Api-Key': heliusApiKey },
});
```

Also remove the `safeUrl` masking on line 146 (no longer needed once key is out of URL):
```typescript
// Before: const safeUrl = url.replace(/api-key=[^&]*/gi, 'api-key=***');
// After: url is already safe (no key in query params)
log.warn({ creator, url, err }, 'Helius API fetch error or timeout');
```

### Config Merged Validation (SEC-03)

```typescript
import { TradingConfigSchema, getRuntimeConfig, patchRuntimeConfig } from '../../config/trading.js';

fastify.post('/config', async (request, reply) => {
  // Layer 1: Validate patch body shape
  const patchResult = ConfigPatchSchema.safeParse(request.body);
  if (!patchResult.success) {
    return reply.code(400).send({
      error: 'Validation failed',
      details: formatZodErrors(patchResult.error),
    });
  }

  // Snapshot for rollback
  const snapshot = getRuntimeConfig();

  // Apply patch (mutates _runtimeConfig)
  const merged = patchRuntimeConfig(patchResult.data as Parameters<typeof patchRuntimeConfig>[0]);

  // Layer 2: Validate merged result against full schema
  const mergedResult = TradingConfigSchema.safeParse(merged);
  if (!mergedResult.success) {
    // Rollback: restore previous config
    patchRuntimeConfig(snapshot);
    return reply.code(400).send({
      error: 'Merged config invalid',
      details: formatZodErrors(mergedResult.error),
    });
  }

  // Layer 3: Cross-field semantic checks
  const semanticErrors = validateSemantics(mergedResult.data);
  if (semanticErrors.length > 0) {
    patchRuntimeConfig(snapshot);
    return reply.code(400).send({
      error: 'Semantic validation failed',
      details: semanticErrors,
    });
  }

  // ... emit CONFIG_CHANGED event, return 200
});
```

### Cross-Field Semantic Validation (D-08)

```typescript
function validateSemantics(config: TradingConfig): string[] {
  const errors: string[] = [];

  // stopLoss must be negative (already enforced by schema) and
  // take-profit tiers must be above 1x (already enforced by TierSchema.at > 0)
  // but check that tieredTp percentages sum to <= 100
  const tpSum = config.positionManagement.tieredTp.reduce((s, t) => s + t.pct, 0);
  if (tpSum > 100) {
    errors.push(`Tiered TP percentages sum to ${tpSum}%, must be <= 100%`);
  }

  // Safety weights should sum to 100 (weighted average expectation)
  const { rugCheck, holder, creator } = config.safety.weights;
  const weightSum = rugCheck + holder + creator;
  if (weightSum !== 100) {
    errors.push(`Safety weights sum to ${weightSum}, should equal 100`);
  }

  return errors;
}
```

### Human-Friendly Zod Error Formatting (D-10)

```typescript
import type { z } from 'zod';

function formatZodErrors(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.join('.');
    return path ? `${path}: ${issue.message}` : issue.message;
  });
}
```

### ESLint Custom Rule: No SQL Template Literals (D-03)

```javascript
// eslint-rules/no-sql-template-literals.js
module.exports = {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow template literals in SQL-adjacent method calls' },
    messages: {
      noTemplateLiteral: 'Template literal in {{method}}() call -- use parameterized queries with ? or @named placeholders',
    },
  },
  create(context) {
    const SQL_METHODS = new Set(['prepare', 'run', 'exec', 'all', 'get']);

    return {
      CallExpression(node) {
        if (
          node.callee.type === 'MemberExpression' &&
          node.callee.property.type === 'Identifier' &&
          SQL_METHODS.has(node.callee.property.name)
        ) {
          for (const arg of node.arguments) {
            if (arg.type === 'TemplateLiteral' && arg.expressions.length > 0) {
              context.report({
                node: arg,
                messageId: 'noTemplateLiteral',
                data: { method: node.callee.property.name },
              });
            }
          }
        }
      },
    };
  },
};
```

Note: The rule checks `arg.expressions.length > 0` -- a template literal with NO expressions (just backtick strings like `` `SELECT * FROM trades` ``) is safe. Only template literals with `${...}` interpolations are flagged.

### ESLint Custom Rule: No API Key in URL (D-06)

```javascript
// eslint-rules/no-api-key-in-url.js
module.exports = {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow API key patterns in URL strings' },
    messages: {
      apiKeyInUrl: 'API key pattern "{{match}}" found in string -- pass keys via headers instead',
    },
  },
  create(context) {
    const PATTERN = /[?&](api[-_]?key)=/i;

    function checkLiteral(node, value) {
      const match = PATTERN.exec(value);
      if (match) {
        context.report({
          node,
          messageId: 'apiKeyInUrl',
          data: { match: match[0] },
        });
      }
    }

    return {
      Literal(node) {
        if (typeof node.value === 'string') {
          checkLiteral(node, node.value);
        }
      },
      TemplateLiteral(node) {
        for (const quasi of node.quasis) {
          checkLiteral(node, quasi.value.raw);
        }
      },
    };
  },
};
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| ESLint .eslintrc.* (legacy config) | eslint.config.js (flat config) | ESLint 9+ (2024) | Must use flat config format for ESLint 10 |
| Zod 3 `.strip()` / `.passthrough()` | Zod 4 strips by default; use `z.looseObject()` for passthrough | Zod 4 (2025) | D-09 satisfied automatically |
| @solana/spl-token 0.3.x | 0.4.x (current, latest) | 2024 | No 0.5.x available; bigint-buffer vuln has no upstream fix |

**Deprecated/outdated:**
- ESLint legacy config format (.eslintrc.*): Removed in ESLint 10. Must use flat config.
- Zod 3 `.strip()` method: Still available for compat but unnecessary in Zod 4 (default behavior).

## Open Questions

1. **Helius header format: X-Api-Key vs Authorization: Bearer**
   - What we know: Helius official docs document `?api-key=` query param and `X-Api-Key` header. No mention of `Authorization: Bearer`.
   - What's unclear: D-05 specifies "Authorization: Bearer" format which Helius may not support.
   - Recommendation: Use `X-Api-Key` header (confirmed working). If the user insists on `Authorization: Bearer`, it needs testing against the Helius API first. The planner should note this discrepancy.

2. **patchRuntimeConfig rollback mechanism**
   - What we know: `patchRuntimeConfig()` accepts a full config and overwrites `_runtimeConfig`. Passing the snapshot back should restore it.
   - What's unclear: Whether restoring a full TradingConfig object through `patchRuntimeConfig()` (designed for partial updates) works correctly, since the deep merge logic may not handle a complete overwrite.
   - Recommendation: Add a `restoreRuntimeConfig(config: TradingConfig)` function that directly assigns `_runtimeConfig = config` without the merge logic. Or ensure that passing a complete config to `patchRuntimeConfig` is idempotent.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.0.18 |
| Config file | `vitest.config.ts` |
| Quick run command | `pnpm test` (vitest run) |
| Full suite command | `pnpm test` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SEC-01 | All SQL uses parameterized queries | lint | `pnpm exec eslint src/ --rule 'no-sql-template-literals: error'` | Wave 0 (ESLint config) |
| SEC-02 | Helius API key in header, not URL | unit | `pnpm exec vitest run src/safety/checks/tier3-creator.test.ts -t "header"` | Extend existing |
| SEC-03 | Config PATCH validates merged result | unit | `pnpm exec vitest run src/dashboard/routes/config.test.ts` | Wave 0 (new file) |
| SEC-04 | Zero high/critical dep vulns | audit | `pnpm audit --audit-level high` | N/A (CLI check) |

### Sampling Rate
- **Per task commit:** `pnpm test` (quick -- all 26 test files run in ~3s)
- **Per wave merge:** `pnpm test && pnpm audit`
- **Phase gate:** Full test suite green + `pnpm audit` reports zero high/critical

### Wave 0 Gaps
- [ ] `eslint.config.js` -- ESLint flat config with TypeScript parser and 2 custom rules
- [ ] `eslint-rules/no-sql-template-literals.js` -- Custom rule for D-03
- [ ] `eslint-rules/no-api-key-in-url.js` -- Custom rule for D-06
- [ ] `src/dashboard/routes/config.test.ts` -- Config PATCH merged validation tests (SEC-03)
- [ ] Extend `src/safety/checks/tier3-creator.test.ts` -- Verify header-based auth (SEC-02)

## Sources

### Primary (HIGH confidence)
- Codebase audit: `src/persistence/trade-store.ts`, `src/persistence/schema.ts`, `src/dashboard/routes/trades.ts` -- all SQL statements verified parameterized
- Codebase audit: all `fetch()` calls in `src/` -- only tier3-creator.ts has API key in URL
- `pnpm audit` output -- 2026-03-27, 3 high + 4 moderate vulnerabilities
- `pnpm view` -- package versions verified against npm registry 2026-03-27
- [Zod 4 docs](https://zod.dev/api) -- objects strip unknown keys by default
- [Helius Authentication docs](https://www.helius.dev/docs/api-reference/authentication) -- confirms query param auth
- [Helius Enhanced Transactions API](https://www.helius.dev/docs/enhanced-transactions) -- confirms API endpoint format

### Secondary (MEDIUM confidence)
- Multiple web sources confirming Helius supports `X-Api-Key` header in addition to query parameter
- [Zod 4 migration guide](https://zod.dev/v4/changelog) -- .strip()/.passthrough() changes

### Tertiary (LOW confidence)
- None -- all findings verified against codebase or official sources

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- verified against npm registry and codebase
- Architecture: HIGH -- all findings from direct codebase audit
- Pitfalls: HIGH -- derived from code structure analysis (mutation patterns, API contracts)
- Dependency vulns: HIGH -- from `pnpm audit` on 2026-03-27

**Research date:** 2026-03-27
**Valid until:** 2026-04-27 (stable -- security hardening of existing code)
