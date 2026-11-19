import { afterEach, describe, expect, it, vi } from "vitest";
import { now } from "../../src/utils/now.ts";

describe("now", () => {
  afterEach(() => vi.useRealTimers());

  it("reads the clock on each call and returns independent Dates", () => {
    vi.useFakeTimers();
    vi.setSystemTime(123);
    const first = now();

    vi.setSystemTime(1456);
    const second = now();

    expect(first.getTime()).toBe(123);
    expect(second.getTime()).toBe(1456);
  });
});
