import { describe, expect, test } from "bun:test";
import { SystemClock } from "../../../src/shared/infra/system-clock";

describe("SystemClock", () => {
  test("returns the current instant", () => {
    const before = Date.now();

    const now = new SystemClock().now().getTime();

    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(Date.now());
  });

  test("returns a new Date on each call so callers cannot share mutable state", () => {
    const clock = new SystemClock();

    expect(clock.now()).not.toBe(clock.now());
  });
});
