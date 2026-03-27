---
phase: 17
slug: security-fixes
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-27
---

# Phase 17 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.0.18 |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `pnpm test` |
| **Full suite command** | `pnpm test` |
| **Estimated runtime** | ~3 seconds |

---

## Sampling Rate

- **After every task commit:** Run `pnpm test`
- **After every plan wave:** Run `pnpm test && pnpm audit`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 3 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 17-01-01 | 01 | 1 | SEC-01 | lint | `pnpm exec eslint src/ --rule 'no-sql-template-literals: error'` | ❌ W0 | ⬜ pending |
| 17-01-02 | 01 | 1 | SEC-02 | unit | `pnpm exec vitest run src/safety/checks/tier3-creator.test.ts -t "header"` | ❌ W0 | ⬜ pending |
| 17-02-01 | 02 | 1 | SEC-03 | unit | `pnpm exec vitest run src/dashboard/routes/config.test.ts` | ❌ W0 | ⬜ pending |
| 17-03-01 | 03 | 1 | SEC-04 | audit | `pnpm audit --audit-level high` | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `eslint.config.js` — ESLint flat config with TypeScript parser and 2 custom rules
- [ ] `eslint-rules/no-sql-template-literals.js` — Custom rule for D-03 (SQL template guard)
- [ ] `eslint-rules/no-api-key-in-url.js` — Custom rule for D-06 (API key URL guard)
- [ ] `src/dashboard/routes/config.test.ts` — Config PATCH merged validation tests (SEC-03)
- [ ] Extend `src/safety/checks/tier3-creator.test.ts` — Verify header-based auth (SEC-02)

*Existing infrastructure covers SEC-04 (pnpm audit CLI check).*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Helius API key not in access logs/error traces | SEC-02 | Log output inspection requires runtime | Run bot in dry-run mode, trigger tier3 check, grep logs for API key substring |

*All other phase behaviors have automated verification.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 3s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
