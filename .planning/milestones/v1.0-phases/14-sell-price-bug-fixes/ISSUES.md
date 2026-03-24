Investigation Findings: PnL Never Updates on Dashboard

The Bug

sellPriceSol is never calculated or stored in the database during sell execution. Since all PnL calculations depend on this field, every PnL display reads NULL and shows zero/empty.

Data Flow Trace

Buy side (works correctly):
- execution-engine.ts:85 computes buyPriceSol = buyAmountSol / amountTokens
- execution-engine.ts:86-91 passes it to tradeStore.transition() → stored in buy_price_sol column

Sell side (broken):
- sell-ladder.ts:163-165 transitions SELLING→COMPLETED but only passes { sellSignature } — no sellPriceSol
- The Jupiter quote response contains outAmount (expected SOL output in lamports), but all three sellers (standardSell, jitoSell, pumpPortalSell) discard it and return only the signature string
- trade-store.ts:211 receives null for sell_price_sol → column stays NULL in SQLite

After the transition, sell-ladder tries to read PnL back:
- sell-ladder.ts:167-169 does completedTrade.sellPriceSol - completedTrade.buyPriceSol — but sellPriceSol is null, so pnlSol evaluates to undefined
- The SELL_CONFIRMED event emitted at line 170 carries pnlSol: undefined

Dashboard queries fail silently:
- trades.ts:45-46 (history endpoint): CASE WHEN sell_price_sol IS NOT NULL AND buy_price_sol IS NOT NULL THEN ... ELSE NULL END → always NULL because sell_price_sol is never set
- trades.ts:71-72 (stats endpoint): SUM(CASE WHEN sell_price_sol IS NOT NULL ... THEN sell_price_sol - buy_price_sol ELSE 0 END) → always 0

Frontend renders the zeroes:
- The chart filters with .filter(t => t.pnl_sol !== null) — excludes every trade → shows "No completed trades yet"
- Total P&L reads totalPnlSol from /api/stats → always 0
- The "Completed" count works because it uses COUNT(*) which doesn't depend on sell_price_sol

Secondary Issue: PnL Math

Even once sellPriceSol is populated, there's a semantic mismatch. buyPriceSol is stored as SOL per raw token unit (e.g., 0.001 SOL / 1000000 raw units = 0.000000001). The dashboard SQL computes PnL as:

sell_price_sol - buy_price_sol

This gives per-raw-token-unit PnL — a tiny number. To get actual SOL profit per trade, the SQL needs to multiply by amount_tokens. The current SUM(sell_price_sol - buy_price_sol) across trades is meaningless without that multiplication.

Summary

Two things need fixing:
1. Sellers need to return the Jupiter quote outAmount, sell-ladder needs to compute sellPriceSol = solReceived / tokenAmount and pass it to transition()
2. Dashboard SQL needs (sell_price_sol - buy_price_sol) * amount_tokens to produce actual SOL PnL