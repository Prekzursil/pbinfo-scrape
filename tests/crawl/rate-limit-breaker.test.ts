import { describe, expect, test } from 'vitest';

import { RateLimitBreaker } from '../../src/crawl/rate-limit-breaker.js';

function makeClock(initial = 0): { now: () => number; advance: (ms: number) => void } {
  let t = initial;
  return {
    now: () => t,
    advance: (ms) => {
      t += ms;
    },
  };
}

describe('RateLimitBreaker', () => {
  test('starts closed and allows traffic', () => {
    const breaker = new RateLimitBreaker({
      failureThreshold: 3,
      failureWindowMs: 60_000,
      cooldownMs: 300_000,
    });

    expect(breaker.state()).toBe('closed');
    expect(breaker.canProceed().allowed).toBe(true);
  });

  test('opens after failureThreshold 429/5xx within window', () => {
    const clock = makeClock();
    const breaker = new RateLimitBreaker({
      failureThreshold: 3,
      failureWindowMs: 60_000,
      cooldownMs: 300_000,
      now: clock.now,
    });

    breaker.recordOutcome(429);
    clock.advance(10_000);
    breaker.recordOutcome(503);
    clock.advance(10_000);
    const decision = breaker.recordOutcome(429);

    expect(decision.allowed).toBe(false);
    expect(decision.state).toBe('open');
    expect(decision.retryAtMs).toBeDefined();
    expect(breaker.canProceed().allowed).toBe(false);
  });

  test('failures outside the window do not count toward the threshold', () => {
    const clock = makeClock();
    const breaker = new RateLimitBreaker({
      failureThreshold: 3,
      failureWindowMs: 60_000,
      cooldownMs: 300_000,
      now: clock.now,
    });

    breaker.recordOutcome(500);
    clock.advance(70_000);
    breaker.recordOutcome(500);
    clock.advance(10_000);
    const decision = breaker.recordOutcome(500);

    // Only the second and third failures are inside the window (70s apart is
    // outside 60s); so we should still be closed after three failures total.
    expect(decision.allowed).toBe(true);
    expect(decision.state).toBe('closed');
  });

  test('success clears the failure counter', () => {
    const clock = makeClock();
    const breaker = new RateLimitBreaker({
      failureThreshold: 3,
      failureWindowMs: 60_000,
      cooldownMs: 300_000,
      now: clock.now,
    });

    breaker.recordOutcome(429);
    breaker.recordOutcome(500);
    breaker.recordOutcome(200);
    const decision = breaker.recordOutcome(500);

    expect(decision.state).toBe('closed');
  });

  test('auto-closes after cooldown passes', () => {
    const clock = makeClock();
    const breaker = new RateLimitBreaker({
      failureThreshold: 2,
      failureWindowMs: 60_000,
      cooldownMs: 300_000,
      now: clock.now,
    });

    breaker.recordOutcome(500);
    breaker.recordOutcome(500);
    expect(breaker.state()).toBe('open');

    clock.advance(299_999);
    expect(breaker.state()).toBe('open');

    clock.advance(1);
    expect(breaker.state()).toBe('closed');
    expect(breaker.canProceed().allowed).toBe(true);
  });

  test('non-429/non-5xx non-success statuses (e.g., 302) do not change state', () => {
    const breaker = new RateLimitBreaker({
      failureThreshold: 2,
      failureWindowMs: 60_000,
      cooldownMs: 300_000,
    });

    breaker.recordOutcome(302);
    breaker.recordOutcome(404);
    expect(breaker.state()).toBe('closed');
  });

  test('constructor rejects nonpositive configuration', () => {
    expect(
      () =>
        new RateLimitBreaker({
          failureThreshold: 0,
          failureWindowMs: 1,
          cooldownMs: 1,
        }),
    ).toThrow();
    expect(
      () =>
        new RateLimitBreaker({
          failureThreshold: 1,
          failureWindowMs: 0,
          cooldownMs: 1,
        }),
    ).toThrow();
    expect(
      () =>
        new RateLimitBreaker({
          failureThreshold: 1,
          failureWindowMs: 1,
          cooldownMs: 0,
        }),
    ).toThrow();
  });

  test('retryAtMs is approximately now + cooldownMs when tripping', () => {
    const clock = makeClock(1_000_000);
    const breaker = new RateLimitBreaker({
      failureThreshold: 2,
      failureWindowMs: 60_000,
      cooldownMs: 300_000,
      now: clock.now,
    });

    breaker.recordOutcome(500);
    const decision = breaker.recordOutcome(500);

    expect(decision.retryAtMs).toBe(1_000_000 + 300_000);
  });

  test('reopens if a failure happens immediately after cooldown closes the breaker', () => {
    const clock = makeClock();
    const breaker = new RateLimitBreaker({
      failureThreshold: 2,
      failureWindowMs: 60_000,
      cooldownMs: 300_000,
      now: clock.now,
    });

    breaker.recordOutcome(500);
    breaker.recordOutcome(500);
    clock.advance(300_001);
    expect(breaker.state()).toBe('closed');

    breaker.recordOutcome(500);
    const decision = breaker.recordOutcome(500);
    expect(decision.state).toBe('open');
  });
});
