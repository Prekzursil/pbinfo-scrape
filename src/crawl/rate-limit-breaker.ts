export interface RateLimitBreakerOptions {
  /** Number of failures within the rolling window before the breaker trips open. */
  failureThreshold: number;
  /** Rolling window size in milliseconds used to count recent failures. */
  failureWindowMs: number;
  /** How long the breaker stays open (rejecting traffic) before auto-closing. */
  cooldownMs: number;
  /** Injectable clock (defaults to Date.now). */
  now?: () => number;
}

export type BreakerState = 'closed' | 'open';

export interface BreakerDecision {
  allowed: boolean;
  state: BreakerState;
  retryAtMs?: number;
  reason?: string;
}

/**
 * Trips open after `failureThreshold` responses with `httpStatus >= 500` or
 * `httpStatus === 429` within a rolling `failureWindowMs` window. Stays open
 * for `cooldownMs`, then auto-closes. A successful response (2xx/3xx) clears
 * the rolling counter.
 */
export class RateLimitBreaker {
  private readonly failureThreshold: number;
  private readonly failureWindowMs: number;
  private readonly cooldownMs: number;
  private readonly now: () => number;
  private failureTimestamps: number[] = [];
  private openUntil: number | null = null;

  constructor(options: RateLimitBreakerOptions) {
    if (options.failureThreshold <= 0) {
      throw new Error('failureThreshold must be > 0');
    }
    if (options.failureWindowMs <= 0) {
      throw new Error('failureWindowMs must be > 0');
    }
    if (options.cooldownMs <= 0) {
      throw new Error('cooldownMs must be > 0');
    }
    this.failureThreshold = options.failureThreshold;
    this.failureWindowMs = options.failureWindowMs;
    this.cooldownMs = options.cooldownMs;
    this.now = options.now ?? (() => Date.now());
  }

  recordOutcome(httpStatus: number): BreakerDecision {
    const nowMs = this.now();
    if (isFailureStatus(httpStatus)) {
      this.failureTimestamps = [
        ...this.failureTimestamps.filter(
          (timestamp) => nowMs - timestamp <= this.failureWindowMs,
        ),
        nowMs,
      ];
      if (this.failureTimestamps.length >= this.failureThreshold) {
        this.openUntil = nowMs + this.cooldownMs;
        this.failureTimestamps = [];
        return {
          allowed: false,
          state: 'open',
          retryAtMs: this.openUntil,
          reason: `circuit breaker opened after ${this.failureThreshold} failures within ${this.failureWindowMs}ms`,
        };
      }
      return { allowed: true, state: 'closed' };
    }

    if (isSuccessStatus(httpStatus)) {
      this.failureTimestamps = [];
      this.openUntil = null;
      return { allowed: true, state: 'closed' };
    }

    return { allowed: true, state: this.currentState(nowMs) };
  }

  canProceed(): BreakerDecision {
    const nowMs = this.now();
    const state = this.currentState(nowMs);
    if (state === 'open') {
      return {
        allowed: false,
        state: 'open',
        retryAtMs: this.openUntil ?? undefined,
        reason: 'circuit breaker is open',
      };
    }
    return { allowed: true, state: 'closed' };
  }

  state(): BreakerState {
    return this.currentState(this.now());
  }

  private currentState(nowMs: number): BreakerState {
    if (this.openUntil === null) {
      return 'closed';
    }
    if (nowMs >= this.openUntil) {
      this.openUntil = null;
      this.failureTimestamps = [];
      return 'closed';
    }
    return 'open';
  }
}

function isFailureStatus(httpStatus: number): boolean {
  return httpStatus === 429 || (httpStatus >= 500 && httpStatus < 600);
}

function isSuccessStatus(httpStatus: number): boolean {
  return httpStatus >= 200 && httpStatus < 400;
}
