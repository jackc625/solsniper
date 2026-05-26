# Phase 19: Execution Performance - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md -- this log preserves the alternatives considered.

**Date:** 2026-03-30
**Phase:** 19-execution-performance
**Areas discussed:** Fee source strategy, Compute unit scope, Balance guard behavior, Sell ladder fees

---

## Fee Source Strategy

### Q1: How should Helius getPriorityFeeEstimate interact with Jupiter's built-in fee estimation?

| Option | Description | Selected |
|--------|-------------|----------|
| Helius for all paths | Single source of truth. Helius estimate used directly everywhere. Simple but adds latency to Jupiter path. | |
| Helius for PumpPortal only | Minimal change. Jupiter keeps its own estimation. But static maxLamports cap remains. | |
| Helius as smart cap | Helius sets dynamic ceiling for Jupiter + direct estimate for PumpPortal. Best accuracy. | ✓ |
| You decide | Claude picks. | |

**User's choice:** Helius as smart cap
**Notes:** User asked for detailed tradeoff explanation before selecting. Jupiter already estimates internally via priorityLevelWithMaxLamports -- Helius provides a network-aware cap rather than replacing Jupiter's estimation.

### Q2: What priority level should we request from Helius?

| Option | Description | Selected |
|--------|-------------|----------|
| veryHigh | Matches Jupiter's current setting. Targets top-of-block inclusion. | ✓ |
| High | Cheaper, still competitive. May miss first-block on congested networks. | |
| Configurable per path | veryHigh for buys, high for sells. Adds config surface. | |

**User's choice:** veryHigh
**Notes:** None

### Q3: Fallback if Helius fee estimate call fails?

| Option | Description | Selected |
|--------|-------------|----------|
| Static fallback | Fall back to existing static config values. Transaction still goes out. | ✓ |
| Fail the transaction | Don't send if no dynamic fee. Prevents over/underpaying. | |
| Hardcoded emergency value | Fixed default (e.g., 500K lamports). | |

**User's choice:** Static fallback
**Notes:** None

### Q4: Absolute max fee cap for congestion protection?

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, add maxPriorityFeeCap | New config field. Even extreme Helius estimates capped. Protects wallet. | ✓ |
| No cap needed | Trust Helius estimate. | |
| You decide | Claude picks. | |

**User's choice:** Yes, add maxPriorityFeeCap
**Notes:** None

### Q5: Global estimate or per-transaction account keys for Helius?

| Option | Description | Selected |
|--------|-------------|----------|
| Global estimate | Network-wide fee levels. Simpler. | |
| Per-transaction accounts | Pass relevant account keys for more accurate estimate. | |
| You decide | Claude picks based on API and latency. | ✓ |

**User's choice:** You decide
**Notes:** Claude's discretion on whether account keys improve accuracy enough to justify complexity.

### Q6: Cache Helius fee estimate?

| Option | Description | Selected |
|--------|-------------|----------|
| Short TTL cache | 5-10 seconds. Reduces API load. | ✓ |
| No cache | Fresh every time. Most accurate. | |
| You decide | Claude picks. | |

**User's choice:** Short TTL cache
**Notes:** None

### Q7: Log fee details per transaction?

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, log fee details | Helius estimate, cap, fallback used. Enables post-trade analysis. | ✓ |
| Minimal logging | Just final fee used. | |
| You decide | Claude picks. | |

**User's choice:** Yes, log fee details
**Notes:** None

### Q8: Keep or remove old static config fields?

| Option | Description | Selected |
|--------|-------------|----------|
| Keep as fallback | Repurpose as fallback values. No breaking config change. | ✓ |
| Replace entirely | Remove old, add new. Cleaner but breaks config.jsonc. | |
| You decide | Claude picks. | |

**User's choice:** Keep as fallback
**Notes:** None

---

## Compute Unit Scope

### Q1: Where to add explicit ComputeBudgetProgram CU limits?

| Option | Description | Selected |
|--------|-------------|----------|
| Non-Jupiter paths only | Only where we build transactions ourselves. Jupiter already handles CU. | |
| All paths including Jupiter | Override Jupiter's dynamic CU. Maximum control but complex. | |
| Skip CU entirely | Jupiter and PumpPortal already handle it. | |
| You decide | Claude investigates and decides. | ✓ |

**User's choice:** You decide
**Notes:** Claude's discretion on which self-built transaction paths need CU optimization.

### Q2: Jito bundle CU estimation approach?

| Option | Description | Selected |
|--------|-------------|----------|
| Simulate + tight limit | simulateTransaction -> consumed + 10-20% buffer. Reduces per-tx cost. | ✓ |
| Fixed generous limit | Fixed CU (e.g., 400K). Simpler, no simulation latency. | |
| You decide | Claude picks. | |

**User's choice:** Simulate + tight limit
**Notes:** None

### Q3: CU simulation on buy hot path?

| Option | Description | Selected |
|--------|-------------|----------|
| Sells only | Simulation adds ~50-100ms. Buys need first-block speed. | ✓ |
| Both buys and sells | Tightest CU everywhere but adds buy latency. | |
| You decide | Claude picks. | |

**User's choice:** Sells only
**Notes:** None

### Q4: CU logging?

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, log CU metrics | Simulated CU, limit set, actual consumed. | |
| No extra logging | Keep logs lean. | ✓ |
| You decide | Claude picks. | |

**User's choice:** No extra logging
**Notes:** None

### Q5: PumpPortal CU handling?

| Option | Description | Selected |
|--------|-------------|----------|
| Leave to PumpPortal | API builds tx server-side. We don't control CU. | ✓ |
| Investigate if possible | Check if API accepts computeUnitLimit param. | |
| You decide | Claude checks docs. | |

**User's choice:** Leave to PumpPortal
**Notes:** None

---

## Balance Guard Behavior

### Q1: Action when balance below minimum?

| Option | Description | Selected |
|--------|-------------|----------|
| Skip buy + warn log | Skip, log warning. Bot keeps running. | |
| Skip buy + dashboard alert | Skip, emit BotEventBus event for SSE dashboard alert. | ✓ |
| Pause detection entirely | Stop processing until balance recovers. | |

**User's choice:** Skip buy + dashboard alert
**Notes:** None

### Q2: Where in pipeline does balance check go?

| Option | Description | Selected |
|--------|-------------|----------|
| Before safety checks | Saves ~200-500ms of wasted work. | ✓ |
| After safety, before buy | Most accurate balance reading. | |
| You decide | Claude picks. | |

**User's choice:** Before safety checks
**Notes:** None

### Q3: Balance threshold calculation?

| Option | Description | Selected |
|--------|-------------|----------|
| Buy amount + buffer | balance >= buyAmountSol + small buffer for fees. | ✓ |
| Flat configurable threshold | Single minBalanceSol regardless of buy amount. | |
| Exact calculation | buyAmountSol + estimated fee + tx fee + rent. | |

**User's choice:** Buy amount + buffer
**Notes:** None

### Q4: Cache balance or fresh every time?

| Option | Description | Selected |
|--------|-------------|----------|
| Cached with short TTL | 5-10 seconds. Reduces RPC load during bursts. | ✓ |
| Fresh every time | Most accurate. | |
| You decide | Claude picks. | |

**User's choice:** Cached with short TTL
**Notes:** None

### Q5: Balance guard on sells too?

| Option | Description | Selected |
|--------|-------------|----------|
| Buys only | Sells must always attempt. | ✓ |
| Both buys and sells | Check before sells too. | |
| You decide | Claude picks. | |

**User's choice:** Buys only
**Notes:** None

### Q6: Buffer config approach?

| Option | Description | Selected |
|--------|-------------|----------|
| New field: minBalanceBufferSol | Dedicated config field. User can tune. | ✓ |
| Derive from priority fee config | Use maxPriorityFeeCap + fixed estimate. | |
| You decide | Claude picks. | |

**User's choice:** New field: minBalanceBufferSol
**Notes:** None

---

## Sell Ladder Fees

### Q1: Dynamic or static fees for sell ladder?

| Option | Description | Selected |
|--------|-------------|----------|
| Dynamic base, multiplier escalation | Helius as base for STANDARD step, multiplier on top for HIGH_FEE. | |
| Keep existing static approach | Sells stay static. Dynamic only for buys. | |
| Dynamic for every sell step | Fresh Helius before each ladder step. | |
| You decide | Claude picks. | ✓ |

**User's choice:** You decide
**Notes:** Claude's discretion on how sell ladder escalation interacts with dynamic fees.

### Q2: Jito bundle tip approach?

| Option | Description | Selected |
|--------|-------------|----------|
| Keep fixed Jito tip | Jito tips != priority fees. EXE-14 is v1.2 scope. | ✓ |
| Dynamic Jito tips | Scope creep for Phase 19. | |
| You decide | Claude picks. | |

**User's choice:** Keep fixed Jito tip
**Notes:** Dynamic Jito tips explicitly deferred to EXE-14 (v1.2).

### Q3: PumpPortal sell path dynamic fees?

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, same as buy path | Consistent. No extra API calls thanks to cache. | ✓ |
| Keep static for PP sells | Low-volume path, not worth changing. | |
| You decide | Claude picks. | |

**User's choice:** Yes, same as buy path
**Notes:** None

### Q4: Same fee cap for buys and sells?

| Option | Description | Selected |
|--------|-------------|----------|
| Same cap | One maxPriorityFeeCapLamports for both. Sell ladder has its own escalation. | ✓ |
| Separate higher cap for sells | Failing to exit is costlier than missing a buy. | |
| You decide | Claude picks. | |

**User's choice:** Same cap
**Notes:** None

### Q5: HIGH_FEE escalation step capping?

| Option | Description | Selected |
|--------|-------------|----------|
| Always capped | Even HIGH_FEE within maxPriorityFeeCap. Jito handles emergency. | |
| HIGH_FEE can exceed cap | Escalation means paying more. Cap only on STANDARD. | |
| You decide | Claude picks based on wallet drain risk vs exit urgency. | ✓ |

**User's choice:** You decide
**Notes:** Claude's discretion on tradeoff.

---

## Claude's Discretion

- Account keys vs global estimate for Helius getPriorityFeeEstimate (Fee Q5)
- Which self-built transaction paths need explicit CU limits (CU Q1)
- Sell ladder dynamic fee interaction with multiplier escalation (Sell Q1)
- HIGH_FEE escalation cap behavior (Sell Q5)

## Deferred Ideas

- Dynamic Jito tip amounts (EXE-14, v1.2 scope)
- Per-transaction account-based fee estimation (try global first)
