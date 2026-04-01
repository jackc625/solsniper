import { signal } from '@preact/signals';

/** Whether detection is currently paused (read from /api/controls/status) */
export const pausedSignal = signal<boolean>(false);

/** Whether the emergency stop confirmation dialog is open */
export const estopDialogOpen = signal<boolean>(false);

/** Poll detection paused state from backend */
export async function fetchPausedState(): Promise<void> {
  try {
    const res = await fetch('/api/controls/status');
    if (res.ok) {
      const data = await res.json() as { paused: boolean };
      pausedSignal.value = data.paused;
    }
  } catch { /* ignore network errors */ }
}

/** Set detection paused state via backend API */
export async function setDetectionPaused(paused: boolean): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch('/api/controls/detection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paused }),
    });
    if (res.ok) {
      pausedSignal.value = paused;
      return { ok: true };
    }
    const data = await res.json() as { error?: string };
    return { ok: false, error: data.error ?? 'Failed' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

/** Trigger force-sell for a specific trade */
export async function forceSell(tradeId: number): Promise<{ ok: boolean; error?: string; status?: number }> {
  try {
    const res = await fetch(`/api/trades/${tradeId}/force-sell`, { method: 'POST' });
    if (res.ok) return { ok: true };
    const data = await res.json() as { error?: string };
    return { ok: false, error: data.error ?? 'Failed', status: res.status };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

/** Trigger emergency stop */
export async function triggerEmergencyStop(): Promise<{ ok: boolean; error?: string; sellResults?: Array<{ tradeId: number; mint: string; status: string }> }> {
  try {
    const res = await fetch('/api/controls/emergency-stop', { method: 'POST' });
    if (res.ok) {
      const data = await res.json() as { paused: boolean; sellResults: Array<{ tradeId: number; mint: string; status: string }> };
      pausedSignal.value = data.paused;
      estopDialogOpen.value = false;
      return { ok: true, sellResults: data.sellResults };
    }
    const data = await res.json() as { error?: string };
    return { ok: false, error: data.error ?? 'Emergency stop failed -- manually check bot status' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}
