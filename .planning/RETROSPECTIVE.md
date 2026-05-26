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

## Milestone: v1.1 — Hardening & Polish

**Shipped:** 2026-05-26
**Phases:** 5 (17-21) | **Plans:** 21 executed (+1 superseded) | **Tasks:** 38

### What Was Built
- Security hardening: SQL audit, config PATCH validation + rollback, dependency fixes, ESLint security rules
- Safety pipeline: liquidity-depth hard gate + LP-lock and metadata-mutability penalty checks; standalone audit script
- Execution: dynamic Helius priority fees, Jito CU simulation, wallet balance guard
- Reliability: HealthService, MetricsTracker (p50/p99), AlertStore, pino-roll log rotation, /api/health|metrics|alerts
- Dashboard overhaul: per-source analytics, live safety-pipeline view, pause/force-sell/emergency-stop controls, system status panel

### What Worked
- Strict dependency ordering (security → safety → execution → reliability → dashboard) meant each phase built on stable foundations
- Module-level setter injection (Phase 20) avoided cascading constructor changes through engine/ladder/pipeline
- Reusing existing /api/trades/history for client-side per-source analytics (Phase 21) — no new backend endpoint
- The milestone audit caught a post-verification regression (SEC-02 revert) that the stale phase verifications missed

### What Was Inefficient
- SAF-10 was planned as closeable (gap-closure plan 18-05 drafted) but is blocked on live safety-scored trade data — the dependency wasn't surfaced until audit
- Phase verifications went stale (~2 months) before close; SEC-02 was reverted and ESLint installed after their VERIFICATION.md was written, forcing a re-check against current code
- SUMMARY one_liner frontmatter still missing on several plans (18-01/02, 19-04, 20-04/05, 21-02/05)
- Nyquist validation again mostly deferred — only Phase 21 reached formal compliance

### Patterns Established
- Audit-then-fix-inline: resolve small gaps (doc corrections, false-flag reclassification) during the milestone audit instead of spinning up closure phases
- Re-verify stale verifications against current `git` state before trusting their status at milestone close
- Log-scrubbing (`maskUrl`, error-path replace) as the mitigation when an API forces a secret into the URL

### Key Lessons
1. A passing phase verification can be invalidated by later commits — re-check security-sensitive requirements against current code at close (SEC-02 X-Api-Key revert)
2. "Tooling built" ≠ "requirement satisfied" — SAF-10 had a tested audit script but no report, and the report needs data that doesn't exist yet
3. Requirements depending on accumulated runtime data (FP/FN rates) can't be closed by code alone — flag the data dependency at planning time
4. The SSE-on-tab-switch bug (v1.0 lesson #5) resurfaced as `config-changed-sse-feed` — recurring lessons need a tracked owner, not just a retrospective note

### Cost Observations
- Model mix: opus for audit/planning/execution, sonnet for the integration checker
- 118 commits across ~60 calendar days (much of it idle between phase bursts)
- Notable: the audit + inline-fix loop closed 3 of 4 gaps without new phases

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Phases | Plans | Key Change |
|-----------|--------|-------|------------|
| v1.0 | 16 | 42 | Established GSD workflow, TDD for core modules, audit-then-fix pattern |
| v1.1 | 5 | 21 | Milestone-audit-then-fix-inline; re-verify stale verifications against current code |

### Cumulative Quality

| Milestone | Requirements | Coverage | LOC |
|-----------|-------------|----------|-----|
| v1.0 | 60/60 | All satisfied | 13,653 |
| v1.1 | 19/20 | SAF-10 partial (deferred) | +22.7k / −1.6k (160 files) |

### Top Lessons (Verified Across Milestones)

1. Build sell reliability alongside buy, not after — sell is the primary profit driver
2. External API auth changes require centralized clients for single-point-of-fix
3. Token standard migrations (SPL → Token-2022) cascade through every layer of the pipeline
4. A green phase verification can go stale — re-check security-sensitive requirements against current code before milestone close
5. "Tooling built" ≠ "requirement satisfied"; requirements gated on accumulated runtime data need that dependency flagged at planning time
