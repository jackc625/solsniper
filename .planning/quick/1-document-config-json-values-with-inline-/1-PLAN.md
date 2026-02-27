---
phase: quick
plan: 1
type: execute
wave: 1
depends_on: []
files_modified:
  - config.json
autonomous: true
requirements:
  - QUICK-01
must_haves:
  truths:
    - "Every field in config.json has an inline comment explaining its purpose"
    - "Comments are brief, readable, and targeted at developers and non-technical users"
    - "The file remains valid JSON5-style (comments preserved as JSON is not comment-safe — use a .jsonc approach or convert format)"
  artifacts:
    - path: "config.json"
      provides: "Self-documenting configuration file"
      contains: "comment for every key"
  key_links:
    - from: "config.json"
      to: "developers/users"
      via: "inline comments on each field"
---

<objective>
Add a short inline comment above or beside each field in config.json so front-end developers and users can immediately understand what each value controls without reading source code.

Purpose: config.json is the primary user-facing configuration surface. Right now it is opaque — field names like `minSafetyScore`, `priorityFeeBaseLamports`, or `jitoTipLamports` are not self-explanatory to anyone who hasn't read the codebase.
Output: A commented config file where every field has a one-line description of its purpose, expected range, and units where relevant.
</objective>

<execution_context>
@C:/Users/jackc/.claude/get-shit-done/workflows/execute-plan.md
@C:/Users/jackc/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/STATE.md
</context>

<tasks>

<task type="auto">
  <name>Task 1: Convert config.json to config.jsonc and add inline comments</name>
  <files>config.json</files>
  <action>
JSON does not support comments. Add comments using JSON with Comments (JSONC) format — VS Code, most editors, and many Node.js loaders support .jsonc. However, the project currently loads config.json at runtime.

Check how config.json is loaded in src/:

```bash
grep -rn "config.json" src/
```

If loaded via fs.readFileSync + JSON.parse, switch to a JSONC-aware parse (use the `jsonc-parser` npm package, or strip comments with a regex before JSON.parse). If loaded another way, adapt accordingly.

Approach:
1. Rename config.json to config.jsonc (keeping config.json as a symlink or updating import paths).
2. Add inline `//` comments above or beside each field explaining its purpose, units, and typical range.
3. Update the runtime loader to handle JSONC (strip-json-comments or jsonc-parser).

ALTERNATIVELY — if the runtime loader change is more complex than expected (e.g., dynamic require or third-party lib reads config.json directly), instead keep the file as config.json but add a companion config.example.jsonc with identical structure plus comments. This is the fallback if renaming breaks the loader.

Comment content for each field (use these exact descriptions):

Top-level:
- buyAmountSol: "SOL to spend on each buy. E.g. 0.01 = 0.01 SOL per token launch."
- maxSlippageBps: "Maximum price slippage allowed in basis points (100 bps = 1%). Protects against sandwich attacks."
- maxConcurrentPositions: "Maximum number of open token positions held simultaneously."
- stopLossPct: "Sell all tokens if position drops below this % from buy price. Negative number (e.g. -50 = -50%)."
- takeProfitPct: "Sell tokens when position gains this % above buy price (e.g. 300 = 3x)."
- minSafetyScore: "Minimum composite safety score (0-100) a token must pass before buying. Higher = safer, fewer buys."

detection:
- wsHeartbeatIntervalMs: "How often (ms) to send a ping to keep WebSocket connections alive. Default: 30 000 ms (30 s)."
- wsBaseBackoffMs: "Starting reconnect delay (ms) after a WebSocket disconnects. Doubles on each retry."
- wsMaxBackoffMs: "Maximum reconnect delay (ms) — caps the exponential backoff ceiling."
- wsExcessiveReconnectThreshold: "Number of reconnects within wsExcessiveReconnectWindowMs that triggers an alert."
- wsExcessiveReconnectWindowMs: "Rolling time window (ms) used to count excessive reconnects. Default: 600 000 ms (10 min)."
- statsIntervalMs: "How often (ms) detection stats are logged. Default: 900 000 ms (15 min)."
- dedupWindowMs: "How long (ms) a seen mint is remembered to prevent duplicate buy attempts. Default: 3 600 000 ms (1 hr)."

safety:
- tier2TimeoutMs: "Max wait (ms) for Tier-2 safety checks (holder concentration, rug check) before they time out and score 0."
- tier3TimeoutMs: "Max wait (ms) for Tier-3 safety checks (creator history) before they time out and score 0."
- cacheTtlMs: "How long (ms) safety check results are cached to avoid redundant RPC calls. Default: 300 000 ms (5 min)."
- weights.rugCheck: "Score weight (out of 100) given to the rug-check result in the composite safety score."
- weights.holder: "Score weight (out of 100) given to holder concentration analysis."
- weights.creator: "Score weight (out of 100) given to creator history analysis."
- holder.top1SoftBlockThreshold: "Fraction of supply (0–1) held by the top wallet that triggers a soft safety penalty. E.g. 0.25 = 25%."
- holder.top10SoftBlockThreshold: "Fraction of supply (0–1) held by the top 10 wallets combined that triggers a soft safety penalty."
- rugCheckScoreInverted: "Set true if the rug-check API returns risk scores (high = bad). The bot inverts them to safety scores (high = good)."
- blocklistPath: "Path to the JSON file that persists banned creator wallet addresses across restarts."

execution.buy:
- slippageBps: "Slippage tolerance for buy transactions in basis points (100 = 1%). Independent of top-level maxSlippageBps."
- priorityFeeBaseLamports: "Base Solana priority fee in lamports added to every buy transaction to improve landing speed."
- priorityFeeMultiplier: "Multiplier applied to the base priority fee. Set >1 to pay higher fees during congestion."

execution.sell:
- standardSlippageBps: "Slippage for normal sell attempts (basis points). 500 = 5%."
- emergencySlippageBps: "Slippage for emergency sell escalation (basis points). 4900 = 49% — used when all else fails."
- standardTimeoutMs: "Timeout (ms) for a standard sell attempt before escalating to next tier."
- highFeeTimeoutMs: "Timeout (ms) for a high-priority-fee sell attempt."
- highFeeMultiplier: "Priority fee multiplier applied during high-fee sell escalation (e.g. 3 = 3x base fee)."
- jitoTimeoutMs: "Timeout (ms) to wait for Jito bundle confirmation during sell escalation."
- jitoTipLamports: "Lamports paid as a Jito tip to validators for bundle inclusion."
- chunkedTimeoutMs: "Timeout (ms) for a chunked sell attempt (selling in tranches when normal sells fail)."
- emergencyTimeoutMs: "Timeout (ms) for the final emergency sell attempt at max slippage."
- emergencyPriorityMultiplier: "Priority fee multiplier during emergency sells (e.g. 10 = 10x base fee)."
  </action>
  <verify>
Open config.jsonc (or config.json if kept) and confirm every field listed above has a comment. Run `pnpm run build` or `rtk tsc` to confirm TypeScript still compiles with the updated loader (if loader was changed).
  </verify>
  <done>
Every field in the config file has a meaningful inline comment. The bot still starts and loads configuration without errors (`pnpm run dev` or equivalent launches without crashes related to config parsing).
  </done>
</task>

</tasks>

<verification>
- config.jsonc (or config.json) has a comment on every top-level and nested field
- Comment describes purpose, units, and typical values where relevant
- Runtime config loading is not broken — bot can start and parse config
- TypeScript build passes (if loader code was modified)
</verification>

<success_criteria>
A developer or user opening config.json/config.jsonc for the first time can understand what to change without reading any source code. Every field has a one-line comment covering: what it does, units (ms, bps, SOL, lamports, %), and example/typical values where helpful.
</success_criteria>

<output>
No SUMMARY.md required for quick plans.
</output>
