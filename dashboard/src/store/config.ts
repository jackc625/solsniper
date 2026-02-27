import { signal } from '@preact/signals';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const configSignal = signal<Record<string, any>>({});

export async function fetchConfig(): Promise<void> {
  try {
    const res = await fetch('/api/config');
    if (res.ok) {
      configSignal.value = (await res.json()) as Record<string, any>;
    }
  } catch { /* network error — keep stale value */ }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function saveConfig(updates: Record<string, any>): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    const data = await res.json() as { ok?: boolean; config?: Record<string, any>; error?: string };
    if (res.ok && data.config) {
      configSignal.value = data.config;
      return { ok: true };
    }
    return { ok: false, error: data.error ?? 'Save failed' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}
