---
phase: 17-security-fixes
plan: 01
subsystem: security
tags: [eslint, security-rules, api-key, sql-injection, helius]

# Dependency graph
requires:
  - phase: 03-safety-pipeline
    provides: tier3-creator.ts Helius API integration
provides:
  - ESLint flat config with TypeScript parser and 2 custom security rules
  - no-sql-template-literals rule preventing SQL injection regression
  - no-api-key-in-url rule preventing API key exposure in URLs
  - Helius API key migrated to X-Api-Key header (SEC-02)
affects: [all-phases-with-sql, all-phases-with-fetch]

# Tech tracking
tech-stack:
  added: [eslint@10.1.0, typescript-eslint@8.57.2]
  patterns: [eslint-flat-config, custom-security-rules, header-based-api-auth]

key-files:
  created: [eslint.config.js, eslint-rules/no-sql-template-literals.js, eslint-rules/no-api-key-in-url.js]
  modified: [package.json, src/persistence/trade-store.ts, src/safety/checks/tier3-creator.ts, src/safety/checks/tier3-creator.test.ts]

key-decisions:
  - "X-Api-Key header format used instead of Authorization: Bearer -- Helius API actually supports X-Api-Key, not Bearer format as D-05 stated"
  - "reportUnusedDisableDirectives set to off in ESLint config -- existing @typescript-eslint disable comments in codebase cause errors with security-only config"
  - "@typescript-eslint plugin registered but no rules enforced -- prevents 'Definition for rule not found' errors from existing disable comments"

patterns-established:
  - "ESLint security plugin pattern: custom rules in eslint-rules/ directory, registered as inline plugin in flat config"
  - "eslint-disable-next-line for known false positives with explanatory comment"

requirements-completed: [SEC-01, SEC-02]

# Metrics
duration: 8min
completed: 2026-03-27
---

# Phase 17 Plan 01: ESLint Security Rules and Helius API Key Migration Summary

**ESLint 10 with two custom security rules (SQL injection guard, API key URL guard) and Helius API key migrated from URL query param to X-Api-Key header**

## Performance

- **Duration:** 8 min
- **Started:** 2026-03-27T16:02:08Z
- **Completed:** 2026-03-27T16:10:53Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- ESLint 10.1.0 installed with flat config, TypeScript parser, and 2 custom security rules
- All SQL in codebase confirmed parameterized (SEC-01) -- ESLint rule validates no template literal interpolation in SQL method calls
- Helius API key migrated from `?api-key=` URL query parameter to `X-Api-Key` header (SEC-02) -- eliminates key exposure in URLs and logs
- New test verifies API key is in header and not in URL

## Task Commits

Each task was committed atomically:

1. **Task 1: Install ESLint and create custom security rules** - `98f7f19` (feat)
2. **Task 2: Migrate Helius API key to X-Api-Key header and update tests** - `120d8f8` (fix)

## Files Created/Modified
- `eslint.config.js` - ESLint flat config with TypeScript parser, @typescript-eslint plugin, and security rules
- `eslint-rules/no-sql-template-literals.js` - Custom rule flagging template literals with expressions in .prepare()/.run()/.exec()/.all()/.get() calls
- `eslint-rules/no-api-key-in-url.js` - Custom rule flagging api-key/api_key patterns in string literals and template literals
- `package.json` - Added eslint, typescript-eslint devDependencies and lint:security script
- `src/persistence/trade-store.ts` - Added eslint-disable comment on safe placeholder generation (line 100)
- `src/safety/checks/tier3-creator.ts` - Migrated Helius API key to X-Api-Key header, removed safeUrl masking
- `src/safety/checks/tier3-creator.test.ts` - Added SEC-02 test verifying header-based auth

## Decisions Made
- Used `X-Api-Key` header format instead of `Authorization: Bearer` as stated in D-05 -- Helius API actually supports X-Api-Key header, not Bearer format. Research confirmed this discrepancy.
- Set `reportUnusedDisableDirectives: 'off'` in ESLint config because existing `@typescript-eslint` disable comments in the codebase (dashboard-server.ts, trades.ts, resilient-ws.test.ts) cause "Definition for rule not found" errors with a security-only config
- Registered `@typescript-eslint` plugin (with no rules enforced) to make existing disable comments reference known rules

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] ESLint disable comment placement**
- **Found during:** Task 1 (ESLint rule creation)
- **Issue:** eslint-disable-next-line placed before `this.db.prepare(` but template literal was on the following line (multi-line call). Directive did not cover the violation.
- **Fix:** Moved eslint-disable-next-line to inside the prepare() call, directly above the template literal line
- **Files modified:** src/persistence/trade-store.ts
- **Verification:** ESLint SQL rule exits 0 on full src/
- **Committed in:** 98f7f19 (Task 1 commit)

**2. [Rule 3 - Blocking] Existing @typescript-eslint disable comments causing errors**
- **Found during:** Task 1 (ESLint verification)
- **Issue:** 5 existing eslint-disable comments referencing @typescript-eslint rules caused "Definition for rule not found" errors since security-only config doesn't include those rules
- **Fix:** Added `reportUnusedDisableDirectives: 'off'` and registered `@typescript-eslint` plugin to config
- **Files modified:** eslint.config.js
- **Verification:** ESLint exits 0 with only the expected tier3-creator.ts API key violation
- **Committed in:** 98f7f19 (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (2 blocking)
**Impact on plan:** Both fixes necessary for ESLint to produce clean output. No scope creep.

## Issues Encountered
- Worktree missing .env file causing 12 test files to fail on process.exit(1) from env validation -- copied .env from main repo. This is pre-existing infrastructure, not caused by changes.

## Known Stubs
None -- all functionality fully wired.

## Next Phase Readiness
- ESLint security rules in place for regression prevention
- SEC-01 and SEC-02 resolved
- Ready for Plan 02 (config validation hardening) and Plan 03 (dependency vulnerability resolution)

---
*Phase: 17-security-fixes*
*Completed: 2026-03-27*
