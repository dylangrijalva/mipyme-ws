import { describe, expect, expectTypeOf, it } from "vitest";
import { assertFound } from "../../src/utils/assert-found.ts";

describe("assertFound", () => {
  it("narrows the promise type and preserves the resolved object", async () => {
    const crew = { name: "Straw Hat Pirates" };
    const promise: Promise<typeof crew | null | undefined> = Promise.resolve(crew);

    const result = assertFound(promise);

    expectTypeOf(result).toEqualTypeOf<Promise<typeof crew>>();
    await expect(result).resolves.toBe(crew);
  });
});
