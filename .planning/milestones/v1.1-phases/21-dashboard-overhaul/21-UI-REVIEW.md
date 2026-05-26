# Phase 21 — UI Review

**Audited:** 2026-04-04
**Baseline:** 21-UI-SPEC.md (approved design contract)
**Screenshots:** Not captured (no dev server running at localhost:3000, 5173, or 8080)

---

## Pillar Scores

| Pillar | Score | Key Finding |
|--------|-------|-------------|
| 1. Copywriting | 3/4 | Spec-defined copy landed correctly; Controls positions table is missing the "Current P&L" column and the pause error uses "try again" (spec: "Could not update detection state -- try again" is technically correct per spec, but force-sell error fallback path omits "Position is already being sold" at the frontend layer) |
| 2. Visuals | 3/4 | Focal points, hierarchy, and LIVE indicator correctly implemented; FORCE SELL button lacks hover state despite spec-mandated `rgba(255,68,68,0.1)` hover background |
| 3. Color | 4/4 | Amber accent used exclusively on spec-reserved elements; no rogue hardcoded hex colors; semantic color system correctly applied throughout all new components |
| 4. Typography | 2/4 | Contract specifies 4 sizes (10px, 13px, 16px, 20px) and 2 weights (400, 700); 6 additional sizes found (9px, 11px, 12px, 14px, 18px in new code; rem-unit sizes in pre-existing components); weight-600 used in DRY_RUN_BANNER |
| 5. Spacing | 3/4 | New Phase 21 components consistently use var(--sp-*) tokens; SystemStatus.tsx M_TH/M_TD use rem-based padding (0.5rem/0.4rem) instead of sp tokens; pre-existing FeedCard/Performance/LiveFeed have extensive rem usage (inherited, not regressed) |
| 6. Experience Design | 4/4 | Loading, error, and empty states present on all new pages; destructive actions gated with confirmation; optimistic updates with revert on failure; 5s auto-dismiss for inline confirmations; disabled state on EXECUTE STOP until input matches |

**Overall: 19/24**

---

## Top 3 Priority Fixes

1. **Typography band proliferation in new code** — Breaks visual consistency contract; users perceive inconsistent information hierarchy across pages — In Pipeline.tsx STAT_VALUE change `fontSize: '18px'` to `'13px'` with `fontWeight: '700'`; in app.tsx DRY_RUN_BANNER change `fontWeight: '600'` to `'700'`; in Sidebar.tsx NAV_ABBR change `fontSize: '11px'` to `'10px'` (per spec consolidation note)

2. **Controls positions table missing "Current P&L" column** — Users cannot assess position health before deciding to force-sell, the primary use case of this table — Add a `currentPnl` field to the `Position` interface, fetch it from `/api/trades` response, and add a "P&L" column between "Entry SOL" and "Duration" matching the spec's table column order: Mint, Source, Entry SOL, Current P&L, Duration, Action

3. **FORCE SELL button missing hover background** — Button provides no visual feedback when hovered, reducing perceived interactivity on a critical destructive action — Add `onMouseEnter`/`onMouseLeave` handlers to the FORCE SELL button in Controls.tsx setting `background: 'rgba(255, 68, 68, 0.1)'` on enter and `'transparent'` on leave (mirrors the spec's D-11 hover contract and the ESTOP_BTN hover pattern already used in Sidebar.tsx)

---

## Detailed Findings

### Pillar 1: Copywriting (3/4)

**Strengths — all spec-mandated copy strings verified present:**
- `EMERGENCY STOP` (Sidebar.tsx, Controls.tsx) — correct
- `CONFIRM EMERGENCY STOP` (app.tsx:83) — correct
- `EXECUTE STOP` (app.tsx:102) — correct
- `EXECUTING...` (app.tsx:103) — correct
- `DISMISS` (app.tsx:97) — correct
- `FORCE SELL` / `CONFIRM SELL` / `KEEP POSITION` (Controls.tsx:98, 105) — correct
- `SELL {shortenMint(pos.mint)}?` (Controls.tsx:86) — correct interpolation
- `SELLING...` (Controls.tsx:80) — correct
- `Waiting for evaluations` + body copy (Pipeline.tsx:216-217) — exact spec match
- `No open positions` (Controls.tsx:201) — correct
- `No alerts recorded` (SystemStatus.tsx:246) — correct
- Error strings: `Could not update detection state -- try again` (Controls.tsx:146), `Force sell failed -- check bot logs for details` (Controls.tsx:94), `Emergency stop failed -- manually check bot status` (app.tsx:67) — all match spec
- `Unable to load system status` / `Unable to load RPC metrics` / `Unable to load alert history` (SystemStatus.tsx:98, 105, 119) — correct
- Section headers: `DETECTION`, `OPEN POSITIONS`, `COMPONENT HEALTH`, `RPC PERFORMANCE`, `ALERT HISTORY`, `PASS RATE`, `AVG SCORE`, `EVALS/MIN`, `SAFETY PIPELINE`, `CONTROLS`, `SYSTEM STATUS` — all verified

**Issues:**
- `Controls.tsx:207` — Table headers are `['Mint', 'Source', 'Entry SOL', 'Duration', 'Action']` — missing "Current P&L" column specified in both the spec table (D-11: "Mint (link), Source badge, Entry SOL, Current P&L, Duration, Action column") and the copywriting contract. Spec-defined column ordering violated.
- `FeedCard.tsx:22` — Pre-existing `'BUY OK'` and `'SELL OK'` labels are not part of Phase 21 scope but are generic; flagged for awareness, not scored against.
- Error copy at `Controls.tsx:146` matches spec exactly ("Could not update detection state -- try again") — this is correct per contract, not a generic pattern.

---

### Pillar 2: Visuals (3/4)

**Strengths:**
- Pipeline page: streaming card list is the primary visual anchor with stats header above it — focal point per spec
- Controls page: PAUSE DETECTION / RESUME DETECTION toggle is the largest interactive element, first decision on the page — focal point correct
- System Status page: health card grid with colored 8px dots (spec: 8px, verified at SystemStatus.tsx:168 `width: '8px', height: '8px'`) draws the eye first — focal point correct
- Sidebar health dot for STAT nav item: 6px circle with green/yellow/red (Sidebar.tsx:143-148) — spec: 6px diameter, verified correct
- LIVE indicator with pulsing dot (Pipeline.tsx:200-205) — provides clear real-time signal
- Pipeline card left-border accent (green for PASS, red for FAIL) provides immediate visual classification
- Expandable pipeline cards use max-height transition 0 to 300px over 150ms ease (Pipeline.tsx:72-73) — matches spec interaction contract
- EmergencyStopDialog: fixed overlay, centered card, red border, red title — high visual urgency correctly established
- `aria-current="page"` on active nav item (Sidebar.tsx:121) — accessibility present
- `aria-label="Main navigation"` on nav element (Sidebar.tsx:107) — present

**Issues:**
- `Controls.tsx:389-401` — FORCE SELL button has no `onMouseEnter`/`onMouseLeave` handlers. The spec explicitly requires `background: rgba(255, 68, 68, 0.1)` on hover (D-11). Compare to ESTOP_BTN in Sidebar.tsx which correctly implements hover via inline handlers. This is a visible gap when interacting with the table.
- `Sidebar.tsx:321` — `NAV_ABBR fontSize: '11px'` creates slight visual inconsistency in the sidebar typography hierarchy; small but visible misalignment from the 10px badge-scale spec.
- The EMPTY_HEADING in Pipeline.tsx uses `var(--font-display)` at `16px` (Pipeline.tsx:449) — this correctly uses the Brand size band for the empty state heading, which is acceptable but slightly outside the spec's 4-band typography.

---

### Pillar 3: Color (4/4)

**No issues found.** Color contract is the strongest pillar in this phase.

**Amber accent (11 usages) mapped against spec-reserved elements:**

| Usage | File | Spec-Permitted Role |
|-------|------|-------------------|
| Active nav abbreviation | Sidebar.tsx:132 | Active nav indicator — permitted |
| Brand mark background | Sidebar.tsx:239 | Brand mark — permitted |
| Active nav indicator bar | Sidebar.tsx:337 | Active state glow — permitted |
| Source filter active button | Performance.tsx:383 | Active state — permitted |
| Save button | Settings.tsx:425 | Primary CTA button — permitted |
| Section labels (DETECTION, OPEN POSITIONS) | Controls.tsx:294 | Card section labels — permitted |
| SELLING badge | Controls.tsx:433 | Established pattern for in-progress state |
| Section headers (SystemStatus) | SystemStatus.tsx:341 | Card section labels — permitted |
| CONFIG_CHANGED event color | FeedCard.tsx:15 | Pre-existing, in scope |
| Settings labels | Settings.tsx:326, 366 | Card section labels — permitted |

All amber usages are on permitted elements. No amber on decorative elements.

**Hardcoded `#000` color** — Used on 9 elements across components (button text on colored backgrounds). This is a well-established pattern in this codebase for legibility on var(--amber) and var(--red) backgrounds. Consistent with pre-existing usage in FeedCard, LiveFeed, Performance, Settings, Sidebar. Not a violation.

**PnlChart.tsx:24-28** — Fallback hex values (`'#1a1a1a'`, `'#e0e0e0'`, etc.) are CSS variable read fallbacks only, not applied directly. Correct pattern.

**Semantic colors:** green/yellow/red used correctly for success/warning/danger states throughout. Health dot colors, connection bar states, PASS/FAIL badges, and error rate coloring all match spec.

---

### Pillar 4: Typography (2/4)

The spec declares exactly 4 font size bands (10px, 13px, 16px, 20px) and exactly 2 weights (400, 700).

**Violations found in Phase 21 scope or modified files:**

| File | Line | Value | Spec Band | Severity |
|------|------|-------|-----------|----------|
| `Pipeline.tsx:285` | STAT_VALUE | `18px` | Nearest: 20px | Phase 21 new code |
| `Sidebar.tsx:321` | NAV_ABBR | `11px` | Nearest: 10px | Modified in Phase 21 |
| `Sidebar.tsx:261` | BRAND_SUB | `9px` | Nearest: 10px | Modified in Phase 21 |
| `Sidebar.tsx:298` | NAV_SECTION_LABEL | `9px` | Nearest: 10px | Modified in Phase 21 |
| `Sidebar.tsx:350` | STATS_HEADER | `9px` | Nearest: 10px | Modified in Phase 21 |
| `Sidebar.tsx:313` | NAV_ITEM | `12px` | Nearest: 13px | Modified in Phase 21 |
| `app.tsx:131` | DRY_RUN_BANNER | `12px` + weight `600` | Nearest: 13px / weight 700 | Modified in Phase 21 |

**Weight violations:**
- `app.tsx:131`: `fontWeight: '600'` — spec allows only 400 and 700
- `Performance.tsx:104,123,525` and `Sidebar.tsx:278,372`: `fontWeight: 'bold'` (keyword, not numeric) — pre-existing but Sidebar.tsx was modified in Phase 21

**Pre-existing violations (not scored against Phase 21):**
- `Performance.tsx`: rem-based sizes (1.1rem, 1.6rem, 0.65rem) — pre-existing, out of scope
- `FeedCard.tsx`, `LiveFeed.tsx`: rem-based sizes — pre-existing
- `Settings.tsx`: 11px, 12px, 14px — pre-existing

**Positively compliant — new Phase 21 components:**
- `Pipeline.tsx` (except STAT_VALUE 18px): all other text correctly uses 10px, 13px, 20px
- `Controls.tsx`: all text at 10px, 13px, 20px with weights 400 and 700 — fully compliant
- `SystemStatus.tsx`: all text at 10px, 13px, 20px — fully compliant
- `app.tsx` EmergencyStopDialog: 10px, 13px, 20px — fully compliant (except DRY_RUN_BANNER weight-600)

**PAGE_SUB typography (10px / 0.1em):** Correctly applied in Pipeline.tsx:255-258, Controls.tsx:273-277, SystemStatus.tsx:321-325 — spec contract from Plan 02 deviation properly followed.

---

### Pillar 5: Spacing (3/4)

**New Phase 21 components (Controls.tsx, Pipeline.tsx) use var(--sp-*) tokens consistently.** This is good.

**Violations in Phase 21 scope:**

`SystemStatus.tsx:388-399` (M_TH and M_TD) — Uses rem-based padding:
```
M_TH: padding: '0.5rem 0.75rem'   (spec token: --sp-2 = 8px, --sp-3 = 12px)
M_TD: padding: '0.4rem 0.75rem'   (no direct token equivalent)
```
These were written as new code in Plan 05 and should use `'var(--sp-2) var(--sp-3)'` and `'6px var(--sp-3)'` respectively. Minor spacing inconsistency in a table context.

**Spacing analysis of new code (var(--sp-*) usage):**
- Pipeline.tsx: var(--sp-2), var(--sp-3), var(--sp-5), var(--sp-6) — all declared scale values
- Controls.tsx: var(--sp-2), var(--sp-3), var(--sp-4), var(--sp-6), var(--sp-8) — all declared scale values; EMPTY_STATE uses --sp-8 (32px major section break)
- app.tsx (EmergencyStopDialog): var(--sp-3), var(--sp-4), var(--sp-6) — all declared scale values
- Sidebar.tsx (ESTOP_BTN): `'8px var(--sp-4)'` — 8px is --sp-2 per spec; could be `'var(--sp-2) var(--sp-4)'` for full tokenization, but 8px matches spec value for e-stop button padding exactly

**Arbitrary pixel values in new Phase 21 code:**
- `Pipeline.tsx:275`: `padding: '10px 16px'` (STAT_CARD) — 10px is between --sp-2 (8px) and --sp-3 (12px); not a declared token. Could use `'var(--sp-3) var(--sp-4)'` (12px/16px)
- `Pipeline.tsx:278-280`: `marginBottom: '4px'` — 4px = --sp-1, could be `var(--sp-1)`
- `Controls.tsx:362-363`: `padding: '4px 0'` in STAT_ROW — 4px = --sp-1; consistent with existing pattern in Sidebar.tsx

**Pre-existing rem usage in FeedCard.tsx, LiveFeed.tsx, Performance.tsx:** inherited, not regressed by Phase 21.

---

### Pillar 6: Experience Design (4/4)

Phase 21 sets a high bar for state coverage.

**Loading states:**
- SystemStatus.tsx: shows "Loading..." for health section before data arrives (line 160), explicit loading state for "Load more" button (line 270)
- Controls.tsx: positions loaded asynchronously; no explicit skeleton but page renders with empty positions table instantly

**Error states:**
- SystemStatus.tsx: `healthError`, `metricsError`, `alertsError` — all three sections independently handle fetch failures with spec-correct copy
- Controls.tsx: `ActionCell` error with 5s auto-dismiss (line 93-95); toggle error with 5s auto-dismiss (line 146-148)
- app.tsx EmergencyStopDialog: error state shown in dialog (line 67-68)
- All error strings match UI-SPEC copywriting contract exactly

**Empty states:**
- Pipeline.tsx: "Waiting for evaluations" heading + descriptive body copy (lines 215-219)
- Controls.tsx: "No open positions" centered empty state (line 201)
- SystemStatus.tsx: "No components registered" (line 161), "No RPC metrics recorded" (line 199), "No alerts recorded" (line 246) — all handled
- Performance.tsx: "No completed trades yet." / "No trades match filter." — pre-existing, correct

**Disabled states:**
- EXECUTE STOP button: disabled when input !== 'STOP' or executing (app.tsx:99), opacity 0.3 + cursor: not-allowed
- Destructive action gate via STOP text match — exceeds standard confirmation dialog pattern

**Interaction state coverage:**
- Force-sell: 5 states handled — initial, confirming, selling, error, 409 conflict (SELLING... badge)
- Pause/resume: optimistic update + error revert pattern
- Emergency stop: 3 states — idle, executing, error
- Alert history: paginated load-more with loading disabled state and end-of-results detection
- Auto-scroll vs manual scroll: Pipeline live/paused indicator with RESUME LIVE button

**No error boundaries** (ErrorBoundary components) present in the codebase, but the consistent per-component try/catch + error state pattern provides functional equivalence for the data-fetching failure scenarios this dashboard encounters.

---

## Files Audited

**Phase 21 new/modified frontend files:**
- `dashboard/src/components/Pipeline.tsx` (Plan 04: new full implementation)
- `dashboard/src/components/Controls.tsx` (Plan 04: new full implementation)
- `dashboard/src/components/SystemStatus.tsx` (Plan 05: new full implementation)
- `dashboard/src/components/Sidebar.tsx` (Plan 02: 6-nav overhaul, health dot, e-stop button, 3-state connection bar)
- `dashboard/src/app.tsx` (Plans 02, 04: router extension, EmergencyStopDialog)
- `dashboard/src/store/controls.ts` (Plan 02: new signals store)
- `dashboard/src/store/feed.ts` (Plan 01: new event types added)

**Pre-existing files reviewed for context:**
- `dashboard/src/components/Performance.tsx` (Plan 03: per-source analytics added)
- `dashboard/src/components/PnlChart.tsx` (Plan 03: stability refactor)
- `dashboard/src/components/FeedCard.tsx` (reference only)
- `dashboard/src/components/LiveFeed.tsx` (reference only)
- `dashboard/src/components/Settings.tsx` (reference only)

**Planning documents:**
- `.planning/phases/21-dashboard-overhaul/21-UI-SPEC.md`
- `.planning/phases/21-dashboard-overhaul/21-CONTEXT.md`
- `.planning/phases/21-dashboard-overhaul/21-01-SUMMARY.md` through `21-05-SUMMARY.md`
- `.planning/phases/21-dashboard-overhaul/21-01-PLAN.md`

---

*Registry audit: shadcn not initialized — registry safety gate skipped.*
