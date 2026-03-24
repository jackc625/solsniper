# Phase 16: SELL_PARTIAL Dashboard Visibility & Requirements Traceability - Context

**Gathered:** 2026-03-23
**Status:** Ready for planning

<domain>
## Phase Boundary

Make tiered TP partial sell events visible in the dashboard live feed by subscribing to SELL_PARTIAL in the frontend SSE client, and backfill DRY-01–08 and UI-01–06 requirement definitions into REQUIREMENTS.md.

</domain>

<decisions>
## Implementation Decisions

### SELL_PARTIAL Dashboard Visibility
- **D-01:** SELL_PARTIAL frontend wiring is already complete from Phase 15-03 gap closure — SSE subscription, badge color (green), event label ("PARTIAL") all in place
- **D-02:** FeedCard renders SELL_PARTIAL correctly via generic fields: `detail` carries step name + SOL received + running total, `pnlSol` shows SOL received this tier, `isDryRun` badge works
- **D-03:** Keep `pnlSol` as-is on SELL_PARTIAL (shows SOL received for that tier, not running P&L). The detail string already shows the running total. No backend change needed
- **D-04:** This sub-task requires verification only — confirm the existing rendering handles real SELL_PARTIAL events correctly. No new code needed

### Requirements Traceability Backfill
- **D-05:** Derive DRY-01–08 and UI-01–06 requirement definitions from what was actually built in Phases 12 and 13 (ROADMAP goals, success criteria, context files)
- **D-06:** Claude's Discretion on section placement within REQUIREMENTS.md — pick the best position based on document flow
- **D-07:** Mark all new requirement definitions as complete (`[x]`) since Phases 12 and 13 are already verified
- **D-08:** Traceability table entries already exist (REQUIREMENTS.md lines 169-182) — only the definition bullet points need adding

### Claude's Discretion
- Exact wording of each DRY and UI requirement definition (derived from implementation reality)
- Section ordering within REQUIREMENTS.md
- Whether to update the Coverage summary line at the bottom of the traceability section

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/REQUIREMENTS.md` — Target file for backfill. Traceability table already has DRY/UI entries but definitions are missing from v1 section

### Phase 12 (DRY source material)
- `.planning/ROADMAP.md` §Phase 12 — Goal and requirements list for dry run functionality
- `.planning/phases/12-dry-run-functionality/12-CONTEXT.md` — Decisions about gate points, shadow tracking, dashboard integration, persistence

### Phase 13 (UI source material)
- `.planning/ROADMAP.md` §Phase 13 — Goal and requirements list for UI rework
- `.planning/phases/13-ui-rework/13-CONTEXT.md` — Decisions about layout, feed cards, external links, performance/analytics

### Phase 15 (SELL_PARTIAL already done)
- `dashboard/src/store/feed.ts` — SSE subscription includes SELL_PARTIAL (line 36)
- `dashboard/src/components/FeedCard.tsx` — BADGE_COLORS and EVENT_LABELS include SELL_PARTIAL (lines 11, 25)
- `src/execution/sell/sell-ladder.ts` — Backend SELL_PARTIAL emission (lines 245-280)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `dashboard/src/store/feed.ts`: SELL_PARTIAL already in eventTypes array — SSE subscription complete
- `dashboard/src/components/FeedCard.tsx`: Generic card rendering handles SELL_PARTIAL via existing fields (detail, pnlSol, isDryRun)
- `src/execution/sell/sell-ladder.ts`: Backend emits SELL_PARTIAL with detail string, pnlSol, isDryRun — fully wired

### Established Patterns
- REQUIREMENTS.md uses `- [x] **REQ-ID**: Description` format for requirement definitions
- Traceability table uses `| REQ-ID | Phase N | Status |` format — already populated for DRY/UI
- Coverage summary at bottom tracks total/mapped/unmapped counts

### Integration Points
- `.planning/REQUIREMENTS.md` v1 section — add Dry Run and UI subsections with definitions
- No code changes needed — SELL_PARTIAL frontend is already complete

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches. This phase is primarily documentation backfill with verification of existing SELL_PARTIAL wiring.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 16-sell-partial-traceability*
*Context gathered: 2026-03-23*
