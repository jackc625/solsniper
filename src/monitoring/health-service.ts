/**
 * HealthService -- Component health aggregation with alert transition detection (REL-01).
 *
 * Components register health provider callbacks via register().
 * check() invokes all providers, computes worst-of aggregate status,
 * detects status transitions, and emits SYSTEM_ALERT via BotEventBus
 * with cooldown debouncing per D-11.
 *
 * Alerts are also persisted to AlertStore for durable history per D-13.
 */
import { createRequire } from 'node:module';
import { createModuleLogger } from '../core/logger.js';
import type { AlertStore } from './alert-store.js';
import type { EventEmitter } from 'eventemitter3';
import type { BotEvent } from '../dashboard/bot-event-bus.js';

const require = createRequire(import.meta.url);

const log = createModuleLogger('health-service');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ComponentStatus = 'healthy' | 'degraded' | 'down';

export interface ComponentHealth {
  status: ComponentStatus;
  detail?: string;
}

export type HealthProvider = () => ComponentHealth;

export interface HealthCheckResult {
  status: ComponentStatus;
  components: Record<string, ComponentHealth>;
  uptime: number;
  version: string;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Alert source mapping -- maps component name to alertSource value
// ---------------------------------------------------------------------------
const ALERT_SOURCE_MAP: Record<string, string> = {
  detection: 'detection',
  rpc: 'rpc',
  safety: 'api',
  execution: 'api',
  apis: 'api',
};

// Severity ordering for worst-of computation
const SEVERITY_ORDER: Record<ComponentStatus, number> = {
  healthy: 0,
  degraded: 1,
  down: 2,
};

// ---------------------------------------------------------------------------
// HealthService
// ---------------------------------------------------------------------------

export class HealthService {
  private readonly providers = new Map<string, HealthProvider>();
  private readonly previousStatus = new Map<string, ComponentStatus>();
  private readonly cooldowns = new Map<string, number>();
  private readonly alertCooldownMs: number;
  private readonly version: string;
  private readonly bus: EventEmitter<{ event: (e: BotEvent) => void }>;
  private readonly alertStore: AlertStore;

  constructor(
    botEventBus: EventEmitter<{ event: (e: BotEvent) => void }>,
    alertStore: AlertStore,
    config: { alertCooldownMs: number },
  ) {
    this.bus = botEventBus;
    this.alertStore = alertStore;
    this.alertCooldownMs = config.alertCooldownMs;

    // Read version from package.json synchronously (same createRequire pattern as other modules)
    try {
      const pkg = require('./../../package.json') as { version: string };
      this.version = pkg.version;
    } catch {
      this.version = 'unknown';
    }

    log.debug({ alertCooldownMs: this.alertCooldownMs }, 'HealthService initialized');
  }

  /**
   * Registers a health provider callback for a named component.
   */
  register(name: string, provider: HealthProvider): void {
    this.providers.set(name, provider);
    log.debug({ component: name }, 'registered health provider');
  }

  /**
   * Invokes all registered health providers, computes aggregate worst-of status,
   * detects status transitions and emits alerts, returns full health check result.
   */
  check(): HealthCheckResult {
    const components: Record<string, ComponentHealth> = {};
    let worstStatus: ComponentStatus = 'healthy';

    for (const [name, provider] of this.providers) {
      try {
        const health = provider();
        components[name] = health;

        if (SEVERITY_ORDER[health.status] > SEVERITY_ORDER[worstStatus]) {
          worstStatus = health.status;
        }
      } catch (err) {
        // Provider threw -- treat as down
        components[name] = { status: 'down', detail: `provider error: ${err}` };
        worstStatus = 'down';
        log.error({ component: name, err }, 'health provider threw');
      }
    }

    this.detectTransitions(components);

    return {
      status: worstStatus,
      components,
      uptime: process.uptime(),
      version: this.version,
      timestamp: Date.now(),
    };
  }

  // ---------------------------------------------------------------------------
  // Transition detection
  // ---------------------------------------------------------------------------

  private detectTransitions(components: Record<string, ComponentHealth>): void {
    for (const [name, health] of Object.entries(components)) {
      const prev = this.previousStatus.get(name);
      const curr = health.status;

      // Update tracked status
      this.previousStatus.set(name, curr);

      // No previous status means first check -- no transition
      if (prev === undefined) {
        continue;
      }

      // No change -- no alert
      if (prev === curr) {
        continue;
      }

      const source = ALERT_SOURCE_MAP[name] ?? name;

      // Determine if this is a degradation or recovery
      const prevOrder = SEVERITY_ORDER[prev];
      const currOrder = SEVERITY_ORDER[curr];

      if (currOrder > prevOrder) {
        // Worsened: emit alert with severity based on new status
        const severity = curr === 'down' ? 'error' : 'warn';
        const message = `${name}: ${prev} -> ${curr}${health.detail ? ` (${health.detail})` : ''}`;
        this.emitAlert(`component_${curr}`, severity, source, message);
      } else {
        // Improved: recovery event
        this.resetCooldown(source);
        const message = `${name}: recovered ${prev} -> ${curr}${health.detail ? ` (${health.detail})` : ''}`;
        this.emitAlert('component_recovery', 'info', source, message);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Alert emission with cooldown
  // ---------------------------------------------------------------------------

  private emitAlert(
    type: string,
    severity: 'info' | 'warn' | 'error',
    source: string,
    message: string,
  ): void {
    const compositeKey = `${type}:${source}`;
    const now = Date.now();
    const lastEmit = this.cooldowns.get(compositeKey);

    if (lastEmit !== undefined && now - lastEmit < this.alertCooldownMs) {
      log.debug({ compositeKey, elapsed: now - lastEmit }, 'alert suppressed by cooldown');
      return;
    }

    // Emit SYSTEM_ALERT via BotEventBus
    this.bus.emit('event', {
      type: 'SYSTEM_ALERT',
      mint: '',
      ts: now,
      detail: message,
      severity,
      alertSource: source as 'detection' | 'rpc' | 'api' | 'rateLimit',
    });

    // Persist to AlertStore
    this.alertStore.insert({
      timestamp: now,
      type,
      severity,
      source,
      message,
    });

    // Update cooldown
    this.cooldowns.set(compositeKey, now);

    log.debug({ type, severity, source }, 'alert emitted');
  }

  // ---------------------------------------------------------------------------
  // Cooldown reset
  // ---------------------------------------------------------------------------

  private resetCooldown(source: string): void {
    const suffix = `:${source}`;
    for (const key of this.cooldowns.keys()) {
      if (key.endsWith(suffix)) {
        this.cooldowns.delete(key);
      }
    }
  }
}
