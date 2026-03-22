# Quick Task 260322-qvl: Fix Validated Security Audit Findings - Research

**Researched:** 2026-03-22
**Domain:** Dependency vulnerabilities, API key exposure, ship-safe baseline
**Confidence:** HIGH

## Summary

Four targeted questions were investigated. The primary finding is that Helius does NOT support header-based authentication for the Enhanced Transactions v0 REST API -- only `?api-key=` query parameter is documented. The existing Quick-7 masking fix is the correct mitigation. Dependency updates are straightforward: `pnpm update rollup` resolves the rollup vuln (lockfile has 4.58.0, needs >=4.59.0), and bumping fastify spec to `^5.8.1` fixes the content-type validation bypass. Ship-safe uses a `baseline` command (not an ignore file) for suppressing known findings.

**Primary recommendation:** Keep Helius API key in URL (no header alternative exists), update fastify + rollup, create ship-safe baseline for false positives.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Research whether Helius v0 REST API supports Authorization header auth
- If header auth is supported: switch tier3-creator.ts to use headers instead of URL query param
- If not supported: keep current Quick-7 masking fix (already masks key in catch block error logs)
- Update fastify to ^5.8.1 (fixes moderate content-type validation bypass)
- Update @preact/preset-vite to latest to pull in rollup >=4.59.0 (fixes high arbitrary file write)
- Skip bigint-buffer -- no patched version exists, transitive dep of @solana/spl-token, unfixable
- Direct dep updates only, no pnpm overrides
- Create .ship-safe-ignore (or equivalent ignore config) to suppress false positives in future audits
- Suppress: SQL injection false positive (trade-store.ts:100 uses ? placeholders), config validation false positive (config.ts:42 has Zod safeParse)

### Claude's Discretion
- Exact .ship-safe-ignore format (depends on what the tool supports)
</user_constraints>

## Finding 1: Helius API Header Authentication

**Confidence: HIGH**

**Result: NOT SUPPORTED.** Helius v0 Enhanced Transactions API only supports `?api-key=` query parameter authentication.

Evidence:
- Official Helius authentication docs (https://www.helius.dev/docs/api-reference/authentication) show ONLY query parameter method
- Enhanced Transactions API endpoint docs (https://www.helius.dev/docs/api-reference/enhanced-transactions/gettransactionsbyaddress) show ONLY `?api-key=YOUR_API_KEY` in URL
- Helius "Protect Your Keys" guide (https://www.helius.dev/docs/rpc/protect-your-keys) recommends proxies and secure URLs for frontend apps, does NOT mention header auth
- Helius SDK (`helius-sdk` npm) injects API key into URL internally
- No `X-Api-Key`, `Authorization: Bearer`, or any header-based auth is documented anywhere in official sources

**Action:** Keep the current implementation. The Quick-7 masking fix (line 146 in tier3-creator.ts) already prevents API key leakage in error logs. The API key in URL is the ONLY supported method.

**Note:** Web search AI summaries falsely claimed `X-Api-Key` header support. This was verified as hallucination -- no official source corroborates it. This is a good example of why web search results need verification.

## Finding 2: Ship-Safe False Positive Suppression

**Confidence: HIGH (verified from CLI)**

Ship-safe does NOT use a `.ship-safe-ignore` file. It uses a **baseline** mechanism:

```bash
# Create baseline from current findings -- future scans only report regressions
npx ship-safe baseline .

# Run audit showing only NEW findings (not in baseline)
npx ship-safe audit --baseline

# Show what changed since baseline
npx ship-safe baseline --diff

# Remove baseline
npx ship-safe baseline --clear
```

The baseline captures all current findings and treats them as accepted. Subsequent `audit --baseline` runs only report findings NOT in the baseline. This is the correct mechanism for suppressing the two false positives (SQL injection, config validation).

**Ship-safe data directory:** `.ship-safe/` (already exists with `history.json`)

**Action:** Run `npx ship-safe baseline .` after fixing the real issues. This captures the false positives (and the unfixable bigint-buffer) as accepted baseline, so future audits only flag regressions.

## Finding 3: Fastify 5.8.1 Update

**Confidence: HIGH**

Current spec: `"fastify": "^5.7.4"`
Latest available: **5.8.2**
Target: `^5.8.1` (per CONTEXT.md decision)

### Security fixes in the 5.7.4 -> 5.8.x range:
- **v5.8.1** (GHSA-573f-x89g-hqp9 / CVE-2026-3419): Missing end anchor in `subtypeNameReg` allows malformed Content-Types to pass validation. This is the vuln ship-safe flagged.
- **v5.8.0**: Added handler-level timeout support, type improvements for async route hooks. No breaking changes.

### Breaking change risk: NONE
- 5.8.x is a minor/patch update within Fastify 5
- The content-type validation fix tightens regex -- it will only REJECT previously-invalid Content-Types that were incorrectly passing. This project uses standard `application/json` so zero impact.
- The handler-level timeout feature is opt-in (new option, not default behavior change)

**Action:** Update package.json `"fastify": "^5.8.1"` then `pnpm install`. Harmless semver-compatible update.

## Finding 4: Rollup Vulnerability via @preact/preset-vite

**Confidence: HIGH**

The rollup vulnerability (arbitrary file write, >=4.0.0 <4.59.0) is NOT a direct dependency of `@preact/preset-vite`. The dependency chain is:

```
@preact/preset-vite@2.10.3 --> (peer) vite@^7.3.1 --> (dep) rollup@^4.43.0
```

**Current lockfile state:**
- `rollup@4.58.0` is resolved in pnpm-lock.yaml (vulnerable)
- Latest rollup: **4.60.0** (patched)
- Vite's constraint `^4.43.0` allows 4.60.0

**The fix is NOT updating @preact/preset-vite.** Updating it from 2.10.3 to 2.10.5 would not change the rollup resolution since it's a Vite dependency, not a preset-vite dependency.

**Action:** Run `pnpm update rollup` to bump the lockfile from 4.58.0 to 4.60.0. This is the direct fix. Optionally also update `@preact/preset-vite` to `^2.10.5` (latest), but that alone won't fix rollup.

Alternatively, `pnpm update vite` would also transitively pull in a newer rollup resolution.

## Execution Summary

| Finding | Action | Risk |
|---------|--------|------|
| Helius API key in URL | KEEP -- no header auth available. Masking fix already in place. | None |
| Fastify vuln | Update spec to `^5.8.1`, run `pnpm install` | None (semver patch) |
| Rollup vuln | Run `pnpm update rollup` to bump lockfile 4.58.0 -> 4.60.0 | None (semver patch) |
| False positives | Run `npx ship-safe baseline .` after other fixes | None |
| bigint-buffer | Skip (per CONTEXT.md) -- no patched version, baseline covers it | None |

## Sources

### Primary (HIGH confidence)
- Helius official authentication docs: https://www.helius.dev/docs/api-reference/authentication
- Helius enhanced transactions API docs: https://www.helius.dev/docs/api-reference/enhanced-transactions/gettransactionsbyaddress
- Helius key protection guide: https://www.helius.dev/docs/rpc/protect-your-keys
- Fastify security advisory GHSA-573f-x89g-hqp9: https://github.com/fastify/fastify/releases (v5.8.1)
- Fastify security advisory GHSA-mg2h-6x62-wpwc: https://github.com/fastify/fastify/security/advisories/GHSA-mg2h-6x62-wpwc
- npm registry: `npm view fastify version` -> 5.8.2, `npm view rollup version` -> 4.60.0, `npm view @preact/preset-vite version` -> 2.10.5
- ship-safe CLI `--help` output (run locally)
- pnpm-lock.yaml inspection (rollup@4.58.0 resolved)
