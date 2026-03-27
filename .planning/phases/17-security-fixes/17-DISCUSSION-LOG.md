# Phase 17: Security Fixes - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-03-27
**Phase:** 17-security-fixes
**Areas discussed:** SQL audit scope, API key migration, Config validation depth, Dependency vuln strategy, Audit documentation, Log sanitization, ESLint setup, Validation error UX

---

## SQL Audit Scope

| Option | Description | Selected |
|--------|-------------|----------|
| Document as safe | Write brief audit confirming all queries are parameterized, close SEC-01 | |
| Document + audit all SQL | Also grep entire codebase for any other raw SQL usage beyond trade-store.ts | |
| Document + audit all SQL + add defense-in-depth | Audit all SQL, document, AND add ESLint rule to prevent future template-literal SQL | ✓ |

**User's choice:** Document + audit all SQL + add defense-in-depth
**Notes:** User wants comprehensive approach — not just confirming known code is safe, but auditing entire codebase and preventing regression.

### Follow-up: Defense-in-depth guard type

| Option | Description | Selected |
|--------|-------------|----------|
| ESLint rule | Add ESLint no-template-literal-in-sql rule that flags template literals near .prepare() or .run() calls | ✓ |
| Code review comments | Add // SECURITY: comments on all SQL-touching code | |
| You decide | Claude picks during implementation | |

**User's choice:** ESLint rule

---

## API Key Migration

| Option | Description | Selected |
|--------|-------------|----------|
| Audit all API calls | Grep entire codebase for any API key passed as URL param (Helius, Jupiter, RPC, etc.) | ✓ |
| Fix tier3 only | Fix known tier3-creator.ts instance only | |
| You decide | Claude audits during implementation | |

**User's choice:** Audit all API calls

### Follow-up: Header format

| Option | Description | Selected |
|--------|-------------|----------|
| Authorization header | Pass via Authorization: Bearer header. Industry best practice. | ✓ |
| Custom X-API-Key header | Pass via X-API-Key header | |
| You decide | Claude picks based on Helius docs | |

**User's choice:** Authorization: Bearer header

### Follow-up: CI guard for API keys in URLs

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, ESLint or grep guard | Add lint rule flagging patterns like ?api-key= in source files | ✓ |
| No extra guard | Fix is sufficient for personal bot | |
| You decide | Claude decides based on effort vs benefit | |

**User's choice:** ESLint or grep guard

---

## Config Validation Depth

| Option | Description | Selected |
|--------|-------------|----------|
| Validate merged config | After merging patch into current config, validate full result against TradingConfigSchema | |
| Validate patch + cross-field checks | Keep patch validation AND add cross-field semantic checks on merged result | ✓ |
| You decide | Claude picks strategy satisfying SEC-03 | |

**User's choice:** Validate patch + cross-field checks

### Follow-up: Unknown key handling

| Option | Description | Selected |
|--------|-------------|----------|
| Strip silently | Use Zod .strip() to silently remove unknown keys | ✓ |
| Reject with 400 | Use Zod .strict() to reject unknown keys | |
| You decide | Claude picks based on codebase conventions | |

**User's choice:** Strip silently (tolerant of future dashboard versions)

---

## Dependency Vuln Strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Attempt spl-token upgrade | Try upgrading to 0.5.x, fall back if too disruptive | |
| npm overrides | Force patched bigint-buffer version | |
| Document and accept | Document vuln with justification | |
| You decide | Claude investigates and picks safest approach | ✓ |

**User's choice:** You decide (Claude's discretion for bigint-buffer/spl-token)

### Follow-up: Other dependency vulns

| Option | Description | Selected |
|--------|-------------|----------|
| Fix all high/critical | Upgrade/patch high/critical, document moderate with justification | ✓ |
| Fix everything possible | Aggressively upgrade all including moderate | |
| You decide | Claude handles based on pnpm audit | |

**User's choice:** Fix all high/critical (matches SEC-04 exactly)

---

## Audit Documentation

| Option | Description | Selected |
|--------|-------------|----------|
| Update BUGS.md | Update existing BUGS.md with audit results, mark each finding resolved/documented | ✓ |
| New SECURITY-AUDIT.md | Create dedicated audit report file | |
| Inline code comments only | Document directly in code | |
| You decide | Claude picks approach | |

**User's choice:** Update BUGS.md

---

## Log Sanitization

| Option | Description | Selected |
|--------|-------------|----------|
| Audit key-bearing logs | Grep for log statements that might include API keys, RPC URLs with credentials, or full error objects | ✓ |
| Full log sanitization pass | Audit ALL log statements project-wide for any PII or sensitive data | |
| No extra audit | API key URL fix is sufficient | |
| You decide | Claude scopes during implementation | |

**User's choice:** Audit key-bearing logs

---

## ESLint Setup

| Option | Description | Selected |
|--------|-------------|----------|
| Add ESLint with security rules | Install ESLint + TypeScript parser, configure with 2 security-focused custom rules only | ✓ |
| Grep-based pre-commit hook | Skip ESLint, use shell script grep for dangerous patterns | |
| You decide | Claude picks most practical approach | |

**User's choice:** Add ESLint with security rules

---

## Validation Error UX

| Option | Description | Selected |
|--------|-------------|----------|
| Human-friendly messages | Transform Zod errors into readable messages like "buyAmountSol must be between 0 and 10" | ✓ |
| Keep Zod flatten format | Current format works, personal tool | |
| You decide | Claude picks based on dashboard error handling | |

**User's choice:** Human-friendly messages

---

## Claude's Discretion

- bigint-buffer/spl-token vuln resolution approach (investigate feasibility, pick safest option)
- ESLint rule implementation details (regex patterns, severity levels)
- Log sanitization scope beyond API keys

## Deferred Ideas

None — discussion stayed within phase scope.
