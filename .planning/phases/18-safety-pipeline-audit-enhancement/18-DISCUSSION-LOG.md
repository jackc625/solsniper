# Phase 18: Safety Pipeline Audit & Enhancement - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md -- this log preserves the alternatives considered.

**Date:** 2026-03-28
**Phase:** 18-safety-pipeline-audit-enhancement
**Areas discussed:** Audit methodology, Scoring calibration, New check design, Pipeline ordering, Pump.fun source handling, Audit report format, Config surface for new checks, Dry-run validation

---

## Audit Methodology

| Option | Description | Selected |
|--------|-------------|----------|
| Log analysis script | Parse existing pino logs + SQLite trades to produce accuracy report. Works on historical data. | |
| SQLite enrichment only | Add safety columns to trades table, analyze future trades only. | |
| Dry-run replay | Re-run pipeline against historical mints. Most thorough but slowest. | |
| Log script + SQLite enrichment | Build log analysis for historical data AND add safety columns for ongoing monitoring. | ✓ |

**User's choice:** Log script + SQLite enrichment
**Notes:** User wanted detailed explanation of each option with pros/cons before deciding. Chose the combined approach for both historical and future analysis.

### Follow-up: Rejected Token Analysis

| Option | Description | Selected |
|--------|-------------|----------|
| Skip rejected tokens | Only analyze executed trades (false negatives). | |
| Sample-check rejections | Check ~50 random rejected mints for price/status. | ✓ |
| Check all rejections | Fetch price data for every rejected mint. | |

**User's choice:** Sample-check rejections
**Notes:** Good balance between thoroughness and API cost.

---

## Scoring Calibration

| Option | Description | Selected |
|--------|-------------|----------|
| Expand weights | Add new weight entries for all checks, rebalance to sum to 100. | |
| Separate gate + score | Liquidity as hard gate, LP lock + metadata as scoring signals with penalties. | ✓ |
| Keep 3 weights, nest new checks | Fold new checks into existing weight categories. | |

**User's choice:** Separate gate + score
**Notes:** Clean separation -- hard gate catches obvious traps early, scoring handles subtler signals.

### Follow-up: Calibration Automation

| Option | Description | Selected |
|--------|-------------|----------|
| Data + recommendations | Script outputs report AND suggests new values. User reviews and applies. | ✓ |
| Data only | Report only, user decides values manually. | |
| Auto-apply with dry-run | Script calculates and applies optimal weights automatically. | |

**User's choice:** Data + recommendations

---

## New Check Design: Liquidity Depth (SAF-12)

| Option | Description | Selected |
|--------|-------------|----------|
| Jupiter quote impact | Check price impact via Jupiter quote. Reuses existing integration. | |
| On-chain pool reserves | Read Raydium/pump.fun pool account directly via getAccountInfo. | ✓ |
| DexScreener API | Query DexScreener for pool liquidity data. | |

**User's choice:** On-chain pool reserves
**Notes:** Fastest, most reliable -- single RPC call, no external API dependency.

## New Check Design: LP Lock/Burn (SAF-13)

| Option | Description | Selected |
|--------|-------------|----------|
| RugCheck API | Extract LP lock/burn from existing RugCheck response. Zero additional calls. | |
| On-chain LP token check | Check LP tokens against known burn/locker addresses. | |
| Both (RugCheck + on-chain fallback) | RugCheck primary, on-chain fallback when RugCheck unavailable. | ✓ |

**User's choice:** Both (RugCheck + on-chain fallback)

## New Check Design: Metadata Mutability (SAF-14)

| Option | Description | Selected |
|--------|-------------|----------|
| On-chain Metaplex check | Derive metadata PDA, fetch via getAccountInfo, check isMutable flag. | ✓ |
| RugCheck API extraction | Extract from RugCheck risks array. Less reliable. | |
| Both (on-chain + RugCheck) | On-chain primary, RugCheck secondary. | |

**User's choice:** On-chain Metaplex check

---

## Pipeline Ordering

### Liquidity Depth Tier

| Option | Description | Selected |
|--------|-------------|----------|
| Tier 1 parallel | Run alongside existing Tier 1 hard gates via Promise.all. | ✓ |
| Between Tier 1 and Tier 2 | Sequential after Tier 1 passes. | |
| Tier 2 with scoring checks | Treat as soft block in Tier 2. | |

**User's choice:** Tier 1 parallel

### LP Lock + Metadata Tier

| Option | Description | Selected |
|--------|-------------|----------|
| Tier 2 parallel | Add to existing Tier 2 Promise.allSettled batch. | ✓ |
| New Tier 2.5 | Separate tier after Tier 2 completes. | |
| Fold into existing checks | Piggyback entirely on existing check functions. | |

**User's choice:** Tier 2 parallel

---

## Pump.fun Source Handling

| Option | Description | Selected |
|--------|-------------|----------|
| Skip liquidity + LP, run metadata | Liquidity and LP skip for pumpportal. Metadata runs normally. | |
| Read bonding curve SOL for liquidity | Read bonding curve SOL balance as liquidity proxy. Skip LP. Run metadata. | ✓ |
| Skip all three for pump.fun | Don't run any new checks for pumpportal source. | |

**User's choice:** Read bonding curve SOL for liquidity
**Notes:** User needed detailed explanation of pump.fun bonding curve vs Raydium LP pool mechanics before deciding. Chose bonding curve SOL reading for maximum coverage -- PDA derivation already exists in tier2-holder.ts.

---

## Audit Report Format

| Option | Description | Selected |
|--------|-------------|----------|
| Markdown file | .md file with summary stats, accuracy tables, recommendations. Committable. | ✓ |
| Console output only | Print to terminal. Quick but not persisted. | |
| JSON + console summary | Machine-readable JSON + human summary. | |

**User's choice:** Markdown file

---

## Config Surface for New Checks

| Option | Description | Selected |
|--------|-------------|----------|
| Thresholds + score penalties | minLiquiditySol, lpLockScorePenalty, metadataMutablePenalty in safety config. | ✓ |
| Full weight integration | Add lpLock and metadata to safety.weights, rebalance all weights. | |
| Minimal -- just the hard gate | Only minLiquiditySol configurable, penalties hardcoded. | |

**User's choice:** Thresholds + score penalties

---

## Dry-run Validation

| Option | Description | Selected |
|--------|-------------|----------|
| Run bot in dry-run, compare logs | Apply new weights, run dry-run, manually compare pass/fail rates to audit baseline. | ✓ |
| Automated comparison script | Second script reads dry-run logs and diffs against audit baseline. | |
| Shadow mode (dual scoring) | Run old + new weights simultaneously, log both results. | |

**User's choice:** Run bot in dry-run, compare logs

---

## Claude's Discretion

- Bonding curve deserialization approach
- Known locker program IDs for LP lock on-chain fallback
- Metaplex metadata PDA derivation and parsing
- Audit script internal structure and query design
- Default values for new config thresholds
- Schema migration strategy for new trades table columns
