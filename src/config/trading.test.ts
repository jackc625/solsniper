/**
 * Unit tests for patchRuntimeConfig deep merge behavior (BUG 3 fix).
 *
 * Verifies that patching nested config keys preserves sibling keys,
 * 2-level nested merging works, arrays are replaced atomically,
 * and primitive top-level keys overwrite directly.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { patchRuntimeConfig, getRuntimeConfig } from './trading.js';

describe('patchRuntimeConfig deep merge', () => {
  // Capture the initial config for restoration
  let initialConfig: ReturnType<typeof getRuntimeConfig>;

  beforeEach(() => {
    // Store initial state and restore after each test to avoid test pollution
    initialConfig = { ...getRuntimeConfig() };
  });

  it('patching a nested key preserves sibling keys (positionManagement.stopLossPct keeps pollIntervalMs)', () => {
    const before = getRuntimeConfig();
    const originalPollIntervalMs = before.positionManagement.pollIntervalMs;

    patchRuntimeConfig({
      positionManagement: { stopLossPct: -30 } as any,
    });

    const after = getRuntimeConfig();
    // Patched key should be updated
    expect(after.positionManagement.stopLossPct).toBe(-30);
    // Sibling key should be preserved
    expect(after.positionManagement.pollIntervalMs).toBe(originalPollIntervalMs);

    // Restore
    patchRuntimeConfig(initialConfig);
  });

  it('patching a 2-level nested key preserves siblings (safety.weights.rugCheck keeps weights.holder)', () => {
    const before = getRuntimeConfig();
    const originalHolder = before.safety.weights.holder;

    patchRuntimeConfig({
      safety: { weights: { rugCheck: 50 } } as any,
    });

    const after = getRuntimeConfig();
    // Patched 2-level key should be updated
    expect(after.safety.weights.rugCheck).toBe(50);
    // Sibling at level 2 should be preserved
    expect(after.safety.weights.holder).toBe(originalHolder);
    // Sibling at level 1 should be preserved
    expect(after.safety.tier2TimeoutMs).toBe(before.safety.tier2TimeoutMs);

    // Restore
    patchRuntimeConfig(initialConfig);
  });

  it('array replacement works (positionManagement.tieredTp replaces entire array)', () => {
    const newTiers = [{ at: 3, pct: 50 }, { at: 8, pct: 50 }];

    patchRuntimeConfig({
      positionManagement: { tieredTp: newTiers } as any,
    });

    const after = getRuntimeConfig();
    // Array should be replaced entirely, not merged element-by-element
    expect(after.positionManagement.tieredTp).toEqual(newTiers);
    expect(after.positionManagement.tieredTp).toHaveLength(2);

    // Restore
    patchRuntimeConfig(initialConfig);
  });

  it('primitive top-level keys overwrite directly', () => {
    const before = getRuntimeConfig();

    patchRuntimeConfig({ buyAmountSol: 0.5 });

    const after = getRuntimeConfig();
    expect(after.buyAmountSol).toBe(0.5);
    // Other top-level keys preserved
    expect(after.maxSlippageBps).toBe(before.maxSlippageBps);

    // Restore
    patchRuntimeConfig(initialConfig);
  });

  it('execution.sell nested merge preserves execution.buy', () => {
    const before = getRuntimeConfig();
    const originalBuySlippageBps = before.execution.buy.slippageBps;

    patchRuntimeConfig({
      execution: { sell: { standardSlippageBps: 1000 } } as any,
    });

    const after = getRuntimeConfig();
    // sell sub-key should be updated
    expect(after.execution.sell.standardSlippageBps).toBe(1000);
    // buy sub-key should be preserved (level 1 sibling)
    expect(after.execution.buy.slippageBps).toBe(originalBuySlippageBps);
    // Other sell siblings should be preserved (level 2 merge)
    expect(after.execution.sell.emergencySlippageBps).toBe(before.execution.sell.emergencySlippageBps);

    // Restore
    patchRuntimeConfig(initialConfig);
  });
});
