/**
 * Unit tests for AlertStore -- Phase 20 alert persistence (REL-02).
 *
 * Uses in-memory better-sqlite3 to avoid file system side effects.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import { SCHEMA_SQL } from '../persistence/schema.js';
import { ALERTS_SCHEMA_SQL } from '../persistence/schema.js';
import { AlertStore } from './alert-store.js';
import type BetterSqlite3 from 'better-sqlite3';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3') as typeof BetterSqlite3;

describe('AlertStore', () => {
  let db: BetterSqlite3.Database;
  let store: AlertStore;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(SCHEMA_SQL);
    db.exec(ALERTS_SCHEMA_SQL);
    store = new AlertStore(db);
  });

  it('inserts an alert and retrieves it via query', () => {
    const alert = {
      timestamp: Date.now(),
      type: 'SYSTEM_ALERT',
      severity: 'warn',
      source: 'rpc',
      message: 'RPC endpoint degraded',
    };

    store.insert(alert);

    const result = store.query({ page: 1, limit: 10 });
    expect(result.total).toBe(1);
    expect(result.page).toBe(1);
    expect(result.limit).toBe(10);
    expect(result.alerts).toHaveLength(1);
    expect(result.alerts[0].type).toBe('SYSTEM_ALERT');
    expect(result.alerts[0].severity).toBe('warn');
    expect(result.alerts[0].source).toBe('rpc');
    expect(result.alerts[0].message).toBe('RPC endpoint degraded');
    expect(result.alerts[0].id).toBeGreaterThan(0);
  });

  it('paginates correctly: page 1 limit 2 of 5 alerts returns 2 alerts and total=5', () => {
    for (let i = 0; i < 5; i++) {
      store.insert({
        timestamp: 1000 + i,
        type: 'SYSTEM_ALERT',
        severity: 'info',
        source: 'api',
        message: `Alert ${i}`,
      });
    }

    const result = store.query({ page: 1, limit: 2 });
    expect(result.alerts).toHaveLength(2);
    expect(result.total).toBe(5);
    expect(result.page).toBe(1);
    expect(result.limit).toBe(2);
  });

  it('returns alerts ordered by timestamp DESC (most recent first)', () => {
    store.insert({ timestamp: 1000, type: 'SYSTEM_ALERT', severity: 'info', source: 'rpc', message: 'Old' });
    store.insert({ timestamp: 3000, type: 'SYSTEM_ALERT', severity: 'error', source: 'api', message: 'New' });
    store.insert({ timestamp: 2000, type: 'SYSTEM_ALERT', severity: 'warn', source: 'detection', message: 'Mid' });

    const result = store.query({ page: 1, limit: 10 });
    expect(result.alerts[0].timestamp).toBe(3000);
    expect(result.alerts[1].timestamp).toBe(2000);
    expect(result.alerts[2].timestamp).toBe(1000);
  });

  it('count() returns correct total', () => {
    expect(store.count()).toBe(0);

    store.insert({ timestamp: 1000, type: 'SYSTEM_ALERT', severity: 'info', source: 'rpc', message: 'Test' });
    store.insert({ timestamp: 2000, type: 'SYSTEM_ALERT', severity: 'warn', source: 'api', message: 'Test 2' });

    expect(store.count()).toBe(2);
  });

  it('page 2 returns the correct offset of alerts', () => {
    for (let i = 0; i < 5; i++) {
      store.insert({
        timestamp: 1000 + i,
        type: 'SYSTEM_ALERT',
        severity: 'info',
        source: 'api',
        message: `Alert ${i}`,
      });
    }

    const page2 = store.query({ page: 2, limit: 2 });
    expect(page2.alerts).toHaveLength(2);
    expect(page2.total).toBe(5);
    // timestamp DESC: 1004, 1003, 1002, 1001, 1000
    // page 2 limit 2 should be: 1002, 1001
    expect(page2.alerts[0].timestamp).toBe(1002);
    expect(page2.alerts[1].timestamp).toBe(1001);
  });
});
