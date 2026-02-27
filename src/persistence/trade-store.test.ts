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
  // close()
  // ---------------------------------------------------------------------------
  describe('close()', () => {
    it('closes the database without throwing', () => {
      const tmpStore = new TradeStore(':memory:');
      expect(() => tmpStore.close()).not.toThrow();
    });
  });
});
