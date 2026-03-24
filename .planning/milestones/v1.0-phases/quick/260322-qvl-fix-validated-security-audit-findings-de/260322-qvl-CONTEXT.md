# Quick Task 260322-qvl: Fix validated security audit findings - Context

**Gathered:** 2026-03-22
**Status:** Ready for planning

<domain>
## Task Boundary

Fix real security findings from ship-safe audit. 4 findings investigated, 2 confirmed real (API key in URL, dep vulns), 2 false positives (SQL injection, config validation). Fix real issues and suppress false positives.

</domain>

<decisions>
## Implementation Decisions

### Helius API Key in URL
- Research whether Helius v0 REST API supports Authorization header auth
- If header auth is supported: switch tier3-creator.ts to use headers instead of URL query param
- If not supported: keep current Quick-7 masking fix (already masks key in catch block error logs)

### Dependency Update Scope
- Update fastify to ^5.8.1 (fixes moderate content-type validation bypass)
- Update @preact/preset-vite to latest to pull in rollup >=4.59.0 (fixes high arbitrary file write)
- Skip bigint-buffer — no patched version exists, transitive dep of @solana/spl-token, unfixable
- Direct dep updates only, no pnpm overrides

### False Positive Handling
- Create .ship-safe-ignore (or equivalent ignore config) to suppress false positives in future audits
- Suppress: SQL injection false positive (trade-store.ts:100 uses ? placeholders), config validation false positive (config.ts:42 has Zod safeParse)

### Claude's Discretion
- Exact .ship-safe-ignore format (depends on what the tool supports)

</decisions>

<specifics>
## Specific Ideas

- tier3-creator.ts:112 — URL currently embeds API key as `?api-key=${heliusApiKey}`
- Quick task 7 already added masking in catch block (line 146): `url.replace(/api-key=[^&]*/gi, 'api-key=***')`
- fastify vulnerable range: 5.7.2-5.8.0, current spec: ^5.7.4
- rollup vulnerable range: 4.0.0-4.58.x, patched: >=4.59.0 (transitive via @preact/preset-vite)

</specifics>
