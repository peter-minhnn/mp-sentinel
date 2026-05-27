/**
 * Per-provider circuit breaker.
 *
 * Tracks consecutive failures for each provider key (`provider:model`).
 * After `failureThreshold` consecutive failures the breaker trips to
 * `open` — subsequent `allow()` calls return false until `cooldownMs`
 * has elapsed. The next attempt after cooldown is `half-open`: a single
 * trial call. If it succeeds the breaker closes; if it fails the breaker
 * trips back to open with a fresh cooldown.
 *
 * Goal: stop wasting tokens (and time) on a provider that is currently
 * down. Retries inside a single audit still happen via `withRetry`; the
 * circuit breaker prevents the *next* audit (and the next, and the next)
 * from incurring the same latency penalty.
 *
 * The breaker is intentionally tiny — no rolling-window stats, no
 * percentage thresholds. The "5 consecutive failures" rule matches what
 * the plan promised in IMPROVEMENT_PLAN.md §1.2 and keeps the code small
 * enough to fit comfortably under the 500-line file ceiling.
 */

export type CircuitState = "closed" | "open" | "half-open";

export interface CircuitBreakerOptions {
  /** Consecutive failures before opening (default 5) */
  failureThreshold?: number;
  /** Milliseconds the breaker stays open before allowing a trial (default 30000) */
  cooldownMs?: number;
  /** Source of the current time — injectable for tests */
  now?: () => number;
}

interface CircuitEntry {
  state: CircuitState;
  consecutiveFailures: number;
  /** Timestamp (ms) when the breaker opened. 0 when closed. */
  openedAt: number;
}

export class CircuitBreaker {
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;
  private readonly clock: () => number;
  private readonly entries: Map<string, CircuitEntry> = new Map();

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 5;
    this.cooldownMs = options.cooldownMs ?? 30_000;
    this.clock = options.now ?? Date.now;
  }

  private getOrCreate(key: string): CircuitEntry {
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { state: "closed", consecutiveFailures: 0, openedAt: 0 };
      this.entries.set(key, entry);
    }
    return entry;
  }

  /**
   * Returns true if the call for `key` should proceed.
   * Side effect: transitions open → half-open after cooldown.
   */
  allow(key: string): boolean {
    const entry = this.getOrCreate(key);
    if (entry.state === "closed" || entry.state === "half-open") return true;

    const elapsed = this.clock() - entry.openedAt;
    if (elapsed >= this.cooldownMs) {
      entry.state = "half-open";
      return true;
    }
    return false;
  }

  /**
   * Inspect breaker state for a key without mutating it.
   */
  inspect(key: string): CircuitState {
    const entry = this.entries.get(key);
    return entry ? entry.state : "closed";
  }

  /**
   * Record a successful call. Closes the breaker and resets the counter.
   */
  onSuccess(key: string): void {
    const entry = this.getOrCreate(key);
    entry.state = "closed";
    entry.consecutiveFailures = 0;
    entry.openedAt = 0;
  }

  /**
   * Record a failed call. If half-open, immediately re-open with a fresh
   * cooldown. If closed and consecutive failures reach the threshold, open.
   */
  onFailure(key: string): void {
    const entry = this.getOrCreate(key);
    if (entry.state === "half-open") {
      entry.state = "open";
      entry.openedAt = this.clock();
      // Keep consecutiveFailures incremented so callers can read it
      entry.consecutiveFailures += 1;
      return;
    }

    entry.consecutiveFailures += 1;
    if (entry.consecutiveFailures >= this.failureThreshold) {
      entry.state = "open";
      entry.openedAt = this.clock();
    }
  }

  /**
   * Reset all breaker state. Intended for tests.
   */
  reset(): void {
    this.entries.clear();
  }
}

/**
 * Process-wide default breaker. Production code uses this; tests instantiate
 * their own with a fake clock.
 */
let defaultInstance: CircuitBreaker | null = null;

export const getDefaultCircuitBreaker = (): CircuitBreaker => {
  if (!defaultInstance) defaultInstance = new CircuitBreaker();
  return defaultInstance;
};

export const resetDefaultCircuitBreaker = (): void => {
  defaultInstance = null;
};
