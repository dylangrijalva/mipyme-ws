import { afterEach, describe, expect, it, vi } from "vitest";
import { now } from "../../src/utils/now.ts";

describe("now", () => {
  afterEach(() => vi.useRealTimers());

  it("returns the current time as a Date, including milliseconds", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-23T12:34:56.789Z"));

    const result = now();

    expect(result).toBeInstanceOf(Date);
    expect(result.toISOString()).toBe("2026-09-23T12:34:56.789Z");
  });

  it("reads the clock on each call and returns independent Dates", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const first = now();

    vi.setSystemTime(1000);
    const second = now();
    first.setTime(5000);

    expect(second.getTime()).toBe(1000);
    expect(now().getTime()).toBe(1000);
  });
});
