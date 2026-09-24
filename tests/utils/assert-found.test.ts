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

  it.each([null, undefined])("does not validate %s at runtime", async (value) => {
    const result = assertFound(Promise.resolve<string | null | undefined>(value));

    await expect(result).resolves.toBe(value);
  });

  it("preserves the original rejection", async () => {
    const error = new Error("Crew lookup failed");

    const result = assertFound(Promise.reject(error));

    await expect(result).rejects.toBe(error);
  });
});
