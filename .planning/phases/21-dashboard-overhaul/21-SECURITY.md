# Security Audit — Phase 21: Dashboard Overhaul

**Auditor:** gsd-security-auditor
**ASVS Level:** 1
**Block On:** open
**Audit Date:** 2026-04-04
**Re-audit Date:** 2026-05-26 (mitigation persistence verification — all 15 confirmed still present)

---

## Summary

**Phase:** 21 — Dashboard Overhaul
**Closed:** 15/15 | **Open:** 0/15

Re-verified 2026-05-26 against current implementation. All 10 mitigate-disposition mitigations confirmed present (some line numbers shifted; current file:line recorded below). All 5 accept-disposition rationales re-confirmed valid against current code.

---

## Accepted Risks Log

The following threats were accepted by the plan authors and are recorded here as the canonical acceptance register.

| Threat ID | Category | Component | Rationale |
|-----------|----------|-----------|-----------|
| T-21-03 | Denial of Service | POST /api/controls/emergency-stop | Emergency stop is idempotent by design; repeated calls produce consistent results (already-paused is a no-op on the pause flag; already-selling positions return `already_selling` status). No server-side amplification path. |
| T-21-05 | Information Disclosure | SAFETY_EVALUATION SSE events | Events are gated behind the global apiKeyAuth hook. Payload contains only safety evaluation results (scores, check outcomes) — no private keys, wallet balances, or secrets. |
| T-21-07 | Denial of Service | E-stop dialog open signal | `estopDialogOpen` is a client-side Preact signal. Toggling it has zero server-side effect. The actual emergency stop action requires a separate authenticated API call with STOP text confirmation. |
| T-21-08 | Tampering | Client-side P&L computation | This is a personal operator tool. P&L figures are computed from the operator's own SQLite trade data and are display-only. No computed value is written back to the server. |
| T-21-13 | Information Disclosure | Health/metrics/alerts display | All data displayed is the operational status of the operator's own bot. No third-party sensitive data is exposed beyond what Phase 20 already provides to authenticated users. |

---

## Threat Verification

### Closed Threats

| Threat ID | Category | Disposition | Evidence |
|-----------|----------|-------------|----------|
| T-21-01 | Spoofing | mitigate | `src/dashboard/auth.ts:9-15` — `apiKeyAuth` validates `x-dashboard-key` header (`:11-12`); `src/dashboard/dashboard-server.ts:68` — `fastify.addHook('onRequest', apiKeyAuth)` applied globally at line 68, before all route registrations (lines 71-77). [re-confirmed 2026-05-26, lines unchanged] |
| T-21-02 | Tampering | mitigate | `src/dashboard/routes/controls.ts:40-56` — four sequential guards: `isNaN(tradeId)` (`:40`), `getTradeById` existence (`:45-46`), `trade.state !== 'MONITORING'` (`:51`), `isSellInFlight` (`:56`); all precede `triggerSell` (`:63`). [re-confirmed 2026-05-26] |
| T-21-03 | Denial of Service | accept | Recorded in accepted risks log above. [rationale re-confirmed 2026-05-26 against `controls.ts:73-98` — idempotent pause flip + `already_selling` no-op] |
| T-21-04 | Elevation of Privilege | mitigate | `src/dashboard/routes/controls.ts:28-29` — `typeof body?.paused !== 'boolean'` rejects non-boolean bodies with 400; only a flag toggle is possible, no escalation path exists. [re-confirmed 2026-05-26, line 28 unchanged] |
| T-21-05 | Information Disclosure | accept | Recorded in accepted risks log above. [rationale re-confirmed 2026-05-26 — events gated by auth hook (`dashboard-server.ts:68` before `eventsRoute` `:71`); `Pipeline.tsx:42-110` renders only scores/check outcomes] |
| T-21-07 | Denial of Service | accept | Recorded in accepted risks log above. [rationale re-confirmed 2026-05-26 — `estopDialogOpen` client Preact signal toggled `Sidebar.tsx:197`/`Controls.tsx:188`, zero server effect] |
| T-21-08 | Tampering | accept | Recorded in accepted risks log above. [rationale re-confirmed 2026-05-26 — `Performance.tsx` `sourceStats`/`buildChartData` are display-only, no write-back] |
| T-21-09 | Denial of Service | mitigate | `dashboard/src/components/Performance.tsx:240` — `sourceStats` wrapped in `useMemo(..., [history])` (deps at `:254`); server endpoint `/api/trades/history` paginates at 200 records (existing prior-phase backend behavior). [re-confirmed 2026-05-26, line 240 unchanged] |
| T-21-10 | Denial of Service | mitigate | `dashboard/src/components/Pipeline.tsx:6` — `MAX_PIPELINE_EVENTS = 200`; `:120` `pipelineEvents` useMemo with `.slice(-MAX_PIPELINE_EVENTS)` (`:125`); `:129` `stats` useMemo. [re-confirmed 2026-05-26, lines unchanged] |
| T-21-11 | Tampering | mitigate | `dashboard/src/components/Controls.tsx:90` — `result.ok \|\| result.status === 409` treats 409 as a non-error success path, adding the position to `sellingIds` (`:91`) rather than surfacing an error. [re-confirmed 2026-05-26, line 90 unchanged] |
| T-21-12 | Repudiation | mitigate | `dashboard/src/app.tsx:61` — `canConfirm = input === 'STOP'`; `:99` — EXECUTE_BTN `disabled={!canConfirm \|\| executing}`; `:56`/`:64` — local `executing` state set true before async call prevents duplicate submissions. [re-confirmed 2026-05-26, lines unchanged] |
| T-21-13 | Information Disclosure | accept | Recorded in accepted risks log above. [rationale re-confirmed 2026-05-26 — SystemStatus consumes only operator's own `/api/health`,`/api/metrics`,`/api/alerts`, all behind auth hook] |
| T-21-15 | Denial of Service | mitigate | `dashboard/src/components/SystemStatus.tsx:91` — `ALERT_PAGE_SIZE = 50` (used in fetch at `:114`,`:147`); `:284` — load-more button gated on `!allAlertsLoaded`; server cap at 100 records enforced by Phase 20 alert route. [re-confirmed 2026-05-26 — LINES SHIFTED: ALERT_PAGE_SIZE 88→91, load-more gate 260→284; pattern intact] |
| T-21-06 | Information Disclosure | mitigate | `dashboard/src/components/Sidebar.tsx:33-34` — `lastHealthFetch` + `healthStale` state; `:74` — `Date.now() - lastHealthFetch > 30_000` staleness check; `:152` — `healthStale ? 'var(--gray)'` gray dot when stale. [re-confirmed 2026-05-26, lines unchanged] |
| T-21-14 | Tampering | mitigate | `dashboard/src/components/SystemStatus.tsx:87-89` — `lastHealthFetch`/`lastMetricsFetch`/`staleSecs` state; `:162-165` — `StaleIndicator` renders yellow `STALE {n}s ago` badge (style `STALE_LABEL` `:498-506`) when `seconds > 30`; wired into COMPONENT HEALTH header (`:175`) and RPC PERFORMANCE header (`:216`). [re-confirmed 2026-05-26 — StaleIndicator at `:162-165` matches; header wire-ins at 175/216] |

### Remediated Threats (closed during this audit)

| Threat ID | Category | Mitigation Expected | Resolution |
|-----------|----------|---------------------|------------|
| T-21-06 | Information Disclosure | Health dot in `Sidebar.tsx` shows gray when health data >30s old | `Sidebar.tsx:33-34` — `lastHealthFetch` + `healthStale` state added; `Sidebar.tsx:74` — staleness check at 30s in existing interval; `Sidebar.tsx:152` — `healthStale ? 'var(--gray)'` prioritized in dot background |
| T-21-14 | Tampering | `StaleIndicator` in `SystemStatus.tsx` shows yellow STALE label when data >30s old | `SystemStatus.tsx:87-89` — `lastHealthFetch`, `lastMetricsFetch`, `staleSecs` state added; `SystemStatus.tsx:162-164` — `StaleIndicator` component renders yellow badge with seconds-ago count; wired into COMPONENT HEALTH and RPC PERFORMANCE section headers |

---

## Unregistered Threat Flags

None. No `## Threat Flags` section was present in any of the five SUMMARY.md files (21-01 through 21-05).

---

## Security Audit 2026-04-04

| Metric | Count |
|--------|-------|
| Threats found | 15 |
| Closed | 15 |
| Open | 0 |

All threats have dispositions. Phase 21 is threat-secure.

---

## Re-audit 2026-05-26 (mitigation persistence verification)

Verification pass: confirmed each documented mitigation still exists in current implementation code, and each accepted-risk rationale still holds. Did not scan for new threats (register is complete per plan-time authoring).

| Metric | Count |
|--------|-------|
| Threats in register | 15 |
| Mitigate dispositions re-verified present | 10/10 |
| Accept dispositions re-confirmed valid | 5/5 |
| Mitigations now missing/weakened | 0 |
| Closed | 15 |
| Open | 0 |

**Line-number drift (mitigation present, location moved):**
- T-21-15 — `SystemStatus.tsx`: `ALERT_PAGE_SIZE` 88→91; load-more gate 260→284. Pattern intact (page size 50, gated on `!allAlertsLoaded`).
- T-21-14 — `SystemStatus.tsx`: `StaleIndicator` confirmed at `:162-165` (prior note `:162-164`); header wire-ins at `:175` (COMPONENT HEALTH) and `:216` (RPC PERFORMANCE).
- T-21-02 — `controls.ts`: four guards at `:40-56` (prior note `:39-57`). All four present before `triggerSell`.

All other mitigations found at the originally documented lines. No regressions. Phase 21 remains threat-secure.
