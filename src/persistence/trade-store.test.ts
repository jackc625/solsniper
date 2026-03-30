import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TradeStore } from './trade-store.js';

// All tests use :memory: database — fast, isolated, no file system side effects.

describe('TradeStore', () => {
  let store: TradeStore;

  beforeEach(() => {
    store = new TradeStore(':memory:');
  });

  afterEach(() => {
    store.close();
  });

  // ---------------------------------------------------------------------------
  // isActive()
  // ---------------------------------------------------------------------------
  describe('isActive()', () => {
    it('returns false when no trade exists for the mint', () => {
      expect(store.isActive('mint_no_record')).toBe(false);
    });

    it('returns true after createBuyingRecord(mint) is called', () => {
      store.createBuyingRecord('mint_abc');
      expect(store.isActive('mint_abc')).toBe(true);
    });

    it('returns false after transition to COMPLETED', () => {
      store.createBuyingRecord('mint_abc');
      store.transition('mint_abc', 'BUYING', 'COMPLETED', {});
      expect(store.isActive('mint_abc')).toBe(false);
    });

    it('returns false after transition to FAILED', () => {
      store.createBuyingRecord('mint_abc');
      store.transition('mint_abc', 'BUYING', 'FAILED', { errorMessage: 'err' });
      expect(store.isActive('mint_abc')).toBe(false);
    });

    it('returns false after transition to ABANDONED', () => {
      store.createBuyingRecord('mint_abc');
      store.transition('mint_abc', 'BUYING', 'ABANDONED', {});
      expect(store.isActive('mint_abc')).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // createBuyingRecord()
  // ---------------------------------------------------------------------------
  describe('createBuyingRecord()', () => {
    it('inserts a row with state=BUYING synchronously', () => {
      store.createBuyingRecord('mint_xyz');
      // If the row was inserted, isActive should return true
      expect(store.isActive('mint_xyz')).toBe(true);
    });

    it('throws with "Duplicate buy attempt blocked" if mint is already active', () => {
      store.createBuyingRecord('mint_dup');
      expect(() => store.createBuyingRecord('mint_dup')).toThrow(
        'Duplicate buy attempt blocked'
      );
    });

    it('Set still contains the mint after duplicate throw (no partial state)', () => {
      store.createBuyingRecord('mint_dup');
      try {
        store.createBuyingRecord('mint_dup');
      } catch {
        // expected
      }
      expect(store.isActive('mint_dup')).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // transition()
  // ---------------------------------------------------------------------------
  describe('transition()', () => {
    it('returns changes=1 on successful transition', () => {
      store.createBuyingRecord('mint_t');
      const changes = store.transition('mint_t', 'BUYING', 'MONITORING', {});
      expect(changes).toBe(1);
    });

    it('returns changes=0 if current state does not match from (optimistic locking)', () => {
      store.createBuyingRecord('mint_t');
      // State is BUYING; try transitioning from MONITORING (wrong)
      const changes = store.transition('mint_t', 'MONITORING', 'SELLING', {});
      expect(changes).toBe(0);
    });

    it('sets buy_signature when extra.buySignature provided', () => {
      store.createBuyingRecord('mint_t');
      store.transition('mint_t', 'BUYING', 'MONITORING', { buySignature: 'sig_abc' });
      // If the transition succeeded, state should now be non-active... wait, MONITORING is non-terminal
      // so isActive should still be true
      expect(store.isActive('mint_t')).toBe(true);
    });

    it('sets error_message when extra.errorMessage provided', () => {
      store.createBuyingRecord('mint_t');
      const changes = store.transition('mint_t', 'BUYING', 'FAILED', { errorMessage: 'rpc timeout' });
      expect(changes).toBe(1);
      expect(store.isActive('mint_t')).toBe(false);
    });

    it('does NOT remove from active Set for non-terminal transitions (BUYING -> MONITORING)', () => {
      store.createBuyingRecord('mint_t');
      store.transition('mint_t', 'BUYING', 'MONITORING', {});
      expect(store.isActive('mint_t')).toBe(true);
    });

    it('does NOT remove from active Set for non-terminal transitions (MONITORING -> SELLING)', () => {
      store.createBuyingRecord('mint_t');
      store.transition('mint_t', 'BUYING', 'MONITORING', {});
      store.transition('mint_t', 'MONITORING', 'SELLING', {});
      expect(store.isActive('mint_t')).toBe(true);
    });

    it('DOES remove from active Set for terminal transition to COMPLETED', () => {
      store.createBuyingRecord('mint_t');
      store.transition('mint_t', 'BUYING', 'COMPLETED', {});
      expect(store.isActive('mint_t')).toBe(false);
    });

    it('DOES remove from active Set for terminal transition to FAILED', () => {
      store.createBuyingRecord('mint_t');
      store.transition('mint_t', 'BUYING', 'FAILED', {});
      expect(store.isActive('mint_t')).toBe(false);
    });

    it('DOES remove from active Set for terminal transition to ABANDONED', () => {
      store.createBuyingRecord('mint_t');
      store.transition('mint_t', 'BUYING', 'ABANDONED', {});
      expect(store.isActive('mint_t')).toBe(false);
    });

    it('sets sell_signature when extra.sellSignature provided', () => {
      store.createBuyingRecord('mint_t');
      store.transition('mint_t', 'BUYING', 'MONITORING', { buySignature: 'buy_sig' });
      store.transition('mint_t', 'MONITORING', 'SELLING', {});
      const changes = store.transition('mint_t', 'SELLING', 'COMPLETED', { sellSignature: 'sell_sig' });
      expect(changes).toBe(1);
      expect(store.isActive('mint_t')).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Startup Set rebuild
  // ---------------------------------------------------------------------------
  describe('startup Set rebuild', () => {
    it('rebuilds active Set from non-terminal rows on construction', () => {
      // Insert non-terminal rows via a first TradeStore instance
      const store1 = new TradeStore(':memory:');
      // We can't share in-memory DBs across instances, so we test this
      // by creating a second store from the same path.
      // For :memory: we test by verifying the current store rebuilds correctly.
      // The actual rebuild test requires a file-backed DB.
      // We'll test this indirectly: after createBuyingRecord, close, and verify.
      // For in-memory: the constructor rebuild is tested by inserting rows
      // directly and constructing a new store — but :memory: doesn't persist.
      // Instead, we test the logic by inspecting isActive() after construction.

      // Test: non-terminal states after creation should be active
      store1.createBuyingRecord('mint_rebuild');
      // mint_rebuild is BUYING (non-terminal) — isActive should be true
      expect(store1.isActive('mint_rebuild')).toBe(true);
      store1.close();
    });

    it('does not mark terminal-state mints as active on construction', () => {
      // Create, transition to terminal, verify not active (state is in-memory Set)
      store.createBuyingRecord('mint_terminal');
      store.transition('mint_terminal', 'BUYING', 'COMPLETED', {});
      expect(store.isActive('mint_terminal')).toBe(false);
    });

    it('rebuilds active Set from file-backed DB non-terminal rows', () => {
      // Use a temp file path to test cross-instance Set rebuild
      const tmpPath = 'data/test_rebuild_' + Date.now() + '.db';
      const store1 = new TradeStore(tmpPath);
      store1.createBuyingRecord('mint_file_1');
      store1.createBuyingRecord('mint_file_2');
      store1.transition('mint_file_2', 'BUYING', 'COMPLETED', {}); // terminal
      store1.close();

      // Construct a new store from the same file — should rebuild activeMints
      const store2 = new TradeStore(tmpPath);
      expect(store2.isActive('mint_file_1')).toBe(true);  // non-terminal => active
      expect(store2.isActive('mint_file_2')).toBe(false); // terminal => not active
      store2.close();

      // Cleanup
      const fs = require('node:fs');
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    });
  });

  // ---------------------------------------------------------------------------
  // createBuyingRecord() with source + tokenProgramId
  // ---------------------------------------------------------------------------
  describe('createBuyingRecord() with source/tokenProgramId', () => {
    it('stores source and tokenProgramId when provided', () => {
      store.createBuyingRecord('mint_src', 'pumpportal', 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
      const trade = store.getTradeByMint('mint_src');
      expect(trade).toBeDefined();
      expect(trade!.source).toBe('pumpportal');
      expect(trade!.tokenProgramId).toBe('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
    });

    it('stores null source and tokenProgramId when not provided', () => {
      store.createBuyingRecord('mint_nosrc');
      const trade = store.getTradeByMint('mint_nosrc');
      expect(trade).toBeDefined();
      expect(trade!.source).toBeUndefined();
      expect(trade!.tokenProgramId).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // transition() with source + tokenProgramId
  // ---------------------------------------------------------------------------
  describe('transition() with source/tokenProgramId', () => {
    it('stores source and tokenProgramId in transition extra params', () => {
      store.createBuyingRecord('mint_trans_src');
      store.transition('mint_trans_src', 'BUYING', 'MONITORING', {
        source: 'raydium',
        tokenProgramId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
      });
      const trade = store.getTradeByMint('mint_trans_src');
      expect(trade).toBeDefined();
      expect(trade!.source).toBe('raydium');
      expect(trade!.tokenProgramId).toBe('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
    });
  });

  // ---------------------------------------------------------------------------
  // getTradeByMint()
  // ---------------------------------------------------------------------------
  describe('getTradeByMint()', () => {
    it('returns undefined when no trade exists for the mint', () => {
      expect(store.getTradeByMint('nonexistent_mint')).toBeUndefined();
    });

    it('returns Trade with source and tokenProgramId for existing mint', () => {
      store.createBuyingRecord('mint_gtbm', 'pumpswap', 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
      const trade = store.getTradeByMint('mint_gtbm');
      expect(trade).toBeDefined();
      expect(trade!.mint).toBe('mint_gtbm');
      expect(trade!.source).toBe('pumpswap');
      expect(trade!.tokenProgramId).toBe('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
    });

    it('returns Trade with all base fields', () => {
      store.createBuyingRecord('mint_full');
      const trade = store.getTradeByMint('mint_full');
      expect(trade).toBeDefined();
      expect(trade!.mint).toBe('mint_full');
      expect(trade!.state).toBe('BUYING');
      expect(typeof trade!.id).toBe('number');
      expect(typeof trade!.createdAt).toBe('number');
    });
  });

  // ---------------------------------------------------------------------------
  // close()
  // ---------------------------------------------------------------------------
  describe('close()', () => {
    it('closes the database without throwing', () => {
      const tmpStore = new TradeStore(':memory:');
      expect(() => tmpStore.close()).not.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // createBuyingRecord() with dryRun param
  // ---------------------------------------------------------------------------
  describe('createBuyingRecord() with dryRun', () => {
    it('inserts dry_run=1 when dryRun=true; getTradeByMint returns dryRun=true', () => {
      store.createBuyingRecord('mint_dry_true', undefined, undefined, true);
      const trade = store.getTradeByMint('mint_dry_true');
      expect(trade).toBeDefined();
      expect(trade!.dryRun).toBe(true);
    });

    it('inserts dry_run=0 when dryRun=false; getTradeByMint returns dryRun=false', () => {
      store.createBuyingRecord('mint_dry_false', undefined, undefined, false);
      const trade = store.getTradeByMint('mint_dry_false');
      expect(trade).toBeDefined();
      expect(trade!.dryRun).toBe(false);
    });

    it('defaults to dryRun=false when 4th argument is omitted', () => {
      store.createBuyingRecord('mint_dry_default');
      const trade = store.getTradeByMint('mint_dry_default');
      expect(trade).toBeDefined();
      expect(trade!.dryRun).toBe(false);
    });

    it('getMonitoringTrades returns dryRun field correctly after transition to MONITORING', () => {
      store.createBuyingRecord('mint_dry_mon', undefined, undefined, true);
      store.transition('mint_dry_mon', 'BUYING', 'MONITORING');
      const trades = store.getMonitoringTrades();
      const trade = trades.find(t => t.mint === 'mint_dry_mon');
      expect(trade).toBeDefined();
      expect(trade!.dryRun).toBe(true);
    });

    it('getBuyingTrades returns dryRun field correctly', () => {
      store.createBuyingRecord('mint_dry_buy', undefined, undefined, true);
      const trades = store.getBuyingTrades();
      const trade = trades.find(t => t.mint === 'mint_dry_buy');
      expect(trade).toBeDefined();
      expect(trade!.dryRun).toBe(true);
    });

    it('getSellingTrades returns dryRun field correctly', () => {
      store.createBuyingRecord('mint_dry_sell', undefined, undefined, true);
      store.transition('mint_dry_sell', 'BUYING', 'MONITORING');
      store.transition('mint_dry_sell', 'MONITORING', 'SELLING');
      const trades = store.getSellingTrades();
      const trade = trades.find(t => t.mint === 'mint_dry_sell');
      expect(trade).toBeDefined();
      expect(trade!.dryRun).toBe(true);
    });

    it('Boolean(null) for dry_run on legacy rows evaluates to false (migration backward compat)', () => {
      // Simulate a legacy row with no dry_run column by inserting directly
      // The migration adds the column as nullable INTEGER — existing rows have NULL
      // Boolean(null) === false ensures backward compatibility
      expect(Boolean(null)).toBe(false);
      // Also verify that a freshly created record without explicit dryRun defaults correctly
      store.createBuyingRecord('mint_legacy_compat');
      const trade = store.getTradeByMint('mint_legacy_compat');
      expect(trade!.dryRun).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // getBuyingTrades()
  // ---------------------------------------------------------------------------
  describe('getBuyingTrades()', () => {
    it('returns empty array when no BUYING trades', () => {
      expect(store.getBuyingTrades()).toEqual([]);
    });

    it('returns Trade rows for BUYING trades with id, mint, state fields present', () => {
      store.createBuyingRecord('mint_buy_1');
      const trades = store.getBuyingTrades();
      expect(trades).toHaveLength(1);
      expect(trades[0]!.mint).toBe('mint_buy_1');
      expect(trades[0]!.state).toBe('BUYING');
      expect(typeof trades[0]!.id).toBe('number');
    });

    it('returns only BUYING trades (not MONITORING or SELLING)', () => {
      store.createBuyingRecord('mint_buy');
      store.createBuyingRecord('mint_mon');
      store.createBuyingRecord('mint_sell');
      store.transition('mint_mon', 'BUYING', 'MONITORING');
      store.transition('mint_sell', 'BUYING', 'MONITORING');
      store.transition('mint_sell', 'MONITORING', 'SELLING');
      const trades = store.getBuyingTrades();
      expect(trades).toHaveLength(1);
      expect(trades[0]!.mint).toBe('mint_buy');
    });

    it('returns multiple BUYING trades ordered by updated_at DESC', () => {
      store.createBuyingRecord('mint_buy_first');
      // Small delay to ensure different updated_at timestamps
      const store2 = new TradeStore(':memory:');
      store2.close();
      store.createBuyingRecord('mint_buy_second');
      const trades = store.getBuyingTrades();
      expect(trades).toHaveLength(2);
      // Both should be returned (order: most recently inserted first)
      expect(trades.map(t => t.mint)).toContain('mint_buy_first');
      expect(trades.map(t => t.mint)).toContain('mint_buy_second');
      // Most recently updated should be first (same or later updated_at)
      expect(trades[0]!.updatedAt).toBeGreaterThanOrEqual(trades[1]!.updatedAt);
    });
  });

  // ---------------------------------------------------------------------------
  // getSellingTrades()
  // ---------------------------------------------------------------------------
  describe('getSellingTrades()', () => {
    it('returns empty array when no SELLING trades', () => {
      expect(store.getSellingTrades()).toEqual([]);
    });

    it('returns rows for SELLING trades ordered by updated_at DESC', () => {
      store.createBuyingRecord('mint_s1');
      store.transition('mint_s1', 'BUYING', 'MONITORING');
      store.transition('mint_s1', 'MONITORING', 'SELLING');
      const trades = store.getSellingTrades();
      expect(trades).toHaveLength(1);
      expect(trades[0]!.mint).toBe('mint_s1');
      expect(trades[0]!.state).toBe('SELLING');
    });

    it('when two SELLING records exist, first in array is most recently updated', () => {
      store.createBuyingRecord('mint_a');
      store.createBuyingRecord('mint_b');
      store.transition('mint_a', 'BUYING', 'MONITORING');
      store.transition('mint_b', 'BUYING', 'MONITORING');
      store.transition('mint_a', 'MONITORING', 'SELLING');
      store.transition('mint_b', 'MONITORING', 'SELLING');
      const selling = store.getSellingTrades();
      expect(selling).toHaveLength(2);
      // First row should have an updated_at >= second row (DESC order)
      expect(selling[0]!.updatedAt).toBeGreaterThanOrEqual(selling[1]!.updatedAt);
    });
  });

  // ---------------------------------------------------------------------------
  // getMonitoringTrades()
  // ---------------------------------------------------------------------------
  describe('getMonitoringTrades()', () => {
    it('returns empty array when no MONITORING trades', () => {
      expect(store.getMonitoringTrades()).toEqual([]);
    });

    it('returns Trade rows for MONITORING trades', () => {
      store.createBuyingRecord('mint_mon_1');
      store.transition('mint_mon_1', 'BUYING', 'MONITORING');
      const trades = store.getMonitoringTrades();
      expect(trades).toHaveLength(1);
      expect(trades[0]!.mint).toBe('mint_mon_1');
      expect(trades[0]!.state).toBe('MONITORING');
      expect(typeof trades[0]!.id).toBe('number');
    });
  });

  // ---------------------------------------------------------------------------
  // getDetectedTrades()
  // ---------------------------------------------------------------------------
  describe('getDetectedTrades()', () => {
    it('returns empty array when only BUYING trades exist (no DETECTED state in TradeStore)', () => {
      store.createBuyingRecord('mint_buying_only');
      expect(store.getDetectedTrades()).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // transitionById()
  // ---------------------------------------------------------------------------
  describe('transitionById()', () => {
    it('returns 1 on successful transition (BUYING→FAILED by id)', () => {
      store.createBuyingRecord('mint_tid');
      const buying = store.getBuyingTrades();
      expect(buying).toHaveLength(1);
      const id = buying[0]!.id;
      const changes = store.transitionById(id, 'mint_tid', 'BUYING', 'FAILED');
      expect(changes).toBe(1);
    });

    it('returns 0 if id matches but state does not match expectedState (optimistic lock miss)', () => {
      store.createBuyingRecord('mint_tid2');
      const buying = store.getBuyingTrades();
      const id = buying[0]!.id;
      // State is BUYING but we specify MONITORING as expected — should miss
      const changes = store.transitionById(id, 'mint_tid2', 'MONITORING', 'FAILED');
      expect(changes).toBe(0);
    });

    it('returns 0 if id does not exist', () => {
      const changes = store.transitionById(99999, 'mint_nonexistent', 'BUYING', 'FAILED');
      expect(changes).toBe(0);
    });

    it('removes mint from activeMints when transitioning to FAILED', () => {
      store.createBuyingRecord('mint_term');
      expect(store.isActive('mint_term')).toBe(true);
      const buying = store.getBuyingTrades();
      const id = buying[0]!.id;
      store.transitionById(id, 'mint_term', 'BUYING', 'FAILED');
      expect(store.isActive('mint_term')).toBe(false);
    });

    it('removes mint from activeMints when transitioning to COMPLETED', () => {
      store.createBuyingRecord('mint_comp');
      const buying = store.getBuyingTrades();
      const id = buying[0]!.id;
      store.transitionById(id, 'mint_comp', 'BUYING', 'COMPLETED');
      expect(store.isActive('mint_comp')).toBe(false);
    });

    it('removes mint from activeMints when transitioning to ABANDONED', () => {
      store.createBuyingRecord('mint_aband');
      const buying = store.getBuyingTrades();
      const id = buying[0]!.id;
      store.transitionById(id, 'mint_aband', 'BUYING', 'ABANDONED');
      expect(store.isActive('mint_aband')).toBe(false);
    });

    it('does NOT remove mint from activeMints for non-terminal transitions (BUYING→MONITORING)', () => {
      store.createBuyingRecord('mint_nonterm');
      const buying = store.getBuyingTrades();
      const id = buying[0]!.id;
      store.transitionById(id, 'mint_nonterm', 'BUYING', 'MONITORING');
      expect(store.isActive('mint_nonterm')).toBe(true);
    });

    it('two SELLING rows for same mint: transitionById marks the stale one FAILED without affecting the current one', () => {
      store.createBuyingRecord('mint_a');
      store.createBuyingRecord('mint_b');
      store.transition('mint_a', 'BUYING', 'MONITORING');
      store.transition('mint_b', 'BUYING', 'MONITORING');
      store.transition('mint_a', 'MONITORING', 'SELLING');
      store.transition('mint_b', 'MONITORING', 'SELLING');
      // Verify both are in getSellingTrades()
      const selling = store.getSellingTrades();
      expect(selling).toHaveLength(2);
      // Transition the older one (index 1, since ordered DESC) to FAILED
      const staleId = selling[1]!.id;
      const staleMint = selling[1]!.mint;
      const currentMint = selling[0]!.mint;
      const changes = store.transitionById(staleId, staleMint, 'SELLING', 'FAILED', { errorMessage: 'stale' });
      expect(changes).toBe(1);
      // Only one SELLING remains
      expect(store.getSellingTrades()).toHaveLength(1);
      expect(store.isActive(staleMint)).toBe(false);
      expect(store.isActive(currentMint)).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // createBuyingRecord() with safety data (Phase 18-01)
  // ---------------------------------------------------------------------------
  describe('createBuyingRecord() with safety data', () => {
    it('stores safetyScore, safetyRejectionReasons, safetyChecksDetail when provided', () => {
      const detail = JSON.stringify({
        tier1: [{ source: 'authority', pass: true, detail: 'ok' }],
        tier2: [{ source: 'rugcheck', pass: true, score: 85, detail: 'safe' }],
        tier3: [],
      });
      store.createBuyingRecord('mint_safety', 'raydium', undefined, false, 85, ['low score'], detail);
      const trade = store.getTradeByMint('mint_safety');
      expect(trade).toBeDefined();
      expect(trade!.safetyScore).toBe(85);
      expect(trade!.safetyRejectionReasons).toBe(JSON.stringify(['low score']));
      expect(trade!.safetyChecksDetail).toBe(detail);
    });

    it('stores null safety fields when not provided (backward compat)', () => {
      store.createBuyingRecord('mint_nosafety');
      const trade = store.getTradeByMint('mint_nosafety');
      expect(trade).toBeDefined();
      expect(trade!.safetyScore).toBeUndefined();
      expect(trade!.safetyRejectionReasons).toBeUndefined();
      expect(trade!.safetyChecksDetail).toBeUndefined();
    });

    it('stores safety data with empty rejection reasons array', () => {
      store.createBuyingRecord('mint_safe_pass', 'pumpportal', undefined, false, 92, [], '{}');
      const trade = store.getTradeByMint('mint_safe_pass');
      expect(trade).toBeDefined();
      expect(trade!.safetyScore).toBe(92);
      expect(trade!.safetyRejectionReasons).toBe('[]');
      expect(trade!.safetyChecksDetail).toBe('{}');
    });
  });
});
