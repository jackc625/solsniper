---
phase: 17-security-fixes
plan: 03
subsystem: dependencies
tags: [security, dependencies, pnpm-overrides, fastify, audit, documentation]

# Dependency graph
requires:
  - phase: 17-security-fixes
    plan: 01
    provides: ESLint security rules and Helius API key migration (SEC-01, SEC-02)
  - phase: 17-security-fixes
    plan: 02
    provides: Config validation hardening (SEC-03)
provides:
  - Zero fixable high/critical dependency vulnerabilities
  - pnpm overrides for picomatch and brace-expansion
  - Fastify upgraded to 5.8.4
  - BUGS.md with all 4 security findings resolved/documented
affects: [package.json, pnpm-lock.yaml, BUGS.md]

# Tech tracking
tech-stack:
  added: []
  patterns: [pnpm-overrides-for-transitive-deps, document-and-accept-unfixable-vuln]

key-files:
  created:
    - BUGS.md
  modified:
    - package.json
    - pnpm-lock.yaml

key-decisions:
  - "bigint-buffer HIGH accepted as LOW real-world risk -- used only for deserializing on-chain RPC data, not user input; no patched version exists"
  - "pnpm overrides used for transitive dependency vulnerabilities (picomatch, brace-expansion) rather than waiting for upstream packages to update"

patterns-established:
  - "pnpm overrides pattern for transitive dependency vulnerabilities: version-range selectors in pnpm.overrides field"
  - "Document-and-accept pattern for unfixable vulnerabilities: record rationale, real-world risk level, and monitoring plan"

requirements-completed: [SEC-04]

# Metrics
duration: 6min
completed: 2026-03-27
---

# Phase 17 Plan 03: Dependency Vulnerability Resolution and BUGS.md Update Summary

**Fastify upgraded to 5.8.4, picomatch and brace-expansion overridden via pnpm, bigint-buffer documented as accepted LOW-risk, BUGS.md updated with all 4 security finding resolutions**

## Performance

- **Duration:** 6 min
- **Started:** 2026-03-27T16:23:37Z
- **Completed:** 2026-03-27T16:29:34Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Fastify upgraded from 5.8.1 to 5.8.4, resolving moderate X-Forwarded-Proto/Host spoofing vulnerability
- Picomatch HIGH vulnerabilities resolved via pnpm overrides (2.3.2 for v2, 4.0.4 for v4)
- Brace-expansion MODERATE vulnerability resolved via pnpm override (5.0.5)
- `pnpm audit` reduced from 3 high + 4 moderate to 1 high (unfixable bigint-buffer)
- BUGS.md rewritten with resolution status for all 4 original security findings
- All 314 tests pass, TypeScript clean, audit clean (except accepted bigint-buffer)

## Task Commits

Each task was committed atomically:

1. **Task 1: Fix dependency vulnerabilities via upgrades and overrides** - `cb9c42a` (fix)
2. **Task 2: Update BUGS.md with resolution status for all 4 security findings** - `e5ebdc0` (docs)

## Files Created/Modified
- `package.json` - Fastify upgraded to ^5.8.4, added pnpm.overrides for picomatch (2.3.2, 4.0.4) and brace-expansion (5.0.5)
- `pnpm-lock.yaml` - Regenerated with overridden dependency versions
- `BUGS.md` - Complete rewrite with resolution status for all 4 findings, accepted risk documentation for bigint-buffer, false positives section preserved

## Decisions Made
- Used pnpm overrides (not dependency upgrades) for picomatch and brace-expansion since these are transitive dependencies through @preact/preset-vite and @fastify/static
- Accepted bigint-buffer HIGH vulnerability as LOW real-world risk: no patched version exists (patched: <0.0.0), spl-token 0.4.14 is the latest version, and the vulnerability only affects untrusted input which this codebase never provides (RPC response deserialization only)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Worktree missing .env file -- copied from main repo (pre-existing infrastructure issue, not caused by changes)

## Known Stubs
None -- all functionality fully wired.

## Next Phase Readiness
- All 4 security findings from BUGS.md resolved
- SEC-01 through SEC-04 complete across Phase 17 Plans 01-03
- Clean dependency audit trail documented

## Self-Check: PASSED

- All 4 files exist (2 modified, 1 created, 1 summary)
- Both task commits verified (cb9c42a, e5ebdc0)
- BUGS.md contains 4 RESOLVED status entries
- pnpm audit shows only bigint-buffer remaining
- All 314 tests passing

---
*Phase: 17-security-fixes*
*Completed: 2026-03-27*
