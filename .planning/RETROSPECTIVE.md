# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

## Milestone: v1.0 — MVP

**Shipped:** 2026-03-24
**Phases:** 16 | **Plans:** 42 | **Tasks:** 76

### What Was Built
- Full-stack Solana token sniper: detection, safety, execution, position management, crash recovery
- Web dashboard with SSE live feed, P&L charts, sortable trade history, live config hot-reload
- Dry-run mode for mainnet validation without real trades
- Token-2022 support for pump.fun create_v2 tokens
- 6-step sell escalation ladder with PumpPortal fallback

### What Worked
- Phase ordering (persistence before execution) prevented many potential bugs — write-ahead pattern was ready when needed
- Building sell alongside buy in the same phase (Phase 5) caught integration issues early
- Incremental bugfix phases (9-11) addressed real production issues discovered during testing without disrupting the roadmap
- TDD approach for core modules (JupiterClient, TradeStore) caught bugs before integration
- Event-driven architecture made dashboard integration straightforward — just emit events, SSE handles the rest

### What Was Inefficient
- Phase 2 detection was partially revisited across multiple bugfix phases (Token-2022, bonding curve PDA)
- SUMMARY frontmatter was inconsistently populated — requirements_completed metadata was often missing
- Nyquist validation was only retroactively applied (Phase 14), leaving 14/16 phases without formal VALIDATION.md
- Human verification items accumulated across dashboard phases without a systematic approach to clearing them

### Patterns Established
- `getRuntimeConfig()` pattern: read live config once at method entry, use throughout — no constructor-time snapshots
- `createRequire()` for CJS native modules (better-sqlite3, @fastify/sse) in ESM TypeScript
- `vi.hoisted()` for shared spy refs across vi.mock factories — prevents TDZ errors
- BigInt arithmetic for token amounts (can exceed Number.MAX_SAFE_INTEGER)
- Fire-and-forget with `void` for background operations that have internal error handling
- Pattern A (getAccountInfo + unpackMint) for Token-2022 compatibility

### Key Lessons
1. External API changes (Jupiter auth deprecation) can break entire pipelines overnight — centralized clients with auth make this easier to fix
2. Token-2022 was a bigger deal than expected — pump.fun's November 2025 switch meant ~100% of new tokens needed different handling
3. Bonding curve PDA exclusion was non-obvious — static address lists for system accounts don't work when every mint has its own bonding curve
4. Test mocking for env vars is infectious — one missing mock can cause cascading import failures across 12+ test files
5. SSE EventSource lifecycle must be hoisted above component routing — destroying and recreating connections on tab switch causes dropped events

### Cost Observations
- Model mix: predominantly opus for planning/execution, sonnet for quick tasks
- 243 commits across ~31 days
- Notable: bugfix phases (9-14) were nearly half the phase count — real-world testing surfaced issues that unit tests missed

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Phases | Plans | Key Change |
|-----------|--------|-------|------------|
| v1.0 | 16 | 42 | Established GSD workflow, TDD for core modules, audit-then-fix pattern |

### Cumulative Quality

| Milestone | Requirements | Coverage | LOC |
|-----------|-------------|----------|-----|
| v1.0 | 60/60 | All satisfied | 13,653 |

### Top Lessons (Verified Across Milestones)

1. Build sell reliability alongside buy, not after — sell is the primary profit driver
2. External API auth changes require centralized clients for single-point-of-fix
3. Token standard migrations (SPL → Token-2022) cascade through every layer of the pipeline
