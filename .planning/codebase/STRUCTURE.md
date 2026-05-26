# Codebase Structure

**Analysis Date:** 2026-02-20

## Directory Layout

```
solsniper/
├── src/                         # Main application source code
│   ├── index.ts                 # Bot entry point, lifecycle management
│   ├── config/                  # Configuration management
│   │   └── config.ts            # Load env vars, build config object
│   ├── core/                    # Core abstractions
│   │   ├── logger.ts            # Pino logger configuration
│   │   ├── rpc-manager.ts       # Multi-RPC failover abstraction
│   │   └── transaction-builder.ts # Versioned transaction helpers
│   ├── detection/               # Token detection subsystem
│   │   ├── pump-portal-listener.ts # PumpPortal WebSocket subscription
│   │   ├── raydium-listener.ts  # Raydium pool detection via logsSubscribe
│   │   └── detector.ts          # Main detection orchestrator
│   ├── safety/                  # Safety checks subsystem
│   │   ├── checker.ts           # Parallel safety check runner
│   │   ├── mint-authority.ts    # Tier 1: Mint authority validation
│   │   ├── freeze-authority.ts  # Tier 1: Freeze authority validation
│   │   ├── sell-simulation.ts   # Tier 1: Sell route validation via Jupiter
│   │   ├── holder-concentration.ts # Tier 2: Top holder check
│   │   ├── rug-check-api.ts     # Tier 2: RugCheck.xyz integration
│   │   ├── metadata-check.ts    # Tier 2: Metadata mutability check
│   │   └── scoring.ts           # Safety score calculation logic
│   ├── execution/               # Transaction execution subsystem
│   │   ├── swap-executor.ts     # Retry escalation logic (buy + sell)
│   │   ├── buy-flow.ts          # Buy transaction pipeline
│   │   ├── sell-flow.ts         # Sell transaction pipeline
│   │   ├── jupiter-api.ts       # Jupiter Swap API client
│   │   ├── pump-portal-api.ts   # PumpPortal trade-local API client
│   │   ├── jito-bundle.ts       # Jito bundle construction and submission
│   │   └── confirmation.ts      # Transaction confirmation polling
│   ├── position/                # Position monitoring subsystem
│   │   ├── position.ts          # Position data structure
│   │   ├── position-monitor.ts  # Polling-based position monitor
│   │   ├── exit-evaluator.ts    # Exit condition logic (SL, TP, trailing)
│   │   └── pnl-calculator.ts    # PnL and return calculation
│   ├── db/                      # Persistence layer
│   │   ├── schema.sql           # SQLite schema definition
│   │   ├── trade-journal.ts     # Trade database operations
│   │   └── init.ts              # Database initialization and migration
│   ├── types/                   # TypeScript type definitions
│   │   ├── index.ts             # Main type exports
│   │   ├── trade.ts             # Trade, Position, TradeState types
│   │   ├── safety.ts            # SafetyScore, SafetyCheck types
│   │   ├── config.ts            # Configuration type
│   │   └── api.ts               # API response types (Jupiter, PumpPortal)
│   ├── utils/                   # Shared utilities
│   │   ├── constants.ts         # Magic numbers, program IDs, etc.
│   │   ├── time.ts              # Timestamp formatting, blockhash expiry checks
│   │   ├── price.ts             # Price conversions, lamports ↔ SOL
│   │   ├── wallet.ts            # Keypair loading, balance checking
│   │   └── retry.ts             # Exponential backoff helpers
│   └── modes/                   # Simulation/testing modes
│       ├── simulation.ts        # Simulation mode (no real trades)
│       └── shadow-portfolio.ts  # Shadow portfolio tracking
├── tests/                       # Test suites
│   ├── unit/                    # Unit tests
│   │   ├── safety/              # Safety check tests
│   │   ├── execution/           # Execution and retry logic tests
│   │   └── utils/               # Utility function tests
│   ├── integration/             # Integration tests
│   │   ├── pump-portal.test.ts  # PumpPortal detection flow
│   │   ├── jupiter-swap.test.ts # Jupiter swap execution
│   │   └── position-monitor.test.ts # Position tracking flow
│   └── fixtures/                # Test data
│       ├── tokens.ts            # Known token mints for testing
│       └── transactions.ts      # Serialized transactions for testing
├── .env.example                 # Environment variable template
├── package.json                 # Dependencies and scripts
├── tsconfig.json                # TypeScript configuration
├── jest.config.js               # (or vitest.config.ts) Test runner config
├── .prettierrc                  # Code formatting rules
├── .eslintrc.json               # Linting rules
├── README.md                    # Project documentation
├── ROADMAP.md                   # Development roadmap (from research)
└── solana-sniper-bot-research.md # Full research document (reference)
```

## Directory Purposes

**src/:**
- Purpose: Main application logic and implementation
- Contains: All TypeScript source code organized by subsystem
- Key files: `index.ts` (entry point), `config/config.ts` (configuration)

**src/core/:**
- Purpose: Core reusable abstractions used across subsystems
- Contains: Logger setup, RPC management, transaction building utilities
- Key files: `logger.ts`, `rpc-manager.ts`, `transaction-builder.ts`

**src/detection/:**
- Purpose: Token detection via multiple sources
- Contains: PumpPortal WebSocket listener, Raydium pool detection via logsSubscribe
- Key files: `pump-portal-listener.ts`, `detector.ts`

**src/safety/:**
- Purpose: Safety checks to filter scams and honeypots
- Contains: Mint/freeze authority validation, honeypot detection, RugCheck integration
- Key files: `checker.ts` (orchestrator), `mint-authority.ts`, `freeze-authority.ts`, `sell-simulation.ts`, `rug-check-api.ts`

**src/execution/:**
- Purpose: Transaction execution with retry escalation
- Contains: Jupiter Swap API, PumpPortal trade API, Jito bundles, confirmation logic
- Key files: `swap-executor.ts` (retry ladder), `buy-flow.ts`, `sell-flow.ts`, `jupiter-api.ts`

**src/position/:**
- Purpose: Position tracking and exit management
- Contains: Position data, polling monitor, exit evaluation, PnL calculation
- Key files: `position-monitor.ts`, `exit-evaluator.ts`, `pnl-calculator.ts`

**src/db/:**
- Purpose: SQLite persistence and state recovery
- Contains: Schema definition, trade journal operations, crash recovery
- Key files: `schema.sql`, `trade-journal.ts`

**src/types/:**
- Purpose: TypeScript type definitions for data structures
- Contains: Trade, Position, SafetyScore, configuration types
- Key files: `trade.ts`, `safety.ts`, `config.ts`, `api.ts`

**src/utils/:**
- Purpose: Shared helper functions and constants
- Contains: Program IDs, price conversions, retry logic, wallet utilities
- Key files: `constants.ts`, `price.ts`, `wallet.ts`, `retry.ts`

**src/modes/:**
- Purpose: Alternative operating modes for testing and shadow trading
- Contains: Simulation mode (no real trades), shadow portfolio tracking
- Key files: `simulation.ts`, `shadow-portfolio.ts`

**tests/:**
- Purpose: Test suites for code validation
- Contains: Unit tests, integration tests, test fixtures
- Key files: Test files mirror `src/` structure with `.test.ts` suffix

## Key File Locations

**Entry Points:**
- `src/index.ts`: Main bot process, initializes all subsystems, handles bot lifecycle and graceful shutdown

**Configuration:**
- `src/config/config.ts`: Load and validate environment variables, return config object
- `.env.example`: Template for required environment variables (wallet key, RPC endpoints, etc.)

**Core Logic:**
- `src/detection/detector.ts`: Orchestrates detection from multiple sources
- `src/safety/checker.ts`: Runs Tier 1-3 safety checks in parallel
- `src/execution/swap-executor.ts`: Handles retry escalation for buys and sells
- `src/position/position-monitor.ts`: Polls positions and triggers exits

**Database:**
- `src/db/schema.sql`: SQLite schema for trades table
- `src/db/trade-journal.ts`: CRUD operations for persisting trades

**Testing:**
- `tests/unit/`: Unit tests for individual functions/modules
- `tests/integration/`: End-to-end tests for major flows (detection → buy → sell)

## Naming Conventions

**Files:**
- Kebab-case: `pump-portal-listener.ts`, `position-monitor.ts`
- Suffixes: `.test.ts` for tests, `.ts` for implementation
- Single responsibility: Each file is typically <300 lines and handles one concern

**Directories:**
- Lowercase: `src/`, `tests/`, `detection/`, `safety/`
- Functional grouping by subsystem: `detection/`, `execution/`, `position/`

**Functions:**
- camelCase: `runSafetyChecks()`, `executeSwap()`, `confirmTransaction()`
- Async functions explicitly marked: `async getJupiterQuote()`, `async checkMintAuthority()`
- Descriptive verbs: `get*()` for fetching, `check*()` for validation, `run*()` for orchestration

**Variables:**
- camelCase: `walletKeypair`, `positionMint`, `estimatedPrice`
- Constants: UPPER_SNAKE_CASE: `MAX_SLIPPAGE_PERCENT`, `RAYDIUM_PROGRAM_ID`
- Booleans: `is*` or `has*`: `isMutable`, `hasFreezAuthority`

**Types:**
- PascalCase: `SafetyScore`, `TradeJournal`, `SwapQuote`
- Interfaces prefixed with `I` (optional): `ISwapExecutor` or just `SwapExecutor`
- Enums: `TradeState`, `PriorityLevel`

## Where to Add New Code

**New Feature (Detection, Safety, Execution):**
- Primary code: `src/{subsystem}/` directory matching the feature type
- Example: New detection source → `src/detection/new-source-listener.ts`
- Update orchestrator: `src/detection/detector.ts` to integrate the new source
- Tests: `tests/unit/{subsystem}/` and `tests/integration/`

**New Component/Module:**
- Significant new functionality → Create `src/{subsystem}/new-module.ts`
- Shared utility → Add to `src/utils/`
- Type definitions → Add to `src/types/`
- Export from subsystem barrel (if present): `src/{subsystem}/index.ts`

**Utilities and Helpers:**
- Shared price conversion → `src/utils/price.ts`
- Retry logic → `src/utils/retry.ts`
- Time-related helpers → `src/utils/time.ts`
- Constants and magic numbers → `src/utils/constants.ts`

**Tests:**
- Unit test for `src/safety/mint-authority.ts` → `tests/unit/safety/mint-authority.test.ts`
- Integration test for buy flow → `tests/integration/buy-flow.test.ts`
- Test fixtures (known tokens, mocked APIs) → `tests/fixtures/`

**Configuration:**
- Environment-specific settings → `src/config/config.ts`
- Feature flags (simulation mode, test mode) → Config object in `src/config/config.ts`

## Special Directories

**src/modes/:**
- Purpose: Alternative execution modes for testing without real trades
- Generated: No (static code)
- Committed: Yes (part of codebase)
- Contains: Simulation mode (shadow trading), test mode configuration

**src/db/:**
- Purpose: Database initialization and operations
- Generated: `db.sqlite` file is generated at runtime in `src/` or project root
- Committed: No (SQLite database is runtime state, not source code)
- Schema should be committed: Yes (`schema.sql` is committed; actual db is ignored in `.gitignore`)

**tests/fixtures/:**
- Purpose: Static test data (known mints, mock transactions)
- Generated: No (hand-written test data)
- Committed: Yes (part of test suite)

**dist/ (after build):**
- Purpose: Compiled JavaScript output
- Generated: Yes (by TypeScript compiler or build tool)
- Committed: No (add to `.gitignore`)

**node_modules/**
- Purpose: Third-party dependencies
- Generated: Yes (by npm/pnpm from package.json)
- Committed: No (standard `.gitignore` entry)

---

*Structure analysis: 2026-02-20*
