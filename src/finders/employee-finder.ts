import { and, eq, inArray, or } from "drizzle-orm";
import { SyncEmployee } from "../contracts/employee.ts";
import type { Database } from "../db/index.ts";
import { tables } from "../db/schema.ts";
import { type SyncCriteria, syncWindow } from "./sync-criteria.ts";

class EmployeeFinder {
  async findForSync(db: Database, criteria: SyncCriteria): Promise<Array<SyncEmployee>> {
    const records = await db
      .select({
        employee: tables.employee,
        account: { id: tables.account.id, email: tables.account.email, phone: tables.account.phone },
      })
      .from(tables.employee)
      .leftJoin(
        tables.account,
        and(
          eq(tables.account.id, tables.employee.accountId),
          eq(tables.account.merchantId, tables.employee.merchantId),
        ),
      )
      .where(
        and(
          eq(tables.employee.merchantId, criteria.merchantId),
          or(syncWindow(tables.employee.updatedAt, criteria), syncWindow(tables.account.updatedAt, criteria)),
        ),
      )
      .orderBy(tables.employee.id);
    if (records.length === 0) {
      return [];
    }

    const locationIdsByEmployee = await this.findLocationIdsByEmployee(
      db,
      criteria.merchantId,
      records.map((record) => record.employee.id),
    );
    return records.map((record) =>
      SyncEmployee.parse({
        ...record.employee,
        account: record.account,
        locationIds: locationIdsByEmployee.get(record.employee.id) ?? [],
      }),
    );
  }

  private async findLocationIdsByEmployee(
    db: Database,
    merchantId: string,
    employeeIds: Array<string>,
  ): Promise<Map<string, Array<string>>> {
    const accessRecords = await db
      .select({ employeeId: tables.locationAccess.employeeId, locationId: tables.locationAccess.locationId })
      .from(tables.locationAccess)
      .where(
        and(eq(tables.locationAccess.merchantId, merchantId), inArray(tables.locationAccess.employeeId, employeeIds)),
      )
      .orderBy(tables.locationAccess.locationId);

    const locationIdsByEmployee = new Map<string, Array<string>>();
    for (const { employeeId, locationId } of accessRecords) {
      const locationIds = locationIdsByEmployee.get(employeeId) ?? [];
      locationIds.push(locationId);
      locationIdsByEmployee.set(employeeId, locationIds);
    }
    return locationIdsByEmployee;
  }
}

export { EmployeeFinder };
