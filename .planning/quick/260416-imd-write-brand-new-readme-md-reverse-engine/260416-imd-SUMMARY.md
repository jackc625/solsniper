---
quick_id: 260416-imd
plan: 01
title: Write brand-new README.md reverse-engineered from codebase
type: execute
completed: 2026-04-16
tags: [docs, readme, reverse-engineer, quick]
tech-stack:
  patterns:
    - reverse-engineered documentation from research artifact (no codebase re-exploration)
    - two Mermaid diagrams (architecture flowchart + snipe-flow sequence)
    - selective TypeScript excerpts quoted verbatim from src/ with file-path captions
key-files:
  created:
    - README.md (at repo root)
  modified: []
decisions:
  - Honored CONTEXT.md D-00: did not read existing README.md as a source of truth; single-line Read only used to satisfy tool contract for overwrite
  - Trimmed to fit 5KB-20KB plan window after initial draft came in at 30.6KB; iteratively reduced prose while keeping all must-have content assertions
  - Removed the aggregate-scoring TypeScript excerpt during trimming (kept two TS excerpts: sell-ladder Promise.race + createBuyingRecord duplicate-buy guard) to preserve ">= 1 typescript fence" requirement while meeting size ceiling
metrics:
  duration_min: 8
  tasks_completed: 1
  files_created: 1
  files_modified: 0
---

# Quick Task 260416-imd: Write brand-new README.md reverse-engineered from codebase

## Summary

Reverse-engineered a polished, interview-grade `README.md` for SolSniper from the canonical research artifact at `.planning/quick/260416-imd-write-brand-new-readme-md-reverse-engine/260416-imd-RESEARCH.md`. The existing 30KB README was treated as outdated per CONTEXT.md D-00 and overwritten entirely. Every factual claim in the new README traces back to RESEARCH.md, which itself cites specific `src/` file paths and line ranges.

Final artifact: `README.md` (309 lines, 20,274 bytes — within the 5KB–20KB plan window).

## What Was Delivered

- **README.md** at repo root with 15 section-areas covering every required TASK.md content topic
- Two Mermaid diagrams: a subsystem/architecture flowchart and an end-to-end snipe-flow sequence diagram
- Two TypeScript excerpts quoted verbatim from `src/`:
  - `src/execution/sell/sell-ladder.ts:186` — time-based escalation with `Promise.race` timeout
  - `src/persistence/trade-store.ts:205` — synchronous duplicate-buy guard
- Ten inline `src/` file-path citations (plan required ≥3)
- All 8 safety checks named across the 3 tiers; all 6 sell-ladder step names in the correct order; all 4 required env vars and all optional env vars documented; trade lifecycle `DETECTED → BUYING → MONITORING → SELLING → COMPLETED|FAILED|ABANDONED` documented
- Zero shields.io badges; zero hype language; professional H1/H2/H3 hierarchy

## Execution Notes

- **Initial draft was 30,636 bytes** (too long — 10KB over the ceiling). Iteratively trimmed across 8 edits by tightening prose in Feature Deep Dive, condensing `Key Features` bullets, removing the aggregate-scoring TypeScript excerpt (replaced with a prose description plus file-path citation), compressing the sequence diagram, flattening Project Structure, and shortening the Testing and Overview sections.
- **Final size 20,274 bytes** — 206 bytes under the 20,480 ceiling, comfortably over the 5,120 floor.
- One code excerpt was dropped during trimming (aggregate scoring) to preserve the more distinctive duplicate-buy guard and sell-ladder Promise.race patterns. Plan required 2–3 excerpts "recommended"; `must_haves.artifacts` only required ">= 1 typescript fence". Final count: 2 excerpts.

## Verification

Plan `<verify><automated>` command run and passed:

```
size=20274
README.md verification: OK
```

All must-have strings confirmed present: `STANDARD` / `HIGH_FEE` / `JITO_BUNDLE` / `CHUNKED` / `PUMPPORTAL` / `EMERGENCY`, `SOLSNIPER_PRIVATE_KEY`, `SOLSNIPER_JUPITER_API_KEY`, `better-sqlite3`, `Fastify`, `Preact`, `Vitest`. Zero `img.shields.io` occurrences.

## Deviations from Plan

None. Plan executed as written; only size-driven trim decisions were made and none violated the must-have content list.

## Commit

- `5965d46` — `docs(quick-260416-imd): rewrite README from codebase inspection`

## Chat summary for user

**What I found in the codebase**

Per the research artifact (which exhaustively mapped the codebase at this commit): SolSniper is an autonomous Solana token-sniping bot organized into eight subsystems (Config, Detection, Safety Pipeline, Execution, Position, Persistence, Recovery, Dashboard, Monitoring) in strict dependency order. The most distinctive engineering choices are the synchronous duplicate-buy guard in `TradeStore` (exploits `better-sqlite3`'s synchronous API), the write-ahead `BUYING` persistence pattern that enables crash reconciliation against wallet state, the six-step sell ladder ending at 49% slippage with Jito bundles, and the three-tier safety model that distinguishes hard blocks (Tier 1) from graceful degradation (Tier 2/3 errors become `score=0, pass=true`). The stack is TypeScript 5.9.3 + Node ESM + Fastify 5 + better-sqlite3 WAL + Preact for the dashboard SPA, with 39 Vitest test files across the codebase.

**Major sections included in README.md**

Title + tagline, Overview, Key Features (8 bullets), Technical Highlights (6 engineering-depth callouts), Architecture Overview (with the architecture Mermaid), Tech Stack (table), Feature Deep Dive (Detection / Safety Pipeline / Execution / Sell Ladder / Position Management / Dashboard — with a TS excerpt in Sell Ladder), End-to-End Snipe Flow (second Mermaid — sequence diagram), Data / Domain Model (trades schema, lifecycle, optimistic-locking, and TS excerpt of the duplicate-buy guard), Security / Reliability / Production Considerations (12 bullets + observability endpoints), Project Structure, Configuration & Operation (env vars + scripts), Testing (Vitest + Nyquist-validation pattern), Known Limitations and Scope Notes (6 honest caveats), Conclusion.

**Places the codebase was ambiguous — and how I handled them**

All ambiguities from RESEARCH.md §13 were documented in the "Known Limitations and Scope Notes" section rather than papered over:

- **PumpSwap liquidity check** — written as a "neutral pass" honestly, not claimed as validated.
- **`takeProfitPct` / `maxSlippageBps` top-level fields** — explicitly called out as legacy/unused holdovers, not described as part of the live exit logic.
- **`BalanceGuard.invalidateCache()` never called** — documented with the low-risk framing (5s TTL bounds the staleness window).
- **Safety threshold `minSafetyScore: 80`** — described as an unvalidated developer default requiring empirical calibration.
- **No CI/CD** — explicitly stated ("No `.github/workflows/` directory; testing is run locally").
- **No containerization** — explicitly stated ("No Dockerfile or docker-compose").
- **Dashboard SPA requires separate build step** — documented under Scripts: "The dashboard SPA is served from `dashboard/dist/`, which must be built with `pnpm build:dashboard` before the bot first starts."

No ambiguity was silently smoothed over. Transparency is explicitly framed as the point of that section.
