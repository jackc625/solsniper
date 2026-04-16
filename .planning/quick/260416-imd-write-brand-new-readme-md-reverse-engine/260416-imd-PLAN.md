---
phase: 260416-imd-write-brand-new-readme-md-reverse-engine
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - README.md
autonomous: true
requirements:
  - TASK-README-REWRITE
must_haves:
  truths:
    - "README.md exists at repo root and is between 5KB and 20KB"
    - "README opens with a clear project title and a professional one-line tagline (no shields.io badges)"
    - "README covers every required TASK.md section area: overview, key features, technical highlights, architecture overview, tech stack, feature deep dive, data/domain model, security/reliability/production considerations, project structure, user flows, future/extensibility notes (if any), conclusion (merging/splitting where it reads better is allowed but no section area may be silently omitted)"
    - "README names the three safety-check tiers correctly (Tier 1 hard blocks, Tier 2 scoring, Tier 3 creator history) and lists the 8 concrete checks from RESEARCH.md §4"
    - "README describes the 6-step sell-escalation ladder in the correct order: STANDARD → HIGH_FEE → JITO_BUNDLE → CHUNKED → PUMPPORTAL → EMERGENCY"
    - "README contains a Mermaid architecture diagram showing the 8 major subsystems (Config, Detection, Safety Pipeline, Execution, Position, Persistence, Recovery, Dashboard, Monitoring) and their relationships"
    - "README contains a Mermaid sequence/flow diagram for the end-to-end snipe pipeline from token detection through position exit"
    - "README includes 2–3 short TypeScript code excerpts quoted from real files in src/ (not invented)"
    - "README tech stack section lists: TypeScript 5.9.3, Node ESM, pnpm 10.14.0, Vitest 4.0.18, better-sqlite3 12.6.2, Fastify 5, @solana/web3.js 1.98.4, Zod, pino, Preact + @preact/signals, Vite"
    - "README lists the required env vars (SOLSNIPER_RPC_URL, SOLSNIPER_RPC_BACKUP_URL, SOLSNIPER_PRIVATE_KEY, SOLSNIPER_JUPITER_API_KEY) and notes the optional ones (RUGCHECK_API_KEY, HELIUS_API_KEY, DASHBOARD_PORT, DASHBOARD_API_KEY)"
    - "README data-model section documents the trades table lifecycle (DETECTED → BUYING → MONITORING → SELLING → COMPLETED|FAILED|ABANDONED) and mentions the alerts table"
    - "README highlights at least 4 distinctive engineering decisions from RESEARCH.md §10 (e.g., synchronous duplicate-buy guard, write-ahead persistence, RugCheck tuple return, module-level monitoring injection, Token-2022 single-query balance)"
    - "README documents the safety/reliability features from RESEARCH.md §7 including circuit breakers, RPC failover, crash recovery, secret redaction"
    - "README tone is professional, technically confident, free of hype language (no 'blazing-fast', 'revolutionary', emoji-heavy section headers); section headers follow a clean H1/H2/H3 hierarchy"
    - "README makes zero claims contradicted by RESEARCH.md §13 (Ambiguities/Gaps) — specifically: does NOT claim PumpSwap liquidity is validated, does NOT claim CI/CD exists, does NOT claim Docker support, does NOT claim takeProfitPct/maxSlippageBps top-level fields drive behavior"
    - "README does not describe roadmap/aspirational features as implemented"
  artifacts:
    - path: "README.md"
      provides: "Reverse-engineered project README for engineers, interviewers, hiring managers"
      min_size_bytes: 5120
      max_size_bytes: 20480
      contains:
        - "# "
        - "```mermaid"
        - "```typescript"
        - "STANDARD"
        - "HIGH_FEE"
        - "JITO_BUNDLE"
        - "CHUNKED"
        - "PUMPPORTAL"
        - "EMERGENCY"
        - "SOLSNIPER_PRIVATE_KEY"
        - "SOLSNIPER_JUPITER_API_KEY"
        - "better-sqlite3"
        - "Fastify"
        - "Preact"
        - "Vitest"
  key_links:
    - from: "README.md"
      to: "TASK.md"
      via: "satisfies every required content area from TASK.md §README Requirements (1–13)"
      pattern: "README must not silently omit any of the 13 area topics"
    - from: "README.md"
      to: ".planning/quick/260416-imd-write-brand-new-readme-md-reverse-engine/260416-imd-RESEARCH.md"
      via: "every factual claim traces to a file path in RESEARCH.md"
      pattern: "no facts invented outside RESEARCH.md"
    - from: "README.md"
      to: ".planning/quick/260416-imd-write-brand-new-readme-md-reverse-engine/260416-imd-CONTEXT.md"
      via: "honors locked decisions D-01..D-04 (comprehensive depth, Mermaid diagrams, no badges, selective code snippets)"
      pattern: "must include Mermaid fences and must NOT include shields.io badge markdown"
    - from: "README.md"
      to: "src/safety/safety-pipeline.ts, src/execution/sell/sell-ladder.ts, src/persistence/trade-store.ts, src/core/fee-estimator.ts, src/dashboard/bot-event-bus.ts"
      via: "inline file-path citations for credibility and/or quoted code excerpts"
      pattern: "at least 3 src/ file paths cited inline"
---

<objective>
Write a brand-new `README.md` at the repo root that reverse-engineers the SolSniper codebase into a polished, interview-grade document. Audience is engineers, technical interviewers, and hiring managers per TASK.md. This replaces the current 30KB README (treated as outdated per CONTEXT.md D-00).

Purpose: Produce a single deliverable that accurately represents the project as implemented today, showcases technical depth, and reads as a serious engineering artifact. All factual claims must trace to RESEARCH.md (which already cites code paths).

Output: `README.md` at repo root, ~8–15KB, comprehensive coverage of the 13 TASK.md content areas, with two Mermaid diagrams and 2–3 selective TypeScript excerpts.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
</execution_context>

<context>
@TASK.md
@.planning/quick/260416-imd-write-brand-new-readme-md-reverse-engine/260416-imd-CONTEXT.md
@.planning/quick/260416-imd-write-brand-new-readme-md-reverse-engine/260416-imd-RESEARCH.md

<interfaces>
<!-- RESEARCH.md is the authoritative factual source for every claim in the README. -->
<!-- The executor does NOT need to re-explore the codebase; RESEARCH.md already did. -->
<!-- Key structured facts the README must reflect (all drawn from RESEARCH.md): -->

From RESEARCH.md §3 — The 8 major subsystems (initialized in strict dependency order in src/index.ts):
  Config → Detection → Safety Pipeline → Execution → Position Management
  → Persistence → Crash Recovery → Dashboard → Monitoring

From RESEARCH.md §4 — The 8 safety checks organized in 3 tiers:
  Tier 1 (hard blocks, parallel): authority, sell-route, liquidity
  Tier 2 (scoring, Promise.allSettled): rugcheck, holder, lp-lock, metadata
  Tier 3 (scoring): creator-history

From RESEARCH.md §4 — The 6-step sell ladder (order is LOAD-BEARING):
  STANDARD → HIGH_FEE → JITO_BUNDLE → CHUNKED → PUMPPORTAL → EMERGENCY
  (EMERGENCY = 49% slippage + 10x priority fee)

From RESEARCH.md §5 — Trade lifecycle:
  DETECTED → BUYING → MONITORING → SELLING → COMPLETED | FAILED | ABANDONED

From RESEARCH.md §12 — Required env vars:
  SOLSNIPER_RPC_URL, SOLSNIPER_RPC_BACKUP_URL, SOLSNIPER_PRIVATE_KEY, SOLSNIPER_JUPITER_API_KEY
Optional env vars:
  NODE_ENV, LOG_LEVEL, PUMPPORTAL_ENABLED, RAYDIUM_ENABLED, RUGCHECK_API_KEY,
  HELIUS_API_KEY, DASHBOARD_PORT, DASHBOARD_API_KEY

From RESEARCH.md §13 — Ambiguities the README MUST NOT misrepresent:
  - PumpSwap liquidity check is a neutral pass (not validated)
  - takeProfitPct and maxSlippageBps top-level fields are unused
  - No CI/CD (no .github/workflows)
  - No containerization (no Dockerfile)

From RESEARCH.md §14 — Pre-quoted TypeScript excerpts (choose 2–3):
  1. Aggregate safety scoring — src/safety/safety-pipeline.ts:186–206
  2. Synchronous duplicate-buy guard — src/persistence/trade-store.ts:205–222
  3. FeeEstimator circuit breaker — src/core/fee-estimator.ts:56–59, 130–141
  4. Sell ladder time-based escalation — src/execution/sell/sell-ladder.ts:186–231
  5. BotEvent type catalog — src/dashboard/bot-event-bus.ts:3–16
</interfaces>

<mermaid_guidance>
The two Mermaid diagrams are locked by CONTEXT.md D-02. Suggested shapes:

1. **Architecture diagram** (flowchart LR or graph TD):
   - External inputs: PumpPortal WS, Raydium onLogs, Jupiter API, Helius RPC, RugCheck, Jito
   - Internal flow: Detection → Safety Pipeline (Tier1/2/3) → Execution Engine → Position Manager → Sell Ladder
   - Persistence layer: TradeStore (SQLite WAL), AlertStore
   - Observability: botEventBus → SSE → Preact Dashboard
   - Cross-cutting: HealthService, MetricsTracker

2. **Sniping pipeline sequence/flow diagram** (sequenceDiagram or flowchart):
   - Token detected → pre-filter → safety evaluate (tiered) → write-ahead BUYING → buy broadcast
   - → transition MONITORING → position poll → tier hit → fire sell (partial) → SellLadder step
   - → transition back MONITORING on partial, or COMPLETED on full

Both must be valid Mermaid that GitHub renders. Keep node count reasonable (<25 nodes).
</mermaid_guidance>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Write README.md at repo root</name>
  <files>README.md</files>
  <action>
  Overwrite `README.md` at the repo root with a brand-new document reverse-engineered from `.planning/quick/260416-imd-write-brand-new-readme-md-reverse-engine/260416-imd-RESEARCH.md`. Do NOT read the existing README.md — CONTEXT.md D-00 explicitly treats it as outdated (use the `Write` tool to overwrite, not `Edit`).

  **Structure the README with strong markdown hierarchy covering these content areas (merge/split freely where it reads better, but do not silently omit any area):**

  1. **Title + tagline** — `# SolSniper` and a one-line tagline like "Autonomous Solana token-sniping bot with real-time safety filtering and graduated sell-escalation." No shields.io badges (D-03).

  2. **Overview** — what SolSniper is (autonomous Solana sniper), who it serves (solo/small-team algorithmic traders on a personal server), what problem it solves (first-block buys on pump.fun / Raydium / PumpSwap launches with real-time rug filtering), why it is interesting (speed-and-safety tradeoff, graduated exit guarantee).

  3. **Key Features** — grouped list pulled from RESEARCH.md §4: Token Detection (PumpPortal WS + Raydium onLogs), Three-Tier Safety Pipeline (8 checks), Dynamic Fee Estimation (Helius + circuit breaker), Buy Execution (dual-path, write-ahead), Sell Escalation Ladder (6 steps), Position Management (tiered TP, trailing stop, stop-loss, max hold), Dashboard & Controls (Preact SPA + SSE), Crash Recovery.

  4. **Technical Highlights** — call out 4+ distinctive engineering decisions from RESEARCH.md §10: synchronous duplicate-buy guard via better-sqlite3, write-ahead BUYING persistence enabling crash recovery, RugCheck tuple return reused for LP-lock override, module-level monitoring injection pattern, Token-2022 single-query balance (references Solana Labs issue), rate-limit-aware poll interval (cooperative rate budget sharing), 3-layer config validation with structuredClone rollback, Jito tip as separate transaction.

  5. **Architecture Overview** — prose walk of the 8 subsystems in dependency order (Config → Detection → Safety → Execution → Position → Persistence → Recovery → Dashboard → Monitoring). **Include a Mermaid flowchart/graph diagram** showing data flow across subsystems and external services (PumpPortal WS, Solana RPC, Jupiter, Helius, RugCheck, Jito). See `<mermaid_guidance>` above.

  6. **Tech Stack** — table or bullet list drawn from RESEARCH.md §2. Include: TypeScript 5.9.3 / ES2022 / ESM, Node 16+, pnpm 10.14.0, Vitest 4.0.18, better-sqlite3 12.6.2 (WAL mode), Fastify 5 + @fastify/sse + @fastify/static, @solana/web3.js 1.98.4, @solana/spl-token, Zod (config validation), pino + pino-roll (structured logging), Preact 10 + @preact/signals + Vite, lightweight-charts. External APIs: PumpPortal, Jupiter v1, Helius RPC, RugCheck, Jito block engine.

  7. **Feature Deep Dive** — one subsection per major area. Cite specific `src/` file paths inline for engineer credibility (at least 3 citations). For each area: what it does, how it works at a high level, notable implementation details. Cover: Detection (src/detection/), Safety Pipeline (src/safety/ — enumerate the 8 checks and the Tier 1/2/3 semantics), Execution (src/execution/ — routing by source, broadcaster with blockhash-last signing), Sell Ladder (src/execution/sell/sell-ladder.ts — 6-step escalation table), Position Management (src/position/position-manager.ts), Dashboard (src/dashboard/ — 7 REST routes + SSE).

  8. **End-to-End Snipe Flow** — **include a second Mermaid diagram** (sequence or flowchart) showing the pipeline from RESEARCH.md §6: PumpPortalListener → DetectionManager → index.ts gates → SafetyPipeline → tradeStore.createBuyingRecord → executionEngine.buy → PositionManager.tick → SellLadder.sell. See `<mermaid_guidance>`.

  9. **Data / Domain Model** — summarize the `trades` and `alerts` SQLite tables from RESEARCH.md §5. Show the TradeState lifecycle: DETECTED → BUYING → MONITORING → SELLING → COMPLETED|FAILED|ABANDONED. Mention WAL journal mode, pre-compiled statements, optimistic locking (`WHERE state = @expectedState`), and the additive-only `MIGRATION_SQL` strategy.

  10. **Security, Reliability & Production Considerations** — cover items from RESEARCH.md §7: tiered check failure semantics (T1 hard blocks, T2/T3 degrade to score=0), duplicate-buy guard, write-ahead persistence, optimistic locking, force-sell guard (sellsInFlight Set, 409 on concurrent), RPC failover (primary/backup, 3-failure threshold), Jupiter rate-limit cooldown, per-API circuit breakers (30s cooldown after 5 consecutive failures), balance guard (never blocks sells), Token-2022 compatibility, secret redaction (pino serializers strip PRIVATE_KEY/SECRET), graceful shutdown. Also cover §8 Observability briefly (health endpoint, metrics endpoint, alerts table, 14 SSE event types).

  11. **Selective TypeScript excerpts (2–3)** — embed as ```typescript fences. Choose from RESEARCH.md §14 pre-quoted excerpts. Strongly recommended: **synchronous duplicate-buy guard** (shows the async-gap argument) and **sell ladder time-based escalation** (shows Promise.race timeout pattern). Optionally add the **aggregate safety scoring** excerpt. Each excerpt must include a file-path caption (e.g., `// src/persistence/trade-store.ts:205`). Do not invent or paraphrase — quote from RESEARCH.md §14 verbatim.

  12. **Project Structure** — abbreviated tree derived from RESEARCH.md §11. Keep it useful, not exhaustive — the top 2 levels of `src/` plus the `dashboard/` SPA and top-level config files (`config.jsonc`, `vitest.config.ts`, `tsconfig.json`). Each directory gets a one-line purpose annotation.

  13. **Configuration & Operation** — subsection on env vars (required + optional table from RESEARCH.md §12), a paragraph on `config.jsonc` (runtime-patchable via `POST /api/config`, 3-layer validation), and the npm script list (`pnpm start`, `pnpm dev`, `pnpm test`, `pnpm typecheck`, `pnpm build:dashboard`, `pnpm lint:security`). Note that the dashboard SPA must be built before first run (ambiguity from §13). Do NOT write a "how to clone and fork" section (TASK.md constraint).

  14. **Testing** — one short section: Vitest 4.0.18, 39 `.test.ts` files, mocking patterns (`vi.stubGlobal('fetch')`, `vi.useFakeTimers()`, SQLite `:memory:` integration tests), circuit-breaker isolation via `_resetCircuitBreaker()` test exports, and the "Nyquist validation" pattern for idempotency testing (RESEARCH.md §9).

  15. **Known Limitations / Honest Scope Notes** — brief, truthful list drawn from RESEARCH.md §13. Must include: PumpSwap liquidity check is currently a neutral pass (pool vault layout not yet documented), `takeProfitPct` and `maxSlippageBps` top-level fields are legacy/unused, safety threshold `minSafetyScore: 80` is a developer default not calibrated on real trade data, no CI/CD pipeline yet, no container image. Frame as transparency, not apology. This honesty is what separates a strong engineering README from marketing copy.

  16. **Conclusion** — 2–3 sentences reinforcing why this is a substantial project: real-time latency-sensitive pipeline, production-minded failure handling (circuit breakers, crash recovery, write-ahead state), dual-surface observability (SSE + REST), serious test coverage.

  **Tone and style rules (from TASK.md + CONTEXT.md):**
  - Professional, technically confident, no hype language ("blazing-fast", "revolutionary", "cutting-edge" are banned)
  - No emoji-heavy headers — section headers are plain `##`/`###`
  - Prefer specificity over vagueness (quote real numbers: 6-step ladder, 49% slippage, 5-min sliding window, 8 safety checks)
  - Cite `src/` file paths inline where it adds credibility (at least 3 times total)
  - Target length: ~8–15KB final size (D-01 comprehensive depth). Aim for ~10–12KB. Reject if below 5KB (too thin) or above 20KB (runs long).

  **Locked decisions traceability:**
  - D-01 (comprehensive depth ~8–15KB) → structure covers all 13 TASK.md areas substantively
  - D-02 (Mermaid diagrams) → two fenced ```mermaid blocks: architecture + snipe flow
  - D-03 (no shields.io badges) → no `![...](https://img.shields.io/...)` markup anywhere
  - D-04 (selective TypeScript excerpts) → 2–3 ```typescript fences, quoted from RESEARCH.md §14

  **Sanity rule:** every factual claim (version number, file path, threshold, config field, event type) must trace back to RESEARCH.md. If something is not in RESEARCH.md, do not write it.
  </action>
  <verify>
    <automated>bash -lc 'test -f README.md &amp;&amp; SIZE=$(wc -c &lt; README.md) &amp;&amp; echo "size=$SIZE" &amp;&amp; [ "$SIZE" -ge 5120 ] &amp;&amp; [ "$SIZE" -le 20480 ] &amp;&amp; grep -q "```mermaid" README.md &amp;&amp; grep -q "```typescript" README.md &amp;&amp; grep -qE "STANDARD.*HIGH_FEE|HIGH_FEE.*JITO_BUNDLE" README.md &amp;&amp; grep -q "SOLSNIPER_PRIVATE_KEY" README.md &amp;&amp; grep -q "SOLSNIPER_JUPITER_API_KEY" README.md &amp;&amp; grep -q "better-sqlite3" README.md &amp;&amp; grep -q "Fastify" README.md &amp;&amp; grep -q "Preact" README.md &amp;&amp; grep -q "Vitest" README.md &amp;&amp; ! grep -qE "img.shields.io" README.md &amp;&amp; echo "README.md verification: OK"'</automated>
  </verify>
  <done>
  `README.md` exists at repo root with:
  - size between 5KB and 20KB (target ~10–12KB)
  - two ```mermaid code fences (architecture + snipe flow)
  - at least one ```typescript code fence (2–3 excerpts recommended)
  - all 6 sell-ladder step names present in order
  - all 4 required env vars named
  - core tech stack (better-sqlite3, Fastify, Preact, Vitest) named
  - no shields.io badge markup
  - every required content area from TASK.md is covered (1–13)
  - all factual claims trace to RESEARCH.md; no inventions; no contradictions of RESEARCH.md §13 ambiguities
  - Writer provides a short chat summary (per TASK.md): what was found, major sections included, any ambiguities handled with care
  </done>
</task>

</tasks>

<verification>
- [ ] `README.md` exists and size is within 5KB–20KB window
- [ ] Two Mermaid fenced blocks render valid diagrams on GitHub (architecture + snipe flow)
- [ ] 2–3 TypeScript excerpts quoted from `src/` with file-path captions
- [ ] The 6 sell-ladder step names appear in the documented order
- [ ] The 3 safety tiers and 8 checks are correctly named
- [ ] Trade lifecycle (DETECTED → BUYING → MONITORING → SELLING → COMPLETED|FAILED|ABANDONED) documented
- [ ] Required env vars listed (SOLSNIPER_RPC_URL, SOLSNIPER_RPC_BACKUP_URL, SOLSNIPER_PRIVATE_KEY, SOLSNIPER_JUPITER_API_KEY)
- [ ] Optional env vars noted (RUGCHECK_API_KEY, HELIUS_API_KEY, DASHBOARD_PORT, DASHBOARD_API_KEY)
- [ ] At least 3 inline `src/` file-path citations
- [ ] Ambiguities section honestly notes: PumpSwap neutral pass, unused `takeProfitPct`/`maxSlippageBps`, no CI/CD, no Docker
- [ ] No shields.io badges (D-03)
- [ ] No hype vocabulary (blazing-fast, revolutionary, etc.)
- [ ] Tone reads as a serious engineering README (TASK.md)
- [ ] Chat summary delivered at end (per TASK.md deliverable clause)
</verification>

<success_criteria>
A README.md that the developer would be proud to show in an interview. It accurately represents the implemented system, demonstrates architectural depth (subsystem diagram, pipeline flow, tiered safety model, graduated sell escalation, crash recovery), avoids fiction, and passes the automated verification command.
</success_criteria>

<output>
The deliverable is `README.md` itself at the repo root. No SUMMARY.md required for this quick task — the README is the summary. However, the executor MUST provide the short chat summary called for in TASK.md:
  - what was found in the codebase
  - which major sections were included
  - any places where the codebase was ambiguous and care was required (reference RESEARCH.md §13 items handled)
</output>
