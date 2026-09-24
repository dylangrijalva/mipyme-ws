import { describe, expect, it } from "vitest";
import type { Customer } from "../../src/contracts/customer.ts";
import { paginate } from "../../src/utils/paginate.ts";

describe("paginate", () => {
  const customers: Array<Customer> = [
    {
      id: "cust_3BMJIGYZ6RYPE52GEMA",
      name: "Monkey D. Luffy",
      email: "luffy@strawhatpirates.example.com",
      phone: null,
      createdAt: new Date("2026-09-23T00:00:00.000Z"),
      updatedAt: new Date("2026-09-23T00:00:00.000Z"),
    },
    {
      id: "cust_O2V1002W2IMOTUD2LNT",
      name: "Roronoa Zoro",
      email: "zoro@strawhatpirates.example.com",
      phone: null,
      createdAt: new Date("2026-09-23T00:00:00.000Z"),
      updatedAt: new Date("2026-09-23T00:00:00.000Z"),
    },
    {
      id: "cust_6SOT8LIUHM7O2U6X28H",
      name: "Nami",
      email: "nami@strawhatpirates.example.com",
      phone: null,
      createdAt: new Date("2026-09-23T00:00:00.000Z"),
      updatedAt: new Date("2026-09-23T00:00:00.000Z"),
    },
  ];

  it("returns an empty final page for an empty collection", () => {
    const result = paginate<Customer>({ collection: [], limit: 2 });

    expect(result).toStrictEqual({ results: [], nextCursor: null, hasMore: false });
  });

  it.each([3, 4])("returns a final page when the collection fits the limit of %i", (limit) => {
    const result = paginate({ collection: customers, limit });

    expect(result).toStrictEqual({ results: customers, nextCursor: null, hasMore: false });
  });

  it("uses the last returned item as the cursor and preserves the input", () => {
    const collection = [...customers];

    const result = paginate({ collection, limit: 2 });

    expect(result).toStrictEqual({
      results: [customers[0], customers[1]],
      nextCursor: "cust_O2V1002W2IMOTUD2LNT",
      hasMore: true,
    });
    expect(collection).toStrictEqual(customers);
  });

  it("supports a single-item page", () => {
    const result = paginate({ collection: customers, limit: 1 });

    expect(result).toStrictEqual({ results: [customers[0]], nextCursor: "cust_3BMJIGYZ6RYPE52GEMA", hasMore: true });
  });
});
