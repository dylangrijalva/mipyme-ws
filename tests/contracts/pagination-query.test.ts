import { describe, expect, it } from "vitest";
import { PaginationRequest } from "../../src/contracts/pagination-query.ts";

describe("PaginationRequest", () => {
  it("rejects fractional limits before they reach database pagination", () => {
    const result = PaginationRequest.safeParse({ limit: "1.5" });

    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual([expect.objectContaining({ path: ["limit"] })]);
  });
});
