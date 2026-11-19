import { and, desc, eq, gt, inArray, ne, or, type SQL } from "drizzle-orm";
import { Employee } from "../contracts/employee.ts";
import type { EmployeeInvitationSummary } from "../contracts/employee-invitation.ts";
import type { EmployeeStatus } from "../contracts/employee-status.ts";
import type { ScopedPaginationRequest } from "../contracts/pagination-query.ts";
import type { PaginationResponse } from "../contracts/pagination-response.ts";
import type { Database } from "../db/index.ts";
import { tables } from "../db/schema.ts";
import { paginate } from "../utils/paginate.ts";
import { resolveInvitationStatus } from "../utils/resolve-invitation-status.ts";
import { type SyncCriteria, syncWindow } from "./sync-criteria.ts";

type Criteria = {
  merchantId?: string;
  id?: string;
  excludedId?: string;
  phone?: string;
  pin?: string;
  statuses?: Array<EmployeeStatus>;
};

class EmployeeFinder {
  async findForSync(db: Database, criteria: SyncCriteria): Promise<Array<Employee>> {
    return this.findEmployees(
      db,
      and(
        eq(tables.employee.merchantId, criteria.merchantId),
        or(syncWindow(tables.employee.updatedAt, criteria), syncWindow(tables.account.updatedAt, criteria)),
      ),
    );
  }

  async find(db: Database, criteria: Criteria): Promise<Employee | null> {
    const [employee] = await this.findEmployees(db, this.where(criteria), 1);
    return employee ?? null;
  }

  async paginate(db: Database, criteria: ScopedPaginationRequest & Criteria): Promise<PaginationResponse<Employee>> {
    const employees = await this.findEmployees(
      db,
      and(this.where(criteria), criteria.cursor !== undefined ? gt(tables.employee.id, criteria.cursor) : undefined),
      criteria.limit + 1,
    );
    return paginate({ collection: employees, limit: criteria.limit });
  }

  async exists(db: Database, criteria: Criteria): Promise<boolean> {
    const [record] = await db
      .select({ id: tables.employee.id })
      .from(tables.employee)
      .leftJoin(tables.account, this.accountJoin())
      .where(this.where(criteria))
      .limit(1);
    return record !== undefined;
  }

  private where(criteria: Criteria) {
    return and(
      criteria.merchantId !== undefined ? eq(tables.employee.merchantId, criteria.merchantId) : undefined,
      criteria.id !== undefined ? eq(tables.employee.id, criteria.id) : undefined,
      criteria.excludedId !== undefined ? ne(tables.employee.id, criteria.excludedId) : undefined,
      criteria.phone !== undefined ? eq(tables.account.phone, criteria.phone) : undefined,
      criteria.pin !== undefined ? eq(tables.employee.pin, criteria.pin) : undefined,
      criteria.statuses !== undefined ? inArray(tables.employee.status, criteria.statuses) : undefined,
    );
  }

  private accountJoin() {
    return and(
      eq(tables.account.id, tables.employee.accountId),
      eq(tables.account.merchantId, tables.employee.merchantId),
    );
  }

  private async findEmployees(db: Database, condition: SQL | undefined, limit?: number): Promise<Array<Employee>> {
    const query = db
      .select({
        employee: tables.employee,
        account: {
          id: tables.account.id,
          email: tables.account.email,
          phone: tables.account.phone,
          phoneVerified: tables.account.phoneVerified,
        },
      })
      .from(tables.employee)
      .leftJoin(tables.account, this.accountJoin())
      .where(condition)
      .orderBy(tables.employee.id);
    const records = limit === undefined ? await query : await query.limit(limit);
    if (records.length === 0) {
      return [];
    }

    const merchantIds = [...new Set(records.map((record) => record.employee.merchantId))];
    const employeeIds = records.map((record) => record.employee.id);
    const [locationIdsByEmployee, invitationsByEmployee] = await Promise.all([
      this.findLocationIdsByEmployee(db, merchantIds, employeeIds),
      this.findLatestInvitationByEmployee(db, merchantIds, employeeIds),
    ]);
    return records.map((record) =>
      Employee.parse({
        ...record.employee,
        account: record.account,
        locationIds: locationIdsByEmployee.get(record.employee.id) ?? [],
        invitation: invitationsByEmployee.get(record.employee.id) ?? null,
      }),
    );
  }

  private async findLocationIdsByEmployee(
    db: Database,
    merchantIds: Array<string>,
    employeeIds: Array<string>,
  ): Promise<Map<string, Array<string>>> {
    const accessRecords = await db
      .select({ employeeId: tables.locationAccess.employeeId, locationId: tables.locationAccess.locationId })
      .from(tables.locationAccess)
      .where(
        and(
          inArray(tables.locationAccess.merchantId, merchantIds),
          inArray(tables.locationAccess.employeeId, employeeIds),
        ),
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

  private async findLatestInvitationByEmployee(
    db: Database,
    merchantIds: Array<string>,
    employeeIds: Array<string>,
  ): Promise<Map<string, EmployeeInvitationSummary>> {
    const invitations = await db
      .select({
        id: tables.employeeInvitation.id,
        employeeId: tables.employeeInvitation.employeeId,
        email: tables.employeeInvitation.email,
        status: tables.employeeInvitation.status,
        expiresAt: tables.employeeInvitation.expiresAt,
      })
      .from(tables.employeeInvitation)
      .where(
        and(
          inArray(tables.employeeInvitation.merchantId, merchantIds),
          inArray(tables.employeeInvitation.employeeId, employeeIds),
        ),
      )
      .orderBy(desc(tables.employeeInvitation.createdAt), desc(tables.employeeInvitation.id));

    const invitationsByEmployee = new Map<string, EmployeeInvitationSummary>();
    for (const invitation of invitations) {
      if (invitationsByEmployee.has(invitation.employeeId)) {
        continue;
      }

      invitationsByEmployee.set(invitation.employeeId, {
        id: invitation.id,
        email: invitation.email,
        status: resolveInvitationStatus(invitation),
        expiresAt: invitation.expiresAt,
      });
    }
    return invitationsByEmployee;
  }
}

export { EmployeeFinder };
