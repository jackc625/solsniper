# Phase 17: Security Fixes - Context

**Gathered:** 2026-03-27
**Status:** Ready for planning

<domain>
## Phase Boundary

Resolve all 4 BUGS.md security findings before adding new attack surface in subsequent phases. Covers: SQL injection audit, API key exposure fix, config validation hardening, and dependency vulnerability resolution. No new features — strictly hardening existing code.

</domain>

<decisions>
## Implementation Decisions

### SQL Audit Scope
- **D-01:** Audit ALL SQL usage across the entire codebase, not just trade-store.ts — confirm every query is parameterized
- **D-02:** Document findings in updated BUGS.md with per-finding resolution status
- **D-03:** Add an ESLint rule to guard against template literals in SQL-adjacent calls (`.prepare()`, `.run()`, `.exec()`) — defense-in-depth prevention

### API Key Migration
- **D-04:** Audit ALL external API calls project-wide for key exposure in URLs (Helius, Jupiter, RPC endpoints, etc.), not just the known tier3-creator.ts instance
- **D-05:** Migrate Helius API key to `Authorization: Bearer` header format — keys must never appear in URL query parameters
- **D-06:** Add an ESLint rule to flag patterns like `?api-key=` or `?api_key=` in source strings — prevent regression

### Config Validation Depth
- **D-07:** Validate the patch body AND the merged result against full TradingConfigSchema — both layers must pass
- **D-08:** Add cross-field semantic checks on merged result (e.g., stopLoss must be below takeProfit thresholds, min values can't exceed max values)
- **D-09:** Use Zod `.strip()` to silently remove unknown keys from patch body — tolerant of future dashboard versions sending extra fields
- **D-10:** Transform Zod validation errors into human-friendly messages (e.g., "buyAmountSol must be between 0 and 10") instead of raw Zod flatten output

### Dependency Vulnerability Strategy
- **D-11:** Fix all high/critical vulnerabilities. Document any moderate vulns that can't be fixed with justification. Matches SEC-04 requirement exactly.
- **D-12:** For bigint-buffer HIGH vuln via spl-token 0.4.x — Claude's discretion on approach (attempt upgrade, use overrides, or document-and-accept based on feasibility investigation)

### Audit Documentation
- **D-13:** Update existing BUGS.md with audit results — mark each finding as resolved/documented. Single source of truth for security findings.

### Log Sanitization
- **D-14:** Audit log statements that might include API keys, RPC URLs with credentials, or full error objects that could leak secrets. Fix any found.

### ESLint Setup
- **D-15:** Add ESLint + TypeScript parser to the project. Configure with the 2 security-focused custom rules (D-03 SQL guard, D-06 API key guard). Minimal config — not a full lint pass.

### Claude's Discretion
- Dependency vuln resolution approach for bigint-buffer/spl-token (D-12) — investigate and pick safest approach that doesn't break functionality
- ESLint rule implementation details (regex patterns, severity levels)
- Log sanitization scope beyond API keys (wallet addresses, RPC URLs, etc.)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Security findings
- `BUGS.md` — All 4 security findings with assessment, file locations, and false positive analysis

### Requirements
- `.planning/REQUIREMENTS.md` — SEC-01 through SEC-04 requirement definitions

### Affected source files
- `src/persistence/trade-store.ts` — SQL injection audit target (line 100 template literal)
- `src/safety/checks/tier3-creator.ts` — Helius API key in URL (line 112)
- `src/dashboard/routes/config.ts` — Config PATCH validation endpoint (lines 11-52)
- `package.json` — Dependency audit target

### State context
- `.planning/STATE.md` — Notes bigint-buffer/spl-token upgrade concern

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `ConfigPatchSchema` in `src/dashboard/routes/config.ts` — existing Zod schema for patch validation, needs extension for merged validation
- `TradingConfigSchema` — full config schema likely exists or can be derived from config types
- `safeUrl` pattern in `tier3-creator.ts:145-146` — existing URL masking pattern for error logs, can inform log sanitization approach

### Established Patterns
- **Parameterized SQL:** All queries in trade-store.ts use `?` or `@named` placeholders — the convention is already correct
- **Zod validation:** Already used for config endpoint — extend rather than replace
- **Pino structured logging:** Module-scoped child loggers with context objects — audit these for sensitive data in context objects
- **fetch() for external APIs:** Used for Helius, Jupiter, RugCheck calls — audit all fetch sites for key leakage

### Integration Points
- ESLint config will be new to the project — needs `package.json` scripts, config file, and TypeScript parser setup
- Config validation changes touch the dashboard hot-reload path (getRuntimeConfig) — ensure merged validation doesn't break live config updates

</code_context>

<specifics>
## Specific Ideas

No specific references — standard security hardening approaches apply.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 17-security-fixes*
*Context gathered: 2026-03-27*
