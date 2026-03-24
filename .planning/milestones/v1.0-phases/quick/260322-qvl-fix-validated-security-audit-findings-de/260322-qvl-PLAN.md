---
phase: 260322-qvl
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - package.json
  - pnpm-lock.yaml
autonomous: true
requirements: []

must_haves:
  truths:
    - "fastify is at >=5.8.1 resolving content-type validation bypass (CVE-2026-3419)"
    - "rollup is at >=4.59.0 resolving arbitrary file write vulnerability"
    - "ship-safe scan reports no new real findings (false positives and bigint-buffer are documented as accepted)"
  artifacts:
    - path: "package.json"
      provides: "Updated fastify version spec"
      contains: '"fastify": "^5.8.1"'
    - path: "pnpm-lock.yaml"
      provides: "Resolved rollup >=4.59.0"
  key_links:
    - from: "package.json"
      to: "pnpm-lock.yaml"
      via: "pnpm install resolves new versions"
      pattern: "fastify.*5\\.8"
---

<objective>
Fix validated security audit findings: update fastify to ^5.8.1 (content-type validation bypass), update rollup lockfile resolution to >=4.59.0 (arbitrary file write), and verify the existing Helius API key masking is sufficient (research confirmed header auth is NOT supported by Helius).

Purpose: Close the 2 real vulnerabilities found by ship-safe audit while skipping the unfixable bigint-buffer (no patch exists) and documenting false positives.
Output: Updated dependencies with no vulnerable versions, passing tests.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/quick/260322-qvl-fix-validated-security-audit-findings-de/260322-qvl-CONTEXT.md
@.planning/quick/260322-qvl-fix-validated-security-audit-findings-de/260322-qvl-RESEARCH.md
@package.json
</context>

<tasks>

<task type="auto">
  <name>Task 1: Update vulnerable dependencies (fastify + rollup)</name>
  <files>package.json, pnpm-lock.yaml</files>
  <action>
1. Update fastify version spec in package.json from "^5.7.4" to "^5.8.1" (fixes moderate content-type validation bypass CVE-2026-3419 / GHSA-573f-x89g-hqp9).

2. Run `pnpm install` to resolve the new fastify version and pull in >=5.8.1.

3. Run `pnpm update @preact/preset-vite rollup` to update both packages. This honors the user's locked decision to update @preact/preset-vite (per CONTEXT.md) while ALSO directly updating rollup, which is the actual fix. Research corrected the dependency chain understanding: rollup is a dependency of vite (not @preact/preset-vite), so updating preset-vite alone would NOT fix the rollup vulnerability. Updating both ensures the spirit of the locked decision is honored and the vulnerability is actually resolved. The rollup constraint comes from vite (^4.43.0), so any 4.59+ resolves cleanly.

4. Verify resolved versions:
   - Run `pnpm list fastify` and confirm version is >=5.8.1
   - Run `pnpm list rollup` and confirm version is >=4.59.0

5. Run the full test suite (`pnpm test`) to confirm no regressions from the dependency updates. These are semver-compatible patches so breakage is not expected.

6. Run typecheck (`pnpm run typecheck`) to confirm no type-level regressions.

Note: Per user decision, skip bigint-buffer (no patched version exists, transitive dep of @solana/spl-token). Direct dep updates only, no pnpm overrides.

Note: Per research, Helius v0 REST API does NOT support Authorization header auth -- only ?api-key= query param. The existing Quick-7 masking fix in tier3-creator.ts (line 146) already prevents API key leakage in error logs. No code changes needed for the API key finding.
  </action>
  <verify>
    <automated>cd C:/Users/jackc/Code/solsniper && pnpm list fastify --depth=0 | grep -q "5\.\(8\|9\|[1-9][0-9]\)" && pnpm list rollup --depth=0 | grep -qE "4\.(59|[6-9][0-9]|[1-9][0-9][0-9])" && echo "VERSIONS OK" || echo "VERSIONS FAILED"</automated>
  </verify>
  <done>fastify resolved to >=5.8.1, rollup resolved to >=4.59.0, all tests pass, typecheck passes</done>
</task>

<task type="auto">
  <name>Task 2: Verify fixes and run ship-safe scan</name>
  <files></files>
  <action>
1. Run ship-safe scan to verify the dependency vulnerabilities are resolved:
   `npx ship-safe scan .`

2. Confirm the scan output:
   - The fastify content-type validation bypass finding should be gone
   - The rollup arbitrary file write finding should be gone
   - bigint-buffer may still appear (expected -- no patch exists, per user decision to skip)
   - False positives (SQL injection on trade-store.ts:100, config validation on config.ts:42) may still appear (expected -- these are false positives: trade-store uses ? placeholders, config uses Zod safeParse)

3. DEVIATION FROM LOCKED DECISION: CONTEXT.md locked the decision to "Create .ship-safe-ignore (or equivalent ignore config) to suppress false positives in future audits." This CANNOT be honored because ship-safe has NO baseline, ignore-file, or suppression mechanism of any kind. The actual ship-safe CLI only supports these commands: scan, checklist, init, fix, guard, mcp. The research initially claimed a `baseline` command existed, but this was incorrect -- verified against the actual CLI help output. Since no tool-level suppression is possible, the false positives and bigint-buffer will continue to appear in future scans. Document this limitation in the SUMMARY so future audits can quickly skip known false positives by reference.

4. Run the full test suite one final time to confirm everything is green:
   `pnpm test`
  </action>
  <verify>
    <automated>cd C:/Users/jackc/Code/solsniper && pnpm test 2>&1 | tail -5</automated>
  </verify>
  <done>Ship-safe scan confirms fastify and rollup vulns are resolved. Tests pass. False positives and bigint-buffer documented as accepted (no tool-level suppression available -- locked decision cannot be honored, see deviation note).</done>
</task>

</tasks>

<verification>
- `pnpm list fastify` shows >=5.8.1
- `pnpm list rollup` shows >=4.59.0
- `pnpm test` passes (no regressions)
- `pnpm run typecheck` passes
- `npx ship-safe scan .` shows no new real findings
</verification>

<success_criteria>
1. Fastify version >=5.8.1 in lockfile (CVE-2026-3419 resolved)
2. Rollup version >=4.59.0 in lockfile (arbitrary file write resolved)
3. All 235+ tests pass
4. Typecheck passes
5. No code changes needed for Helius API key (header auth not supported, masking already in place)
</success_criteria>

<output>
After completion, create `.planning/quick/260322-qvl-fix-validated-security-audit-findings-de/260322-qvl-SUMMARY.md`
</output>
