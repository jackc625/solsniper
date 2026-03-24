# Phase 16: SELL_PARTIAL Dashboard Visibility & Requirements Traceability - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-03-23
**Phase:** 16-sell-partial-traceability
**Areas discussed:** SELL_PARTIAL completeness, Requirement definitions

---

## SELL_PARTIAL Completeness

### P&L Display

| Option | Description | Selected |
|--------|-------------|----------|
| Keep as-is | pnlSol shows SOL received this tier. The detail string already shows the running total. Simple, no backend change needed. | ✓ |
| Show running P&L | Change pnlSol to (runningTotalSellPrice - amountSol) so the P&L column shows actual profit/loss so far. More accurate but requires a backend change. | |
| Hide P&L on partials | Set pnlSol undefined for SELL_PARTIAL so the column shows '—'. All tier info is in the detail string. Avoids confusion. | |

**User's choice:** Keep as-is (Recommended)
**Notes:** Phase 15-03 already completed the SELL_PARTIAL frontend wiring. No additional changes needed.

---

## Requirement Definitions

### Source Material

| Option | Description | Selected |
|--------|-------------|----------|
| Derive from implementation | Write definitions based on what was actually built in Phases 12 and 13 (ROADMAP goals, success criteria, context files). Most accurate since they reflect reality. | ✓ |
| Copy ROADMAP success criteria | Lift the Phase 12/13 success criteria verbatim and assign IDs DRY-01–08, UI-01–06. Quick but success criteria are phrased differently than requirements. | |

**User's choice:** Derive from implementation (Recommended)
**Notes:** None

### Section Placement

| Option | Description | Selected |
|--------|-------------|----------|
| After Dashboard | Add sections after Dashboard section. Groups v1 requirements together. | |
| Before Dashboard | Insert before the Dashboard section. | |
| You decide | Claude picks the best placement based on document flow. | ✓ |

**User's choice:** You decide
**Notes:** Claude's Discretion on placement within REQUIREMENTS.md

### Completion Status

| Option | Description | Selected |
|--------|-------------|----------|
| Mark complete | Add [x] checkboxes matching the traceability table status. These requirements were implemented and verified. | ✓ |
| Mark unchecked | Add [ ] checkboxes. Only mark complete after explicit re-verification in this phase. | |

**User's choice:** Mark complete (Recommended)
**Notes:** None

---

## Claude's Discretion

- Exact wording of each DRY and UI requirement definition
- Section ordering within REQUIREMENTS.md
- Whether to update the Coverage summary line

## Deferred Ideas

None — discussion stayed within phase scope
