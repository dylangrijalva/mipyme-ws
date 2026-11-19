import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EmployeePaginationRequest,
  ListEmployeesService,
} from "../../../../src/services/staff/employees/list-employees-service.ts";
import { insertEmployee, setupEmployees } from "../../../test-utils/employee-fixture.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ListEmployeesService", () => {
  it("lists the merchant's enabled and disabled employees by id, leaving out archived and foreign ones", async () => {
    const { db, merchantId, ownerId, managerId, cashierId, cashier, dependencies } = await setupEmployees();
    const disabledId = await insertEmployee(db, { merchantId, name: "Sanji", status: "disabled", pin: "2222" });
    await insertEmployee(db, { merchantId, name: "Usopp", status: "archived", pin: "3333" });

    const result = await ListEmployeesService.create(dependencies(cashier)).execute(
      EmployeePaginationRequest.parse({}),
    );

    expect(result.success).toBe(true);
    expect(result.value?.results.map((employee) => employee.id)).toEqual(
      [ownerId, managerId, cashierId, disabledId].sort(),
    );
    expect(result.value).toMatchObject({ nextCursor: null, hasMore: false });
  });

  it("lists only employees with the requested status", async () => {
    const { db, merchantId, owner, dependencies } = await setupEmployees();
    const archivedId = await insertEmployee(db, { merchantId, name: "Usopp", status: "archived", pin: "3333" });

    const result = await ListEmployeesService.create(dependencies(owner)).execute(
      EmployeePaginationRequest.parse({ status: "archived" }),
    );

    expect(result.value?.results).toEqual([expect.objectContaining({ id: archivedId, status: "archived" })]);
  });

  it("pages through the employees with the returned cursor", async () => {
    const { ownerId, managerId, cashierId, owner, dependencies } = await setupEmployees();
    const service = ListEmployeesService.create(dependencies(owner));
    const expectedIds = [ownerId, managerId, cashierId].sort();

    const first = await service.execute(EmployeePaginationRequest.parse({ limit: "2" }));
    const second = await service.execute(
      EmployeePaginationRequest.parse({ limit: "2", cursor: first.value?.nextCursor ?? undefined }),
    );

    expect(first.value).toMatchObject({ hasMore: true, nextCursor: expectedIds[1] });
    expect(first.value?.results.map((employee) => employee.id)).toEqual(expectedIds.slice(0, 2));
    expect(second.value).toMatchObject({ hasMore: false, nextCursor: null });
    expect(second.value?.results.map((employee) => employee.id)).toEqual(expectedIds.slice(2));
  });

  it("rejects an unknown status filter", () => {
    const result = EmployeePaginationRequest.safeParse({ status: "invited" });

    expect(result.success).toBe(false);
  });
});
