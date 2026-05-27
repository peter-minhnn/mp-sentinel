/**
 * Unit tests for the per-provider circuit breaker.
 */

import { describe, expect, it } from "@jest/globals";
import { CircuitBreaker } from "../services/ai/circuit-breaker.js";

const newClock = () => {
  let t = 1_000_000;
  return {
    now: (): number => t,
    advance: (ms: number): void => {
      t += ms;
    },
  };
};

describe("CircuitBreaker", () => {
  it("starts closed and allows calls", () => {
    const cb = new CircuitBreaker();
    expect(cb.allow("p:m")).toBe(true);
    expect(cb.inspect("p:m")).toBe("closed");
  });

  it("stays closed below the failure threshold", () => {
    const cb = new CircuitBreaker({ failureThreshold: 3 });
    cb.onFailure("p:m");
    cb.onFailure("p:m");
    expect(cb.inspect("p:m")).toBe("closed");
    expect(cb.allow("p:m")).toBe(true);
  });

  it("opens after threshold consecutive failures", () => {
    const cb = new CircuitBreaker({ failureThreshold: 3 });
    cb.onFailure("p:m");
    cb.onFailure("p:m");
    cb.onFailure("p:m");
    expect(cb.inspect("p:m")).toBe("open");
    expect(cb.allow("p:m")).toBe(false);
  });

  it("resets failure count on success", () => {
    const cb = new CircuitBreaker({ failureThreshold: 3 });
    cb.onFailure("p:m");
    cb.onFailure("p:m");
    cb.onSuccess("p:m");
    cb.onFailure("p:m");
    cb.onFailure("p:m");
    expect(cb.inspect("p:m")).toBe("closed");
  });

  it("transitions open → half-open after cooldown", () => {
    const clock = newClock();
    const cb = new CircuitBreaker({
      failureThreshold: 2,
      cooldownMs: 5_000,
      now: clock.now,
    });
    cb.onFailure("p:m");
    cb.onFailure("p:m");
    expect(cb.allow("p:m")).toBe(false);
    clock.advance(6_000);
    expect(cb.allow("p:m")).toBe(true);
    expect(cb.inspect("p:m")).toBe("half-open");
  });

  it("half-open failure re-opens with a fresh cooldown", () => {
    const clock = newClock();
    const cb = new CircuitBreaker({
      failureThreshold: 2,
      cooldownMs: 5_000,
      now: clock.now,
    });
    cb.onFailure("p:m");
    cb.onFailure("p:m");
    clock.advance(6_000);
    cb.allow("p:m"); // transitions to half-open
    cb.onFailure("p:m");
    expect(cb.inspect("p:m")).toBe("open");
    expect(cb.allow("p:m")).toBe(false);
    clock.advance(5_001);
    expect(cb.allow("p:m")).toBe(true);
  });

  it("half-open success closes the breaker", () => {
    const clock = newClock();
    const cb = new CircuitBreaker({
      failureThreshold: 2,
      cooldownMs: 5_000,
      now: clock.now,
    });
    cb.onFailure("p:m");
    cb.onFailure("p:m");
    clock.advance(6_000);
    cb.allow("p:m"); // → half-open
    cb.onSuccess("p:m");
    expect(cb.inspect("p:m")).toBe("closed");
  });

  it("isolates state per key", () => {
    const cb = new CircuitBreaker({ failureThreshold: 2 });
    cb.onFailure("a:1");
    cb.onFailure("a:1");
    expect(cb.inspect("a:1")).toBe("open");
    expect(cb.inspect("b:1")).toBe("closed");
    expect(cb.allow("b:1")).toBe(true);
  });

  it("reset() clears all entries", () => {
    const cb = new CircuitBreaker({ failureThreshold: 1 });
    cb.onFailure("p:m");
    expect(cb.inspect("p:m")).toBe("open");
    cb.reset();
    expect(cb.inspect("p:m")).toBe("closed");
  });
});
